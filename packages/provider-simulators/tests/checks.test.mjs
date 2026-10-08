import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertProviderAdapter,
  CHECKS_SCENARIOS,
  createChecksCallbackInbox,
  createChecksCallbackVerifier,
  createChecksSimulator,
  createNonceStore,
  createSimulatedClock,
  validateChecksCallback,
} from "../src/index.mjs";
import { epochOf, freshKey, keyringOf } from "./helpers.mjs";

const MEMBERS = {
  "sim-sender-1": { kyc_verified: true },
  "sim-recipient-1": { kyc_verified: true },
  "sim-unverified-1": { kyc_verified: false },
};
const base = {
  check_ref: "sim-check-1",
  check_type: "personal",
  sender_ref: "sim-sender-1",
  recipient_ref: "sim-recipient-1",
  amount: "25.000000",
  asset: "USDT",
  claim_reference: "claimref-0000000000000001",
  idempotency_key: "idem-check-0001",
};
const GRACE = 300;
const TTL = 259_200;

const open = async ({ scenario = "delivered", members = MEMBERS, request = {}, key = freshKey(), seed = "seed-1", options = {} } = {}) => {
  const clock = createSimulatedClock();
  const simulator = createChecksSimulator({
    seed,
    key,
    clock,
    members,
    defaultScenario: scenario,
    ...options,
  });
  const verify = createChecksCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
  const inbox = createChecksCallbackInbox();
  const created = await simulator.createCheck({ ...base, ...request });
  inbox.openSubject(created.check_id, { deadline: epochOf(created.expires_at) + GRACE });
  return { simulator, verify, inbox, clock, created };
};

const collect = async ({ simulator, verify, inbox }) => {
  const steps = [];
  for (const delivery of simulator.drainCallbacks()) {
    const verified = verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt });
    if (!verified.ok) {
      steps.push({ verified: false, reason: verified.reason });
      continue;
    }
    const result = inbox.accept(verified.payload, { receivedAt: delivery.deliverAt });
    steps.push({ verified: true, status: verified.payload.status, action: result.action, payload: verified.payload });
  }
  return steps;
};

const trace = (steps) => steps.map((step) => `${step.status}:${step.action}`);

