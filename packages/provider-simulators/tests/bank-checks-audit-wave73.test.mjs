import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createBankSimulator,
  createCallbackInbox,
  createChecksCallbackInbox,
  createChecksSimulator,
  createSimulatedClock,
  validateChecksCallback,
} from "../src/index.mjs";
import { freshKey } from "./helpers.mjs";

const MEMBERS = {
  "sim-sender-1": { kyc_verified: true },
  "sim-recipient-1": { kyc_verified: true },
  "sim-unverified-1": { kyc_verified: false },
};

const baseRequest = {
  intent_ref: "sim-intent-1",
  amount: "2500.00",
  currency: "RUB",
  method: "sbp",
  idempotency_key: "idem-bank-0001",
};

const baseCheck = {
  check_ref: "sim-check-1",
  check_type: "personal",
  sender_ref: "sim-sender-1",
  recipient_ref: "sim-recipient-1",
  amount: "25.000000",
  asset: "USDT",
  claim_reference: "claimref-0000000000000001",
  idempotency_key: "idem-check-0001",
};

const check = async (overrides = {}, options = {}) => {
  const simulator = createChecksSimulator({
    seed: "seed-1",
    key: freshKey(),
    members: MEMBERS,
    defaultScenario: "delivered",
    ...options,
  });
  const created = await simulator.createCheck({ ...baseCheck, ...overrides });
  await simulator.issueCheck({
    check_id: created.check_id,
    member_ref: "sim-sender-1",
    idempotency_key: "idem-issue-0001",
  });
  return { simulator, created };
};

const claimOf = (created, overrides = {}) => ({
  check_id: created.check_id,
  member_ref: "sim-recipient-1",
  claim_reference: "claimref-0000000000000001",
  idempotency_key: "idem-claim-0001",
  ...overrides,
});

const callbackPayload = (overrides = {}) => ({
  schema: "solidchange.sim.checks.callback.v1",
  environment: "dev-simulator",
  domain: "checks",
  event_id: "chkevt_00000000000000000000000000000001",
  check_id: "chk_0000000000000000000000000000000a",
  check_ref: "sim-check-1",
  check_type: "personal",
  sender_ref: "sim-sender-1",
  recipient_ref: "sim-recipient-1",
  sequence: 2,
  status: "created",
  amount: "1.000000",
  asset: "USDT",
  fee_amount: "0.000000",
  outstanding_amount: "1.000000",
  occurred_at: "2026-01-01T01:00:00Z",
  expires_at: "2026-01-02T00:00:00Z",
  posting: "none",
  ...overrides,
});

