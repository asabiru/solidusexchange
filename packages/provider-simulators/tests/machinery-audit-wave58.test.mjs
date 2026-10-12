import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertProviderAdapter,
  BANK_SCENARIOS,
  CHECKS_SCENARIOS,
  createBankSimulator,
  createCallbackInbox,
  createCallbackSigner,
  createChecksSimulator,
  createKycCallbackInbox,
  createKycSimulator,
  createKytCallbackInbox,
  createKytSimulator,
  createQuoteSimulator,
  createSeededRandom,
  createSimulatedClock,
  IdempotencyRegistry,
  KYC_SCENARIOS,
  KYC_TRANSITIONS,
  KYT_SCENARIOS,
  KYT_TRANSITIONS,
  ProviderError,
  QUOTE_SCENARIOS,
  SIMULATOR_ENVIRONMENT,
} from "../src/index.mjs";
import { DeliveryQueue } from "../src/simulator-core.mjs";
import { freshKey } from "./helpers.mjs";

/**
 * Regression tests for the wave-58 provider-machinery audit: state-machine
 * skip paths, freeze depth on shared fixtures, case-confused forbidden
 * operations, capacity bounds on every per-resource store, timeout option
 * bounds, and the failed-claim counter.
 */

const MEMBERS = {
  "sim-sender-1": { kyc_verified: true },
  "sim-recipient-1": { kyc_verified: true },
};

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

const SUBJECT = "kycref_00000000000000000000000000000001";
const KYC_EVENT = {
  event_id: "kycevt_00000000000000000000000000000001",
  provider_reference: SUBJECT,
  applicant_ref: "sim-applicant-1",
  level: "basic",
  sequence: 1,
  status: "in_review",
};
const KYT_EVENT = {
  event_id: "kytevt_00000000000000000000000000000001",
  assessment_id: "kytasm_00000000000000000000000000000001",
  sequence: 1,
  status: "pending",
};

const kycInbox = () => {
  const inbox = createKycCallbackInbox();
  inbox.openSubject(SUBJECT, { deadline: 10_000 });
  return inbox;
};