describe("checks simulator lifecycle", () => {
  test("covers callback delivery scenarios", () => {
    assert.deepEqual(Object.keys(CHECKS_SCENARIOS), [
      "delivered",
      "duplicate_callback",
      "late_callback",
      "silent_callback",
      "provider_outage",
    ]);
  });

  test("adapter contract", async () => {
    const { simulator } = await open();
    assert.equal(assertProviderAdapter("checks", simulator), true);
    assert.throws(
      () => assertProviderAdapter("checks", { ...simulator, settleCheck: () => {} }),
      /must not expose settleCheck/,
    );
    assert.throws(
      () => assertProviderAdapter("checks", { providerId: "simulator" }),
      /must implement previewCheck/,
    );
  });

  test("preview computes terms without creating a check", async () => {
    const { simulator, created } = await open();
    const preview = await simulator.previewCheck({
      check_type: "personal",
      sender_ref: "sim-sender-1",
      recipient_ref: "sim-recipient-1",
      amount: "25.000000",
      asset: "USDT",
    });
    assert.deepEqual(preview, {
      check_type: "personal",
      recipient_ref: "sim-recipient-1",
      amount: "25.000000",
      asset: "USDT",
      fee_amount: "0.000000",
      preview_reference: preview.preview_reference,
      expires_at: preview.expires_at,
      posting: "none",
    });
    assert.match(preview.preview_reference, /^chkref_[0-9a-f]{32}$/);
    assert.equal(epochOf(preview.expires_at) - epochOf(created.created_at), TTL);
    await assert.rejects(simulator.getCheckStatus("chk_missing"), (error) => error.code === "not_found");
    assert.equal(simulator.pendingCallbacks(), 1);
  });

  test("create → sender confirm → recipient claim", async () => {
    const run = await open();
    assert.equal(run.created.status, "awaiting_confirmation");
    assert.equal(run.created.outstanding_amount, "0.000000");
    assert.equal(run.created.resolved_at, null);
    assert.deepEqual(trace(await collect(run)), ["awaiting_confirmation:applied"]);

    const issued = await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0001",
    });
    assert.equal(issued.status, "created");
    assert.equal(issued.outstanding_amount, "25.000000");
    assert.deepEqual(trace(await collect(run)), ["created:applied"]);

    const claimed = await run.simulator.claimCheck({
      check_id: run.created.check_id,
      member_ref: "sim-recipient-1",
      claim_reference: base.claim_reference,
      idempotency_key: "idem-claim-0001",
    });
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.outstanding_amount, "0.000000");
    assert.equal(claimed.posting, "none");
    assert.ok(claimed.resolved_at);
    assert.deepEqual(trace(await collect(run)), ["claimed:applied"]);
    assert.equal(run.inbox.get(run.created.check_id).status, "claimed");
    for (const step of await collect(run)) {
      assert.equal(step.payload.posting, "none");
    }
  });

  test("sender cancels before confirmation", async () => {
    const run = await open();
    await collect(run);
    const cancelled = await run.simulator.cancelCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-cancel-0001",
    });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.outstanding_amount, "0.000000");
    assert.deepEqual(trace(await collect(run)), ["cancelled:applied"]);
  });

  test("sender cancels a confirmed check and the outstanding amount clears", async () => {
    const run = await open();
    await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0002",
    });
    await collect(run);
    const cancelled = await run.simulator.cancelCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-cancel-0002",
    });
    assert.deepEqual(
      [cancelled.status, cancelled.outstanding_amount],
      ["cancelled", "0.000000"],
    );
    assert.deepEqual(trace(await collect(run)), ["cancelled:applied"]);
    await assert.rejects(
      run.simulator.claimCheck({
        check_id: run.created.check_id,
        member_ref: "sim-recipient-1",
        claim_reference: base.claim_reference,
        idempotency_key: "idem-claim-0002",
      }),
      (error) => error.code === "invalid_request" && /cancelled/.test(error.message),
    );
  });

  test("unverified recipient parks the check in awaiting_recipient_kyc", async () => {
    const run = await open({ request: { recipient_ref: "sim-unverified-1" } });
    await collect(run);
    const issued = await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0003",
    });
    assert.equal(issued.status, "awaiting_recipient_kyc");
    assert.equal(issued.outstanding_amount, "25.000000");
    assert.deepEqual(trace(await collect(run)), ["awaiting_recipient_kyc:applied"]);
    await assert.rejects(
      run.simulator.claimCheck({
        check_id: run.created.check_id,
        member_ref: "sim-unverified-1",
        claim_reference: base.claim_reference,
        idempotency_key: "idem-claim-0003",
      }),
      (error) => error.code === "invalid_request" && /KYC/.test(error.message),
    );
    const cancelled = await run.simulator.cancelCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-cancel-0003",
    });
    assert.equal(cancelled.status, "cancelled");
  });

  test("unclaimed checks expire and return the outstanding amount", async () => {
    const run = await open();
    await collect(run);
    run.clock.advance(TTL + 1);
    const status = await run.simulator.getCheckStatus(run.created.check_id);
    assert.equal(status.status, "expired");
    assert.equal(status.outstanding_amount, "0.000000");
    assert.equal(status.resolved_at, status.expires_at);
    assert.deepEqual(trace(await collect(run)), ["expired:applied"]);
    await assert.rejects(
      run.simulator.issueCheck({
        check_id: run.created.check_id,
        member_ref: "sim-sender-1",
        idempotency_key: "idem-issue-0004",
      }),
      (error) => error.code === "invalid_request" && /expired/.test(error.message),
    );
  });

  test("claim after expiry is refused", async () => {
    const run = await open();
    await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0005",
    });
    run.clock.advance(TTL + 1);
    await assert.rejects(
      run.simulator.claimCheck({
        check_id: run.created.check_id,
        member_ref: "sim-recipient-1",
        claim_reference: base.claim_reference,
        idempotency_key: "idem-claim-0005",
      }),
      (error) => error.code === "invalid_request" && /expired/.test(error.message),
    );
    const status = await run.simulator.getCheckStatus(run.created.check_id);
    assert.equal(status.status, "expired");
  });

  test("claim requires the claim reference", async () => {
    const run = await open();
    await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0006",
    });
    await assert.rejects(
      run.simulator.claimCheck({
        check_id: run.created.check_id,
        member_ref: "sim-recipient-1",
        claim_reference: "claimref-9999999999999999",
        idempotency_key: "idem-claim-0006",
      }),
      (error) => error.code === "invalid_request" && /claim reference/.test(error.message),
    );
    assert.equal((await run.simulator.getCheckStatus(run.created.check_id)).failed_claim_attempts, 1);
    const claimed = await run.simulator.claimCheck({
      check_id: run.created.check_id,
      member_ref: "sim-recipient-1",
      claim_reference: base.claim_reference,
      idempotency_key: "idem-claim-0007",
    });
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.failed_claim_attempts, 1);
  });

  test("only the sender confirms or cancels; only the recipient claims", async () => {
    const run = await open();
    await assert.rejects(
      run.simulator.issueCheck({
        check_id: run.created.check_id,
        member_ref: "sim-recipient-1",
        idempotency_key: "idem-issue-0007",
      }),
      (error) => error.code === "invalid_request" && /sender/.test(error.message),
    );
    await assert.rejects(
      run.simulator.cancelCheck({
        check_id: run.created.check_id,
        member_ref: "sim-recipient-1",
        idempotency_key: "idem-cancel-0007",
      }),
      (error) => error.code === "invalid_request" && /sender/.test(error.message),
    );
    await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0008",
    });
    await assert.rejects(
      run.simulator.claimCheck({
        check_id: run.created.check_id,
        member_ref: "sim-sender-1",
        claim_reference: base.claim_reference,
        idempotency_key: "idem-claim-0008",
      }),
      (error) => error.code === "invalid_request" && /recipient/.test(error.message),
    );
  });
});