describe("wave73 bank audit", () => {
  test("defect: a scenario's received_total must stay inside the canonical wall", async () => {
    // Repro: duplicate_payment on a near-wall amount created the intent, then
    // getPaymentStatus threw a bare RangeError computing received_total. The
    // create now refuses up front and leaves no scheduled callbacks behind.
    const simulator = createBankSimulator({
      seed: "seed-1",
      key: freshKey(),
      defaultScenario: "duplicate_payment",
    });
    await assert.rejects(
      () => simulator.createPaymentIntent({ ...baseRequest, amount: "999999999999999999.99" }),
      { code: "invalid_request", message: "amount is too large to report for this scenario" },
    );
    assert.equal(simulator.pendingCallbacks(), 0);
    const clock = createSimulatedClock();
    const simulator2 = createBankSimulator({
      seed: "seed-1",
      key: freshKey(),
      clock,
      defaultScenario: "duplicate_payment",
    });
    const safe = await simulator2.createPaymentIntent({
      ...baseRequest,
      amount: "499999999999999999.99",
      idempotency_key: "idem-bank-0002",
    });
    clock.advance(7200);
    const status = await simulator2.getPaymentStatus(safe.intent_id);
    assert.equal(status.received_total, "999999999999999999.98");
  });

  test("defect: in-window bank events never occur after expires_at", async () => {
    // Repro: payment_reversed observed 75s past expiry on a 300s TTL intent
    // (seed-1). Every non-late scenario now clamps occurred_at to the intent's
    // validity window; late/expired scenarios keep their deliberate post-
    // expiry observation.
    const nonLate = [
      "payment_found",
      "duplicate_payment",
      "partial_payment",
      "reversed_payment",
      "duplicate_callback",
      "out_of_order_callback",
    ];
    for (const scenario of nonLate) {
      for (const seed of ["seed-1", "wave-73", "scan-0"]) {
        const clock = createSimulatedClock();
        const simulator = createBankSimulator({
          seed,
          key: freshKey(),
          clock,
          defaultScenario: scenario,
          intentTtlSeconds: 60,
        });
        const intent = await simulator.createPaymentIntent(baseRequest);
        clock.advance(7200);
        for (const delivery of simulator.drainCallbacks()) {
          const payload = JSON.parse(delivery.body.toString());
          assert.ok(
            payload.occurred_at < intent.expires_at,
            `${scenario}/${seed}: ${payload.status} at ${payload.occurred_at} past ${intent.expires_at}`,
          );
        }
      }
    }
    // Deliberately post-expiry scenarios keep their timing.
    for (const scenario of ["late_callback", "payment_not_found"]) {
      const clock = createSimulatedClock();
      const simulator = createBankSimulator({
        seed: "seed-1",
        key: freshKey(),
        clock,
        defaultScenario: scenario,
        intentTtlSeconds: 60,
      });
      const intent = await simulator.createPaymentIntent(baseRequest);
      clock.advance(7200);
      const payloads = simulator.drainCallbacks().map((d) => JSON.parse(d.body.toString()));
      assert.equal(payloads.length > 0, true);
      for (const payload of payloads) {
        assert.equal(payload.occurred_at > intent.expires_at, true);
      }
    }
  });

  test("clean: all monetary fields stay decimal-exact bigint math", async () => {
    const clock = createSimulatedClock();
    const simulator = createBankSimulator({ seed: "seed-1", key: freshKey(), clock, defaultScenario: "partial_payment" });
    const intent = await simulator.createPaymentIntent({ ...baseRequest, amount: "0.02" });
    clock.advance(7200);
    const status = await simulator.getPaymentStatus(intent.intent_id);
    assert.equal(status.expected_amount, "0.02");
    assert.match(status.received_total, /^0\.0[01]$/);
    for (const malformed of ["-1.00", "0", "0.001", "abc", "1e2", " 1.00", "1000000000000000000.00"]) {
      await assert.rejects(
        () => simulator.createPaymentIntent({ ...baseRequest, amount: malformed, idempotency_key: `idem-${malformed.length}-x` }),
        { code: "invalid_request" },
      );
    }
  });
});

