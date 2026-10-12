import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertProviderAdapter,
  assessQuote,
  canonicalStringify,
  createCallbackInbox,
  createCallbackSigner,
  createChecksSimulator,
  createKycCallbackVerifier,
  createKycSimulator,
  createNonceStore,
  createQuoteSimulator,
  createSeededRandom,
  createSimulatedClock,
  IdempotencyRegistry,
  SIMULATOR_ENVIRONMENT,
  verificationKeyOf,
} from "../src/index.mjs";
import { DeliveryQueue, isIsoSeconds, scheduleTimeline } from "../src/simulator-core.mjs";
import { freshKey, keyringOf, nextNonce, signRaw } from "./helpers.mjs";

/**
 * Regression tests for the wave-73 shared-infrastructure audit: the inbox
 * factory's configuration, the adapter boundary walk, delivery-mode dispatch,
 * member validation, keyring snapshots, freshness bounds and the canonical
 * instant domain. Every defect lived in primitives all simulators share.
 */

const CHECKS_REQUEST = {
  check_ref: "sim-check-1",
  check_type: "personal",
  sender_ref: "sim-sender-1",
  recipient_ref: "sim-recipient-1",
  amount: "25.000000",
  asset: "USDT",
  claim_reference: "claimref-0000000000000001",
  idempotency_key: "idem-check-0001x",
};

const KYC_EVENT = {
  event_id: "kycevt_00000000000000000000000000000001",
  provider_reference: "kycref_00000000000000000000000000000001",
  applicant_ref: "sim-applicant-1",
  level: "basic",
  sequence: 1,
  status: "in_review",
};

const QUOTE_REQUEST = {
  pair: "USDT/RUB",
  side: "buy",
  base_amount: "100.000000",
  idempotency_key: "idem-quote-0001x",
};

function quoteNow(quote) {
  return Date.parse(quote.issued_at) / 1000;
}