describe("checks validation", () => {
  test("personal checks only: bearer and multi-claim are refused", async () => {
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "delivered" });
    for (const check_type of ["bearer", "multi_claim", "personal_bearer"]) {
      await assert.rejects(
        simulator.createCheck({ ...base, check_type }),
        (error) => error.code === "invalid_request",
        check_type,
      );
      await assert.rejects(
        simulator.previewCheck({
          check_type,
          sender_ref: "sim-sender-1",
          recipient_ref: "sim-recipient-1",
          amount: "25.000000",
          asset: "USDT",
        }),
        (error) => error.code === "invalid_request",
        check_type,
      );
    }
    assert.equal(simulator.pendingCallbacks(), 0);
  });

  test("non-synthetic references are refused", async () => {
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "delivered" });
    const bad = [
      { check_ref: "order-1" },
      { sender_ref: "user-1" },
      { recipient_ref: "+15551234567" },
      { sender_ref: "sim-sender-1@telegram" },
    ];
    for (const overrides of bad) {
      await assert.rejects(
        simulator.createCheck({ ...base, ...overrides }),
        (error) => error.code === "invalid_request",
        JSON.stringify(overrides),
      );
    }
    await assert.rejects(
      simulator.issueCheck({ check_id: "chk_0000000000000000000000000000000a", member_ref: "customer-1", idempotency_key: "idem-issue-x" }),
      (error) => error.code === "invalid_request",
    );
    await assert.rejects(
      simulator.getCheckStatus("not a check"),
      (error) => error.code === "invalid_request",
    );
  });

  test("unknown members are refused", async () => {
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "delivered" });
    for (const overrides of [
      { sender_ref: "sim-stranger-1" },
      { recipient_ref: "sim-stranger-1" },
    ]) {
      await assert.rejects(
        simulator.createCheck({ ...base, ...overrides }),
        (error) => error.code === "invalid_request" && /unknown member/.test(error.message),
        JSON.stringify(overrides),
      );
    }
    const created = await simulator.createCheck(base);
    for (const command of [
      simulator.claimCheck({ check_id: created.check_id, member_ref: "sim-stranger-1", claim_reference: base.claim_reference, idempotency_key: "idem-claim-x" }),
      simulator.cancelCheck({ check_id: created.check_id, member_ref: "sim-stranger-1", idempotency_key: "idem-cancel-x" }),
      simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-stranger-1", idempotency_key: "idem-issue-x" }),
    ]) {
      await assert.rejects(command, (error) => error.code === "invalid_request" && /unknown member/.test(error.message));
    }
  });

  test("amounts are exact decimal strings and assets are USDT or TON", async () => {
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "delivered" });
    const bad = [
      { amount: 25 },
      { amount: "25" },
      { amount: "25.0000000" },
      { amount: "0.000000" },
      { amount: "-1.000000" },
      { amount: "25.000000", asset: "RUB" },
      { asset: "BTC" },
      { claim_reference: "short" },
      { comment: 42 },
      { extra: "field" },
    ];
    for (const overrides of bad) {
      await assert.rejects(
        simulator.createCheck({ ...base, ...overrides }),
        (error) => error.code === "invalid_request",
        JSON.stringify(overrides),
      );
    }
  });

  test("idempotent replay on every command; conflicts fail closed", async () => {
    const run = await open();
    const replayed = await run.simulator.createCheck(base);
    assert.deepEqual(replayed, run.created);
    assert.equal(run.simulator.pendingCallbacks(), 1);
    await assert.rejects(
      run.simulator.createCheck({ ...base, amount: "30.000000" }),
      (error) => error.code === "idempotency_conflict",
    );

    const issueRequest = { check_id: run.created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0009" };
    const issued = await run.simulator.issueCheck(issueRequest);
    assert.deepEqual(await run.simulator.issueCheck(issueRequest), issued);
    assert.equal((await run.simulator.getCheckStatus(run.created.check_id)).sequence, 2);
    await assert.rejects(
      run.simulator.issueCheck({ ...issueRequest, member_ref: "sim-recipient-1" }),
      (error) => error.code === "idempotency_conflict",
    );

    const claimRequest = {
      check_id: run.created.check_id,
      member_ref: "sim-recipient-1",
      claim_reference: base.claim_reference,
      idempotency_key: "idem-claim-0009",
    };
    const claimed = await run.simulator.claimCheck(claimRequest);
    const claimedAgain = await run.simulator.claimCheck(claimRequest);
    assert.deepEqual(claimedAgain, claimed);
    assert.equal(claimedAgain.status, "claimed");
    assert.equal((await run.simulator.getCheckStatus(run.created.check_id)).sequence, 3);
    await assert.rejects(
      run.simulator.claimCheck({ ...claimRequest, claim_reference: "claimref-9999999999999999" }),
      (error) => error.code === "idempotency_conflict",
    );
    await assert.rejects(
      run.simulator.cancelCheck({ check_id: run.created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-cancel-0009" }),
      (error) => error.code === "invalid_request" && /claimed/.test(error.message),
    );
  });

  test("same command id cannot double-claim or double-cancel", async () => {
    const run = await open();
    const cancelRequest = { check_id: run.created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-cancel-0010" };
    const cancelled = await run.simulator.cancelCheck(cancelRequest);
    assert.deepEqual(await run.simulator.cancelCheck(cancelRequest), cancelled);
    const statuses = (await collect(run)).map((step) => step.status);
    assert.deepEqual(statuses, ["awaiting_confirmation", "cancelled"]);
  });

  test("scenario resolution and outage", async () => {
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS });
    assert.throws(
      () => simulator.scenarioFor("sim-check-9"),
      (error) => error.code === "scenario_not_configured",
    );
    await assert.rejects(
      simulator.createCheck(base),
      (error) => error.code === "scenario_not_configured",
    );
    const outage = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "provider_outage" });
    await assert.rejects(
      outage.createCheck(base),
      (error) => error.code === "provider_unavailable" && error.retryable,
    );
    assert.equal(outage.pendingCallbacks(), 0);
    assert.throws(
      () => createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "bogus" }),
      TypeError,
    );
  });

  test("option validation: members, ttl", () => {
    for (const members of [undefined, {}, { "user-1": { kyc_verified: true } }, { "sim-a-1": {} }, { "sim-a-1": { kyc_verified: "yes" } }, []]) {
      assert.throws(
        () => createChecksSimulator({ seed: "seed-1", key: freshKey(), members, defaultScenario: "delivered" }),
        TypeError,
      );
    }
    for (const checkTtlSeconds of [59, 604_801, 1.5]) {
      assert.throws(
        () => createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "delivered", checkTtlSeconds }),
        RangeError,
      );
    }
  });
});