describe("wave73 checks audit", () => {
  test("defect: expires_at is the first invalid instant — nothing resolves at the boundary", async () => {
    // Repro: a claim issued at exactly expires_at succeeded with
    // resolved_at === expires_at, colliding with the expired state that owns
    // that instant. The open guard is now a strict inequality.
    const clock = createSimulatedClock();
    const { simulator, created } = await check({}, { clock });
    clock.advance(259200);
    await assert.rejects(() => simulator.claimCheck(claimOf(created)), { message: "check is expired" });
    await assert.rejects(
      () => simulator.cancelCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-cancel-0001" }),
      { message: "check is expired" },
    );
    const status = await simulator.getCheckStatus(created.check_id);
    assert.equal(status.status, "expired");
    assert.equal(status.resolved_at, status.expires_at);
    // One second earlier the same operations still resolve inside the window.
    const clock2 = createSimulatedClock();
    const second = await check({ check_ref: "sim-check-2", idempotency_key: "idem-check-0002", claim_reference: "claimref-0000000000000002" }, { clock: clock2 });
    clock2.advance(259199);
    const claimed = await second.simulator.claimCheck(claimOf(second.created, { claim_reference: "claimref-0000000000000002" }));
    assert.equal(claimed.status, "claimed");
    assert.ok(claimed.resolved_at < claimed.expires_at);
  });

  test("defect: previewCheck enforces the same sender gates as createCheck", async () => {
    // Repro: previewCheck quoted terms for an unverified sender and for a
    // self-check — both impossible at create time.
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members: MEMBERS, defaultScenario: "delivered" });
    await assert.rejects(
      () => simulator.previewCheck({ check_type: "personal", sender_ref: "sim-unverified-1", recipient_ref: "sim-recipient-1", amount: "25.000000", asset: "USDT" }),
      { message: "sender is not KYC verified" },
    );
    await assert.rejects(
      () => simulator.previewCheck({ check_type: "personal", sender_ref: "sim-sender-1", recipient_ref: "sim-sender-1", amount: "25.000000", asset: "USDT" }),
      { message: "sender and recipient must differ" },
    );
    const preview = await simulator.previewCheck({ check_type: "personal", sender_ref: "sim-sender-1", recipient_ref: "sim-recipient-1", amount: "25.000000", asset: "USDT" });
    assert.match(preview.preview_reference, /^chkref_[0-9a-f]{32}$/);
  });

  test("defect: awaiting_recipient_kyc promotes once the recipient is verified", async () => {
    // Repro: the awaiting_recipient_kyc → created transition was unreachable —
    // the member map was frozen at construction. setMemberKyc is the test hook
    // a real KYC notification would play; the lazy promotion emits the created
    // transition and the claim then completes the lifecycle.
    const members = { "sim-sender-1": { kyc_verified: true }, "sim-recipient-1": { kyc_verified: false } };
    const clock = createSimulatedClock();
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), clock, members, defaultScenario: "delivered" });
    const created = await simulator.createCheck(baseCheck);
    const issued = await simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0001" });
    assert.equal(issued.status, "awaiting_recipient_kyc");
    await assert.rejects(() => simulator.claimCheck(claimOf(created)), { message: "recipient is not KYC verified" });
    simulator.setMemberKyc("sim-recipient-1", true);
    const claimed = await simulator.claimCheck(claimOf(created));
    assert.equal(claimed.status, "claimed");
    const statuses = simulator.drainCallbacks().map((d) => JSON.parse(d.body.toString()).status);
    assert.deepEqual(statuses, ["awaiting_confirmation", "awaiting_recipient_kyc", "created", "claimed"]);
    assert.equal(claimed.sequence, 4);
  });

  test("setMemberKyc validates its inputs and an unverifiable member stays parked", async () => {
    const members = { "sim-sender-1": { kyc_verified: true }, "sim-recipient-1": { kyc_verified: false } };
    const simulator = createChecksSimulator({ seed: "seed-1", key: freshKey(), members, defaultScenario: "delivered" });
    const created = await simulator.createCheck(baseCheck);
    await simulator.issueCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-issue-0001" });
    assert.throws(() => simulator.setMemberKyc("bogus", true), { code: "invalid_request" });
    assert.throws(() => simulator.setMemberKyc("sim-recipient-1", "yes"), TypeError);
    // Un-verifying a member that was never verified leaves the check parked.
    simulator.setMemberKyc("sim-recipient-1", false);
    const status = await simulator.getCheckStatus(created.check_id);
    assert.equal(status.status, "awaiting_recipient_kyc");
    // The sender can still cancel a parked check at any point.
    const cancelled = await simulator.cancelCheck({ check_id: created.check_id, member_ref: "sim-sender-1", idempotency_key: "idem-cancel-0001" });
    assert.equal(cancelled.status, "cancelled");
  });

  test("defect: a callback cannot claim an event that occurred after expiry", () => {
    // Repro: validateChecksCallback let occurred_at > expires_at through.
    assert.equal(validateChecksCallback(callbackPayload({ occurred_at: "2026-01-03T00:00:00Z" })), "an event cannot occur after the check's expiry");
    assert.equal(validateChecksCallback(callbackPayload({ occurred_at: "2026-01-02T00:00:00Z" })), null);
    assert.equal(validateChecksCallback(callbackPayload({ occurred_at: "2026-01-01T23:59:59Z" })), null);
  });

  test("clean: resolution claims stay inside the open window end to end", async () => {
    const { simulator, created } = await check();
    const claimed = await simulator.claimCheck(claimOf(created));
    assert.ok(claimed.created_at <= claimed.resolved_at && claimed.resolved_at < claimed.expires_at);
    assert.equal(claimed.outstanding_amount, "0.000000");
    assert.equal(claimed.status, "claimed");
    // The claim digest, not the reference, is stored — a second claim is impossible.
    await assert.rejects(() => simulator.claimCheck(claimOf(created, { idempotency_key: "idem-claim-0009" })), { message: "check is claimed" });
  });
});