describe("state-machine integrity: the review step cannot be skipped", () => {
  test("a KYC application cannot jump from submitted to a decision", () => {
    for (const status of ["approved", "rejected", "needs_more_data"]) {
      const inbox = kycInbox();
      const result = inbox.accept(
        { ...KYC_EVENT, status, reason_codes: status === "rejected" ? ["SIM_DOCUMENT_UNREADABLE"] : [] },
        { receivedAt: 100 },
      );
      assert.equal(result.action, "invalid_transition", status);
      assert.equal(inbox.get(SUBJECT).status, "submitted");
      assert.equal(inbox.get(SUBJECT).sequence, 0);
    }
    const inbox = kycInbox();
    assert.equal(inbox.accept(KYC_EVENT, { receivedAt: 100 }).action, "applied");
    assert.equal(
      inbox.accept(
        { ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000002", sequence: 2, status: "approved" },
        { receivedAt: 100 },
      ).action,
      "applied",
    );
    assert.equal(inbox.get(SUBJECT).status, "approved");
    assert.deepEqual([...KYC_TRANSITIONS.submitted], ["in_review"]);
  });

  test("a KYT screening cannot jump from requested to completed", () => {
    const subject = "kytasm_00000000000000000000000000000001";
    const inbox = createKytCallbackInbox();
    inbox.openSubject(subject, { deadline: 10_000 });
    const result = inbox.accept({ ...KYT_EVENT, status: "completed" }, { receivedAt: 100 });
    assert.equal(result.action, "invalid_transition");
    assert.equal(inbox.get(subject).status, "requested");
    assert.equal(inbox.get(subject).sequence, 0);
    assert.deepEqual([...KYT_TRANSITIONS.requested], ["pending"]);
  });

  test("terminal re-entry and repeated transitions are refused", () => {
    const inbox = kycInbox();
    inbox.accept(KYC_EVENT, { receivedAt: 100 });
    inbox.accept(
      { ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000002", sequence: 2, status: "approved" },
      { receivedAt: 100 },
    );
    assert.equal(
      inbox.accept(
        { ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000003", sequence: 3, status: "rejected" },
        { receivedAt: 100 },
      ).action,
      "invalid_transition",
    );
    const fresh = kycInbox();
    fresh.accept(KYC_EVENT, { receivedAt: 100 });
    assert.equal(
      fresh.accept(
        { ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000004", sequence: 2, status: "in_review" },
        { receivedAt: 100 },
      ).action,
      "invalid_transition",
    );
  });
});

describe("shared fixtures are frozen through, not just at the surface", () => {
  test("scenario plans, score ranges, categories and status lists cannot be mutated", () => {
    assert.throws(() => {
      KYC_SCENARIOS.approve.outcome = "rejected";
    }, TypeError);
    assert.throws(() => {
      KYC_SCENARIOS.approve.delivery = "none";
    }, TypeError);
    assert.throws(() => {
      KYT_SCENARIOS.low.risk = "severe";
    }, TypeError);
    assert.throws(() => {
      BANK_SCENARIOS.payment_found.events.push("payment_reversed");
    }, TypeError);
    assert.throws(() => {
      BANK_SCENARIOS.payment_found.events[0] = "payment_reversed";
    }, TypeError);
    assert.throws(() => {
      QUOTE_SCENARIOS.fresh_quote.priceAge = 9_999;
    }, TypeError);
    assert.throws(() => {
      CHECKS_SCENARIOS.delivered.delivery = "none";
    }, TypeError);
    assert.throws(() => {
      KYT_SCENARIOS.low.delivery = "duplicate";
    }, TypeError);
    for (const fixture of [
      KYC_SCENARIOS,
      KYT_SCENARIOS,
      BANK_SCENARIOS,
      QUOTE_SCENARIOS,
      CHECKS_SCENARIOS,
    ]) {
      for (const plan of Object.values(fixture)) {
        for (const value of Object.values(/** @type {Record<string, unknown>} */ (plan))) {
          if (typeof value === "object" && value !== null) {
            assert.equal(Object.isFrozen(value), true);
          }
        }
      }
    }
    assert.equal(Object.isFrozen(BANK_SCENARIOS.payment_found.events), true);
  });

  test("an attempted mutation does not change what a new simulator emits", async () => {
    const simulator = createKycSimulator({ seed: "fixture-freeze", key: freshKey(), defaultScenario: "approve" });
    try {
      KYC_SCENARIOS.approve.outcome = "rejected";
    } catch {
      // Frozen: the mutation must throw; ignore either way.
    }
    const submission = await simulator.submitApplicant({
      applicant_ref: "sim-applicant-1",
      level: "basic",
      idempotency_key: "idem-kyc-0001xxx",
    });
    assert.ok(submission.provider_reference);
  });
});

describe("adapter boundary refuses case-confused money-moving operations", () => {
  const quote = { providerId: "future-lp", requestQuote: async () => ({}), getQuote: async () => ({}) };
  test("uppercase and titlecase spellings of forbidden verbs are refused too", () => {
    for (const operation of ["Payout", "Execute", "Settle", "SubmitOrder", "Trade", "PayOut", "transferOwner", "WithdrawAll"]) {
      assert.throws(
        () => assertProviderAdapter("quote", { ...quote, [operation]: async () => ({}) }),
        /must not expose/,
        operation,
      );
    }
    assert.equal(assertProviderAdapter("quote", { ...quote, paymentEstimate: async () => ({}) }), true);
    // All-caps names are constants by convention, not operations.
    assert.equal(assertProviderAdapter("quote", { ...quote, PAYOUT_TIMEOUT_MS: 5000 }), true);
  });
});

describe("capacity bounds: every per-resource store fails closed", () => {
  test("the idempotency registry refuses a new key past its capacity", () => {
    const registry = new IdempotencyRegistry({ maxEntries: 2 });
    const create = () => ({ ok: true });
    registry.run("idem-key-0001", { a: 1 }, create);
    registry.run("idem-key-0002", { a: 2 }, create);
    assert.throws(
      () => registry.run("idem-key-0003", { a: 3 }, create),
      (error) => error instanceof ProviderError && error.code === "capacity_exceeded",
    );
    assert.deepEqual(registry.run("idem-key-0001", { a: 1 }, create), { ok: true });
  });

  test("the delivery queue refuses to schedule past its pending capacity", () => {
    const signer = createCallbackSigner({
      key: freshKey(),
      domain: "kyc",
      random: createSeededRandom("wave58"),
    });
    const queue = new DeliveryQueue(signer, { maxPending: 2 });
    const payload = { domain: "kyc", environment: SIMULATOR_ENVIRONMENT };
    queue.schedule(payload, 100);
    queue.schedule(payload, 200);
    assert.throws(
      () => queue.schedule(payload, 300),
      (error) => error instanceof ProviderError && error.code === "capacity_exceeded",
    );
    assert.equal(queue.size(), 2);
    assert.equal(queue.drain(100).length, 1);
    queue.schedule(payload, 300);
    assert.equal(queue.size(), 2);
  });

  test("a simulator refuses a new resource past its capacity without side effects", async () => {
    const clock = createSimulatedClock();
    const simulator = createKycSimulator({
      seed: "wave58",
      key: freshKey(),
      clock,
      defaultScenario: "approve",
      maxResources: 2,
    });
    const submit = (n) =>
      simulator.submitApplicant({
        applicant_ref: `sim-applicant-${n}`,
        level: "basic",
        idempotency_key: `idem-kyc-${String(n).padStart(7, "0")}`,
      });
    await submit(1);
    await submit(2);
    await assert.rejects(submit(3), (error) => error instanceof ProviderError && error.code === "capacity_exceeded");
    const pending = simulator.pendingCallbacks();
    await assert.rejects(submit(4), (error) => error.code === "capacity_exceeded");
    assert.equal(simulator.pendingCallbacks(), pending, "a refused submission must not enqueue callbacks");
    const first = await simulator.submitApplicant({
      applicant_ref: "sim-applicant-1",
      level: "basic",
      idempotency_key: "idem-kyc-0000001",
    });
    assert.equal(first.status, "submitted");
  });

  test("quotes, bank and checks resource stores are capped the same way", async () => {
    const quotes = createQuoteSimulator({ seed: "wave58", key: freshKey(), maxResources: 1 });
    await quotes.requestQuote({ pair: "USDT/RUB", side: "buy", base_amount: "100.000000", idempotency_key: "idem-quote-0001x" });
    await assert.rejects(
      quotes.requestQuote({ pair: "TON/RUB", side: "buy", base_amount: "1.000000000", idempotency_key: "idem-quote-0002x" }),
      (error) => error.code === "capacity_exceeded",
    );

    const bank = createBankSimulator({ seed: "wave58", key: freshKey(), defaultScenario: "payment_found", maxResources: 1 });
    await bank.createPaymentIntent({ intent_ref: "sim-intent-1", amount: "10.00", currency: "RUB", method: "sbp", idempotency_key: "idem-bank-0001xx" });
    await assert.rejects(
      bank.createPaymentIntent({ intent_ref: "sim-intent-2", amount: "10.00", currency: "RUB", method: "sbp", idempotency_key: "idem-bank-0002xx" }),
      (error) => error.code === "capacity_exceeded",
    );

    const checks = createChecksSimulator({ seed: "wave58", key: freshKey(), members: MEMBERS, defaultScenario: "delivered", maxResources: 1 });
    await checks.createCheck(CHECKS_REQUEST);
    await assert.rejects(
      checks.createCheck({ ...CHECKS_REQUEST, check_ref: "sim-check-2", idempotency_key: "idem-check-0002x" }),
      (error) => error.code === "capacity_exceeded",
    );
  });

  test("the inbox refuses subjects and dedup records past their capacities", () => {
    const transitions = { open: ["done"], done: [] };
    const event = (sequence, suffix) => ({
      subject: "sim-s",
      event_id: `evt_${sequence}${suffix}`,
      sequence,
      status: "done",
    });
    const inbox = createCallbackInbox({
      subjectField: "subject",
      initialStatus: "open",
      transitions,
      maxSubjects: 1,
      maxEventIds: 4,
    });
    inbox.openSubject("sim-s", { deadline: 10_000 });
    assert.throws(() => inbox.openSubject("sim-t", { deadline: 10_000 }), TypeError);
    assert.equal(inbox.accept(event(1, "a"), { receivedAt: 50 }).action, "applied");
    for (const suffix of ["b", "c", "d"]) {
      assert.equal(inbox.accept(event(1, suffix), { receivedAt: 50 }).action, "stale");
    }
    assert.equal(inbox.accept(event(1, "a"), { receivedAt: 50 }).action, "duplicate");
    const refused = inbox.accept(event(1, "e"), { receivedAt: 50 });
    assert.equal(refused.action, "invalid_transition");
    assert.equal(inbox.get("sim-s").reviewEvents, 1);
  });
});

describe("timeout options are bounded at construction", () => {
  test("absurd review and screening timeouts are refused before any state exists", async () => {
    for (const reviewTimeoutSeconds of [601 * 1_000_000, 604_801, Number.MAX_SAFE_INTEGER]) {
      assert.throws(
        () => createKycSimulator({ seed: "wave58", key: freshKey(), reviewTimeoutSeconds }),
        RangeError,
        String(reviewTimeoutSeconds),
      );
    }
    for (const screeningTimeoutSeconds of [86_401, Number.MAX_SAFE_INTEGER]) {
      assert.throws(
        () => createKytSimulator({ seed: "wave58", key: freshKey(), screeningTimeoutSeconds }),
        RangeError,
        String(screeningTimeoutSeconds),
      );
    }
    const kyc = createKycSimulator({ seed: "wave58", key: freshKey(), reviewTimeoutSeconds: 604_800 });
    assert.equal(kyc.providerId, "simulator");
    const kyt = createKytSimulator({ seed: "wave58", key: freshKey(), screeningTimeoutSeconds: 86_400 });
    assert.equal(kyt.providerId, "simulator");
  });

  test("an out-of-range timeout never leaves a half-created resource", async () => {
    const simulator = createKycSimulator({
      seed: "wave58",
      key: freshKey(),
      defaultScenario: "approve",
      reviewTimeoutSeconds: 604_800,
    });
    assert.equal(simulator.pendingCallbacks(), 0);
    const submission = await simulator.submitApplicant({
      applicant_ref: "sim-applicant-1",
      level: "basic",
      idempotency_key: "idem-kyc-0001xxx",
    });
    assert.ok(submission.review_deadline);
  });
});

describe("the failed-claim counter is bounded and fails closed", () => {
  test("repeated wrong claim references eventually lock the check", async () => {
    const clock = createSimulatedClock();
    const simulator = createChecksSimulator({
      seed: "wave58",
      key: freshKey(),
      clock,
      members: MEMBERS,
      defaultScenario: "delivered",
    });
    const created = await simulator.createCheck(CHECKS_REQUEST);
    await simulator.issueCheck({
      check_id: created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0001x",
    });
    let lastError;
    for (let attempt = 1; attempt <= 26; attempt += 1) {
      try {
        await simulator.claimCheck({
          check_id: created.check_id,
          member_ref: "sim-recipient-1",
          claim_reference: `wrongref-${String(attempt).padStart(11, "0")}`,
          idempotency_key: `idem-claim-${String(attempt).padStart(5, "0")}`,
        });
      } catch (error) {
        lastError = error;
      }
    }
    assert.ok(lastError instanceof ProviderError);
    assert.equal(lastError.code, "invalid_request");
    assert.match(lastError.message, /exhausted|too many/i);
    const view = await simulator.getCheckStatus(created.check_id);
    assert.equal(view.failed_claim_attempts, 25);
    assert.equal(view.status, "created");
  });
});

describe("envelope hygiene pins", () => {
  test("mutating a payload after scheduling cannot change the signed body", () => {
    const signer = createCallbackSigner({
      key: freshKey(),
      domain: "kyc",
      random: createSeededRandom("wave58"),
    });
    const queue = new DeliveryQueue(signer);
    const payload = {
      domain: "kyc",
      environment: SIMULATOR_ENVIRONMENT,
      applicant_ref: "sim-applicant-1",
      status: "in_review",
    };
    queue.schedule(payload, 100);
    payload.applicant_ref = "sim-attacker-9";
    payload.status = "approved";
    payload.extra = "injected";
    const [delivery] = queue.drain(100);
    const body = JSON.parse(delivery.body.toString("utf8"));
    assert.equal(body.applicant_ref, "sim-applicant-1");
    assert.equal(body.status, "in_review");
    assert.equal("extra" in body, false);
  });

  test("a signer refuses payloads of another domain or environment", () => {
    const signer = createCallbackSigner({
      key: freshKey(),
      domain: "kyc",
      random: createSeededRandom("wave58"),
    });
    assert.throws(
      () => signer.sign({ domain: "bank", environment: SIMULATOR_ENVIRONMENT }, 100),
      TypeError,
    );
    assert.throws(
      () => signer.sign({ domain: "kyc", environment: "production" }, 100),
      TypeError,
    );
  });
});