describe("checks callbacks", () => {
  test("duplicate callback re-delivers the same event once", async () => {
    const run = await open({ scenario: "duplicate_callback" });
    run.clock.advance(300);
    assert.deepEqual(trace(await collect(run)), ["awaiting_confirmation:applied", "awaiting_confirmation:duplicate"]);
  });

  test("late callback is held for review past the deadline", async () => {
    const run = await open({ scenario: "late_callback" });
    assert.equal(run.simulator.pendingCallbacks(), 1);
    assert.deepEqual(await collect(run), []);
    run.clock.advance(TTL + GRACE + 1300);
    const steps = await collect(run);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].action, "late");
    assert.equal(run.inbox.get(run.created.check_id).status, "registered");
    assert.ok(epochOf(steps[0].payload.occurred_at) < epochOf(run.created.expires_at));
  });

  test("silent callback keeps state without deliveries", async () => {
    const run = await open({ scenario: "silent_callback" });
    assert.equal(run.simulator.pendingCallbacks(), 0);
    const issued = await run.simulator.issueCheck({
      check_id: run.created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0011",
    });
    assert.equal(issued.status, "created");
    assert.equal(run.simulator.pendingCallbacks(), 0);
    assert.equal((await run.simulator.getCheckStatus(run.created.check_id)).sequence, 2);
  });

  test("callback validator enforces the checks envelope", async () => {
    const run = await open();
    const steps = await collect(run);
    const payload = steps[0].payload;
    assert.equal(validateChecksCallback(payload), null);
    assert.match(validateChecksCallback({ ...payload, schema: "x" }), /schema/);
    assert.match(validateChecksCallback({ ...payload, check_type: "bearer" }), /check_type/);
    assert.match(validateChecksCallback({ ...payload, posting: "ledger" }), /posting/);
    assert.match(validateChecksCallback({ ...payload, check_ref: "user-1" }), /member/);
    assert.match(validateChecksCallback({ ...payload, sender_ref: "user-1" }), /member/);
    assert.match(validateChecksCallback({ ...payload, status: "settled" }), /status/);
    assert.match(validateChecksCallback({ ...payload, asset: "BTC" }), /asset/);
    assert.match(validateChecksCallback({ ...payload, amount: "25" }), /amount/);
    assert.match(validateChecksCallback({ ...payload, fee_amount: "0.000001" }), /fee/);
    assert.match(validateChecksCallback({ ...payload, outstanding_amount: "25.000000" }), /outstanding/);
    assert.match(validateChecksCallback({ ...payload, sequence: 0 }), /sequence/);
    assert.match(validateChecksCallback({ ...payload, extra: 1 }), /members/);
  });
});