describe("wave73 callback inbox audit", () => {
  test("defect: a conflicting claim on a resolved sequence is held for review", () => {
    // Repro: a second event claiming an already-applied or buffered sequence
    // with a different status returned "stale" — silently dropped. It is a
    // conflicting history claim and now flags review like an illegal forward
    // transition.
    const transitions = { open: ["middle", "done"], middle: ["done"], done: [] };
    const event = (sequence, status, id = "") => ({
      subject: "sim-s",
      event_id: `evt_${sequence}${id}`,
      sequence,
      status,
    });
    const inbox = createCallbackInbox({ subjectField: "subject", initialStatus: "open", transitions });
    inbox.openSubject("sim-s", { deadline: 100 });
    assert.equal(inbox.accept(event(1, "middle"), { receivedAt: 1 }).action, "applied");
    // Same resolved sequence, different status → conflicting claim.
    assert.equal(inbox.accept(event(1, "done", "b"), { receivedAt: 2 }).action, "invalid_transition");
    // Same resolved sequence, same status → benign stale.
    assert.equal(inbox.accept(event(1, "middle", "c"), { receivedAt: 2 }).action, "stale");
    // Buffered-sequence conflict.
    assert.equal(inbox.accept(event(3, "done"), { receivedAt: 3 }).action, "buffered");
    assert.equal(inbox.accept(event(3, "middle", "b"), { receivedAt: 4 }).action, "invalid_transition");
    assert.equal(inbox.accept(event(3, "done", "c"), { receivedAt: 4 }).action, "stale");
    assert.equal(inbox.get("sim-s").reviewEvents, 2);
    // The domain-specific inbox shares the receiver: same semantics.
    const checkInbox = createChecksCallbackInbox();
    checkInbox.openSubject("chk_s", { deadline: 100 });
    const payload = (sequence, status) => callbackPayload({
      check_id: "chk_s",
      sequence,
      status,
      event_id: `chkevt_${String(sequence).padStart(31, "0")}f${status[0]}`,
      outstanding_amount: status === "created" ? "1.000000" : "0.000000",
      occurred_at: "2026-01-01T00:00:00Z",
    });
    assert.equal(checkInbox.accept(payload(1, "awaiting_confirmation"), { receivedAt: 1 }).action, "applied");
    assert.equal(checkInbox.accept(payload(1, "created"), { receivedAt: 2 }).action, "invalid_transition");
  });

  test("clean: inbox bookkeeping stays bounded and exact", () => {
    const transitions = { open: ["middle", "done"], middle: ["done"], done: [] };
    const inbox = createCallbackInbox({ subjectField: "subject", initialStatus: "open", transitions });
    inbox.openSubject("sim-s", { deadline: 100 });
    inbox.accept({ subject: "sim-s", event_id: "evt_1", sequence: 1, status: "middle" }, { receivedAt: 1 });
    inbox.accept({ subject: "sim-s", event_id: "evt_2", sequence: 2, status: "done" }, { receivedAt: 2 });
    const view = inbox.get("sim-s");
    assert.deepEqual([view.status, view.sequence], ["done", 2]);
    // Internal claim memory does not leak into the public view.
    assert.equal(view.applied, undefined);
    assert.equal(view.parked, undefined);
  });
});