describe("callback inbox configuration fails closed at construction", () => {
  test("a transitions table that is not a plain object of string arrays is refused", () => {
    const base = { subjectField: "provider_reference", initialStatus: "submitted", transitions: { submitted: ["in_review"] } };
    for (const transitions of [
      null,
      undefined,
      "submitted->in_review",
      [["in_review"]],
      { submitted: "in_review" },
      { submitted: ["in_review"], in_review: "approved" },
      { submitted: [1, "in_review"] },
      { submitted: [["nested"]] },
      { submitted: ["in_review"], extra: {} },
      { submitted: ["in_review"], extra: null },
    ]) {
      assert.throws(
        () => createCallbackInbox({ ...base, transitions }),
        TypeError,
        JSON.stringify(transitions),
      );
    }
    assert.throws(() => createCallbackInbox({ ...base, subjectField: "" }), TypeError);
    assert.throws(() => createCallbackInbox({ ...base, subjectField: 42 }), TypeError);
    assert.throws(() => createCallbackInbox({ ...base, initialStatus: 7 }), TypeError);
    assert.throws(() => createCallbackInbox({ ...base, initialStatus: "" }), TypeError);
    const inbox = createCallbackInbox(base);
    assert.ok(inbox);
  });

  test("a string-valued transition is refused and never substring-matches statuses", () => {
    // Before the fix this constructed fine, and "in" satisfied the transition
    // via String.prototype.includes("in") on "in_review".
    assert.throws(
      () =>
        createCallbackInbox({
          subjectField: "provider_reference",
          initialStatus: "submitted",
          transitions: { submitted: "in_review" },
        }),
      TypeError,
    );
    const inbox = createCallbackInbox({
      subjectField: "provider_reference",
      initialStatus: "submitted",
      transitions: { submitted: ["in_review"], in_review: ["approved"], approved: [] },
    });
    inbox.openSubject(KYC_EVENT.provider_reference, { deadline: 10_000 });
    for (const status of ["i", "in", "in_", "in_reviewx", "review"]) {
      const result = inbox.accept(
        { ...KYC_EVENT, event_id: `kycevt_${status.padStart(32, "0")}`, status },
        { receivedAt: 100 },
      );
      assert.equal(result.action, "invalid_transition", status);
      assert.equal(inbox.get(KYC_EVENT.provider_reference).status, "submitted");
    }
  });

  test("mutating the caller's transition table cannot change inbox semantics", () => {
    const transitions = { submitted: ["in_review"], in_review: ["approved"], approved: [] };
    const inbox = createCallbackInbox({
      subjectField: "provider_reference",
      initialStatus: "submitted",
      transitions,
    });
    inbox.openSubject(KYC_EVENT.provider_reference, { deadline: 10_000 });
    transitions.submitted = ["approved"];
    transitions.in_review.push("rejected");
    assert.equal(inbox.accept(KYC_EVENT, { receivedAt: 100 }).action, "applied");
    const escalated = inbox.accept(
      { ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000002", sequence: 2, status: "approved" },
      { receivedAt: 100 },
    );
    assert.equal(escalated.action, "applied");
    const rejected = inbox.accept(
      { ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000003", sequence: 3, status: "rejected" },
      { receivedAt: 100 },
    );
    assert.equal(rejected.action, "invalid_transition");
  });

  test("a subject deadline must be in the shared epoch domain", () => {
    const inbox = createCallbackInbox({
      subjectField: "provider_reference",
      initialStatus: "submitted",
      transitions: { submitted: ["in_review"], in_review: [] },
    });
    for (const deadline of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "soon"]) {
      assert.throws(
        () => inbox.openSubject(KYC_EVENT.provider_reference, { deadline }),
        (error) => error instanceof TypeError || error instanceof RangeError,
        String(deadline),
      );
    }
    assert.equal(inbox.get(KYC_EVENT.provider_reference), undefined);
    inbox.openSubject(KYC_EVENT.provider_reference, { deadline: 1_767_225_600 });
  });
});

describe("adapter boundary", () => {
  const bank = { providerId: "future-bank", createPaymentIntent: async () => ({}), getPaymentStatus: async () => ({}) };

  test("a prototype chain that cycles is refused instead of hanging", () => {
    const loopy = new Proxy(bank, {
      getPrototypeOf(target) {
        return new Proxy(target, { getPrototypeOf: () => loopy });
      },
    });
    assert.throws(() => assertProviderAdapter("bank", loopy), TypeError);
  });

  test("money-moving operations hidden behind a private-name convention are refused", () => {
    for (const operation of ["_settle", "_payout", "_payOut", "__transfer", "_withdraw", "_confirm"]) {
      assert.throws(
        () => assertProviderAdapter("bank", { ...bank, [operation]: async () => ({}) }),
        /must not expose/,
        operation,
      );
    }
    // All-caps constants and genuinely private helpers stay out of scope.
    assert.equal(assertProviderAdapter("bank", { ...bank, _SETTLE_TIMEOUT_MS: 5_000 }), true);
    assert.equal(assertProviderAdapter("bank", { ...bank, _paymentHistory: async () => ({}) }), true);
  });
});

describe("delivery timeline dispatch", () => {
  test("an unknown delivery mode fails loudly instead of degrading to normal", () => {
    const signer = createCallbackSigner({ key: freshKey(), domain: "kyc", random: createSeededRandom("wave73") });
    const events = [{ payload: { domain: "kyc", environment: SIMULATOR_ENVIRONMENT }, occurredAt: 100 }];
    for (const mode of ["out-of-order", "dup", "LATE", "random", "", 3, null, undefined]) {
      const queue = new DeliveryQueue(signer);
      assert.throws(() => scheduleTimeline(queue, events, mode, createSeededRandom("wave73")), TypeError, String(mode));
      assert.equal(queue.size(), 0, `${String(mode)} must not schedule anything`);
    }
    for (const mode of ["normal", "duplicate", "out_of_order", "none"]) {
      const queue = new DeliveryQueue(signer);
      scheduleTimeline(
        queue,
        [
          { payload: { domain: "kyc", environment: SIMULATOR_ENVIRONMENT, sequence: 1 }, occurredAt: 100 },
          { payload: { domain: "kyc", environment: SIMULATOR_ENVIRONMENT, sequence: 2 }, occurredAt: 200 },
        ],
        mode,
        createSeededRandom("wave73"),
      );
      assert.ok(queue.size() >= 0);
    }
  });
});

describe("checks member directory validation", () => {
  test("a member profile is validated once and stores exactly that value", async () => {
    let reads = 0;
    const members = {
      "sim-sender-1": { kyc_verified: true },
      "sim-recipient-1": {
        get kyc_verified() {
          reads += 1;
          return reads === 1 ? true : false;
        },
      },
    };
    const clock = createSimulatedClock();
    const simulator = createChecksSimulator({ seed: "wave73", key: freshKey(), clock, members, defaultScenario: "delivered" });
    const created = await simulator.createCheck(CHECKS_REQUEST);
    await simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0001x" });
    // The first (and only) read stored `true`: the recipient can claim.
    const claimed = await simulator.claimCheck({
      check_id: created.check_id,
      member_ref: "sim-recipient-1",
      claim_reference: CHECKS_REQUEST.claim_reference,
      idempotency_key: "idem-claim-0001x",
    });
    assert.equal(claimed.status, "claimed");
    assert.equal(reads, 1, "the member profile must be read exactly once");
  });

  test("a profile whose only read is not a boolean is refused", () => {
    for (const members of [
      { "sim-sender-1": { kyc_verified: true }, "sim-recipient-1": { get kyc_verified() { return "yes"; } } },
      { "sim-sender-1": { kyc_verified: true }, "sim-recipient-1": { get kyc_verified() { return true; }, extra: 1 } },
    ]) {
      assert.throws(
        () => createChecksSimulator({ seed: "wave73", key: freshKey(), members }),
        TypeError,
      );
    }
  });
});

describe("callback verifier construction", () => {
  test("the verifier pins its keyring at construction", async () => {
    const key = freshKey();
    const ring = keyringOf(key);
    const verify = createKycCallbackVerifier({ keyring: ring, nonceStore: createNonceStore() });
    const impostor = freshKey("hmac-sha256", "sim-key-2");
    ring.set(impostor.keyId, verificationKeyOf(impostor));
    const clock = createSimulatedClock();
    const simulator = createKycSimulator({ seed: "wave73", key: impostor, clock, defaultScenario: "approve" });
    await simulator.submitApplicant({ applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-wave73-1xxx" });
    clock.advance(3600);
    const [delivery] = simulator.drainCallbacks();
    assert.equal(
      verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt }).reason,
      "unknown_key_id",
      "a key added to the ring after construction must not verify",
    );
  });

  test("a nonce store without the record contract is refused at construction", () => {
    const ring = keyringOf(freshKey());
    for (const nonceStore of [null, undefined, {}, { record: "yes" }, { record: null }]) {
      assert.throws(
        () => createKycCallbackVerifier({ keyring: ring, nonceStore }),
        TypeError,
        JSON.stringify(nonceStore),
      );
    }
  });
});

describe("shared state machinery lifecycle guards", () => {
  test("external writes cannot lose scheduled signed deliveries or replay state", () => {
    const signer = createCallbackSigner({ key: freshKey(), domain: "kyc", random: createSeededRandom("wave73") });
    const queue = new DeliveryQueue(signer);
    queue.schedule({ domain: "kyc", environment: SIMULATOR_ENVIRONMENT, sequence: 1 }, 100);
    queue.schedule({ domain: "kyc", environment: SIMULATOR_ENVIRONMENT, sequence: 2 }, 300);
    // Before the fix these were real fields: this poke lost both deliveries.
    /** @type {Record<string, unknown>} */ (queue).pending = [];
    /** @type {Record<string, unknown>} */ (queue).order = 99;
    /** @type {Record<string, unknown>} */ (queue).signer = null;
    const due = queue.drain(1_000);
    assert.equal(due.length, 2);
    assert.ok(due[0].headers["x-sim-signature"].startsWith("v1="));
    assert.equal(queue.size(), 0);

    const registry = new IdempotencyRegistry();
    const request = { applicant_ref: "sim-x" };
    const stored = registry.run("idem-key-00002", request, () => ({ status: "submitted" }));
    // Before the fix this cleared the registry and the replay re-ran create().
    /** @type {Record<string, unknown>} */ (registry).entries = new Map();
    const replay = registry.run("idem-key-00002", request, () => ({ status: "created" }));
    assert.equal(replay.status, stored.status);
  });
});

describe("quote freshness bounds", () => {
  test("a malformed freshness bound fails closed instead of disabling the check", async () => {
    const simulator = createQuoteSimulator({ seed: "wave73", key: freshKey() });
    const quote = await simulator.requestQuote(QUOTE_REQUEST);
    const now = quoteNow(quote);
    for (const maxPriceAgeSeconds of [Number.NaN, -1, 1.5, "60", null, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => assessQuote(quote, { now, maxPriceAgeSeconds }),
        RangeError,
        String(maxPriceAgeSeconds),
      );
    }
    assert.equal(assessQuote(quote, { now, maxPriceAgeSeconds: 3600 }).displayable, true);
    assert.equal(assessQuote(quote, { now, maxPriceAgeSeconds: 0 }).displayable, false);
  });
});

describe("canonical instants share the simulator epoch domain", () => {
  test("instants outside the epoch-seconds range are rejected", () => {
    assert.equal(isIsoSeconds("0000-01-01T00:00:00Z"), false);
    assert.equal(isIsoSeconds("1969-12-31T23:59:59Z"), false);
    assert.equal(isIsoSeconds("1970-01-01T00:00:00Z"), true);
    assert.equal(isIsoSeconds("9999-12-31T23:59:59Z"), true);
    assert.equal(isIsoSeconds("2026-02-30T00:00:00Z"), false);
    assert.equal(isIsoSeconds("2026-01-01T00:00:60Z"), false);
  });

  test("a forged callback with a pre-epoch occurred_at is rejected end to end", async () => {
    const key = freshKey();
    const clock = createSimulatedClock();
    const simulator = createKycSimulator({ seed: "wave73", key, clock, defaultScenario: "approve" });
    await simulator.submitApplicant({ applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-wave73-2xxx" });
    clock.advance(3600);
    const [delivery] = simulator.drainCallbacks();
    const payload = JSON.parse(delivery.body.toString("utf8"));
    const forged = canonicalStringify({ ...payload, occurred_at: "0000-01-01T00:00:00Z" });
    const signed = signRaw({ key, domain: "kyc", body: forged, timestamp: delivery.deliverAt, nonce: nextNonce() });
    const verify = createKycCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
    assert.equal(verify({ headers: signed.headers, body: signed.body, now: delivery.deliverAt }).reason, "invalid_payload");
  });
});

describe("observed-clean invariants (pinned, not fixed)", () => {
  test("an idempotent replay still stores and returns clones, never the live object", () => {
    const registry = new IdempotencyRegistry();
    const request = { applicant_ref: "sim-x", level: "basic" };
    const first = registry.run("idem-key-00001", request, () => ({ nested: { status: "submitted" } }));
    first.nested.status = "hacked";
    const replay = registry.run("idem-key-00001", request, () => ({ nested: { status: "other" } }));
    assert.equal(replay.nested.status, "submitted");
    replay.nested.status = "hacked-again";
    assert.equal(registry.run("idem-key-00001", request, () => ({})).nested.status, "submitted");
  });

  test("two envelopes for the same instant never share a nonce", async () => {
    const key = freshKey();
    const clock = createSimulatedClock();
    const simulator = createKycSimulator({ seed: "wave73", key, clock, defaultScenario: "approve" });
    await simulator.submitApplicant({ applicant_ref: "sim-applicant-1", level: "basic", idempotency_key: "idem-wave73-3xxx" });
    clock.advance(3600);
    const deliveries = simulator.drainCallbacks();
    const nonces = deliveries.map((delivery) => delivery.headers["x-sim-nonce"]);
    assert.equal(new Set(nonces).size, nonces.length);
  });
});