describe("checks determinism", () => {
  const transcript = async ({ key, seed }) => {
    const clock = createSimulatedClock();
    const simulator = createChecksSimulator({ seed, key, clock, members: MEMBERS, defaultScenario: "delivered" });
    const responses = [];
    const preview = await simulator.previewCheck({
      check_type: "personal",
      sender_ref: "sim-sender-1",
      recipient_ref: "sim-recipient-1",
      amount: "25.000000",
      asset: "USDT",
    });
    responses.push(preview);
    const created = await simulator.createCheck(base);
    responses.push(created);
    responses.push(await simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0012" }));
    responses.push(await simulator.claimCheck({ check_id: created.check_id, member_ref: "sim-recipient-1", claim_reference: base.claim_reference, idempotency_key: "idem-claim-0012" }));
    responses.push(await simulator.getCheckStatus(created.check_id));
    const deliveries = simulator.drainCallbacks().map((delivery) => ({
      headers: delivery.headers,
      body: delivery.body.toString("utf8"),
      deliverAt: delivery.deliverAt,
    }));
    return { responses, deliveries };
  };

  test("same seed and key produce byte-identical transcripts", async () => {
    const key = freshKey();
    const first = await transcript({ key, seed: "seed-1" });
    const second = await transcript({ key, seed: "seed-1" });
    assert.deepEqual(second, first);
  });

  test("a different seed changes identifiers but not shapes; a new key only re-signs", async () => {
    const key = freshKey();
    const first = await transcript({ key, seed: "seed-1" });
    const otherSeed = await transcript({ key, seed: "seed-2" });
    assert.notDeepEqual(otherSeed, first);
    const otherKey = await transcript({ key: freshKey("ed25519", "sim-key-2"), seed: "seed-1" });
    assert.notDeepEqual(otherKey.deliveries.map((d) => d.headers), first.deliveries.map((d) => d.headers));
    assert.deepEqual(otherKey.deliveries.map((d) => d.body), first.deliveries.map((d) => d.body));
  });
});
