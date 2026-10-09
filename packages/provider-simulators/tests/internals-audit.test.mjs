import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canonicalStringify,
  createBankCallbackVerifier,
  createBankSimulator,
  createCallbackSigner,
  createChecksCallbackVerifier,
  createChecksSimulator,
  createKycCallbackInbox,
  createNonceStore,
  createSeededRandom,
  createSimulatedClock,
  SIMULATOR_ENVIRONMENT,
  validateChecksCallback,
} from "../src/index.mjs";
import { DeliveryQueue } from "../src/simulator-core.mjs";
import { freshKey, keyringOf, nextNonce, signRaw } from "./helpers.mjs";

/**
 * Regression tests for the wave-38 internals audit. Every case exercises a
 * defect that existed inside the simulator package (validators, inbox,
 * delivery queue, bank math) rather than cross-domain behavior, which the
 * conformance suite already covers.
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
  idempotency_key: "idem-check-0001",
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

async function checksDelivery({ key, request = CHECKS_REQUEST, issue = true } = {}) {
  const clock = createSimulatedClock();
  const simulator = createChecksSimulator({
    seed: "internals-audit",
    key,
    clock,
    members: MEMBERS,
    defaultScenario: "delivered",
  });
  const created = await simulator.createCheck(request);
  if (issue) {
    await simulator.issueCheck({
      check_id: created.check_id,
      member_ref: "sim-sender-1",
      idempotency_key: "idem-issue-0001",
    });
  }
  clock.advance(60);
  return { deliveries: simulator.drainCallbacks(), created };
}

describe("checks callback validator internals", () => {
  test("a closed status cannot report an outstanding amount", async () => {
    const key = freshKey();
    const { deliveries } = await checksDelivery({ key });
    const createdPayload = JSON.parse(deliveries.at(-1).body.toString("utf8"));
    assert.equal(createdPayload.status, "created");
    assert.equal(validateChecksCallback(createdPayload), null);
    for (const status of ["awaiting_confirmation", "claimed", "cancelled", "expired"]) {
      for (const outstanding of ["25.000000", "5.000000", "0.000001"]) {
        const forged = { ...createdPayload, status, outstanding_amount: outstanding };
        assert.match(
          validateChecksCallback(forged),
          /outstanding/,
          `${status} with outstanding ${outstanding} must be rejected`,
        );
      }
    }
    assert.equal(
      validateChecksCallback({ ...createdPayload, status: "claimed", outstanding_amount: "0.000000" }),
      null,
    );
  });

  test("a correctly signed forged closed-status payload is rejected end to end", async () => {
    const key = freshKey();
    const { deliveries } = await checksDelivery({ key });
    const createdPayload = JSON.parse(deliveries.at(-1).body.toString("utf8"));
    const forgedBody = canonicalStringify({
      ...createdPayload,
      status: "claimed",
      outstanding_amount: "5.000000",
    });
    const signed = signRaw({ key, domain: "checks", body: forgedBody, timestamp: 1_767_225_600, nonce: nextNonce() });
    const verify = createChecksCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
    assert.equal(
      verify({ headers: signed.headers, body: signed.body, now: 1_767_225_600 }).reason,
      "invalid_payload",
    );
  });

  test("sender and recipient must differ in callback payloads too", async () => {
    const key = freshKey();
    const { deliveries } = await checksDelivery({ key });
    const payload = JSON.parse(deliveries.at(-1).body.toString("utf8"));
    assert.match(
      validateChecksCallback({ ...payload, recipient_ref: payload.sender_ref }),
      /differ/,
    );
    assert.match(
      validateChecksCallback({ ...payload, sender_ref: payload.recipient_ref }),
      /differ/,
    );
    assert.equal(validateChecksCallback(payload), null);
  });
});

describe("bank partial-payment internals", () => {
  const intent = (amount) => ({
    intent_ref: "sim-intent-1",
    amount,
    currency: "RUB",
    method: "sbp",
    idempotency_key: "idem-bank-0001",
  });

  test("a partial payment below two minor units fails closed instead of emitting an invalid callback", async () => {
    const clock = createSimulatedClock();
    const simulator = createBankSimulator({
      seed: "internals-audit",
      key: freshKey(),
      clock,
      defaultScenario: "partial_payment",
    });
    await assert.rejects(
      simulator.createPaymentIntent(intent("0.01")),
      (error) => error.code === "invalid_request" && /partial/.test(error.message),
    );
    assert.equal(simulator.pendingCallbacks(), 0);
  });

  test("the smallest representable partial payment stays self-consistent", async () => {
    const key = freshKey();
    const clock = createSimulatedClock();
    const simulator = createBankSimulator({
      seed: "internals-audit",
      key,
      clock,
      defaultScenario: "partial_payment",
    });
    const created = await simulator.createPaymentIntent(intent("0.02"));
    clock.advance(600);
    const [delivery] = simulator.drainCallbacks();
    const verify = createBankCallbackVerifier({ keyring: keyringOf(key), nonceStore: createNonceStore() });
    const verified = verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt });
    assert.equal(verified.ok, true, verified.ok ? "" : verified.reason);
    assert.equal(verified.payload.status, "partial_payment");
    assert.equal(verified.payload.paid_amount, "0.01");
    const status = await simulator.getPaymentStatus(created.intent_id);
    assert.equal(status.received_total, "0.01");
  });
});

describe("callback inbox internals", () => {
  test("a malformed received time fails closed instead of bypassing the deadline", () => {
    const inbox = createKycCallbackInbox();
    inbox.openSubject(SUBJECT, { deadline: 100 });
    for (const receivedAt of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, "now"]) {
      assert.throws(
        () => inbox.accept({ ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000099" }, { receivedAt }),
        RangeError,
        String(receivedAt),
      );
    }
    assert.equal(inbox.get(SUBJECT).status, "submitted");
    assert.equal(
      inbox.accept({ ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000098" }, { receivedAt: 101 }).action,
      "late",
    );
    assert.equal(inbox.accept({ ...KYC_EVENT, event_id: "kycevt_00000000000000000000000000000097" }, { receivedAt: 50 }).action, "applied");
  });

  test("a malformed sequence is held for review, never applied", () => {
    const bad = [Number.NaN, 1.5, "1", 0, -1, 1001, null, undefined];
    for (const [index, sequence] of bad.entries()) {
      const inbox = createKycCallbackInbox();
      inbox.openSubject(SUBJECT, { deadline: 10_000 });
      const result = inbox.accept(
        { ...KYC_EVENT, sequence, event_id: `kycevt_${String(index).padStart(32, "0")}` },
        { receivedAt: 100 },
      );
      assert.equal(result.action, "invalid_transition", JSON.stringify(sequence));
      const state = inbox.get(SUBJECT);
      assert.equal(state.status, "submitted");
      assert.equal(state.sequence, 0);
      assert.equal(state.reviewEvents, 1);
    }
  });

  test("event content that cannot be hashed is held for review instead of throwing", () => {
    const inbox = createKycCallbackInbox();
    inbox.openSubject(SUBJECT, { deadline: 10_000 });
    for (const payload of [
      { ...KYC_EVENT, sequence: 1, status: 1.5 },
      { ...KYC_EVENT, sequence: 1, extra: Number.NaN },
      { ...KYC_EVENT, sequence: 1, attempt: Number.POSITIVE_INFINITY },
    ]) {
      const result = inbox.accept(payload, { receivedAt: 100 });
      assert.equal(result.action, "invalid_transition", JSON.stringify(payload.status));
    }
    const state = inbox.get(SUBJECT);
    assert.equal(state.status, "submitted");
    assert.equal(state.reviewEvents, 3);
  });

  test("a non-object payload is refused outright", () => {
    const inbox = createKycCallbackInbox();
    inbox.openSubject(SUBJECT, { deadline: 10_000 });
    for (const payload of ["garbage", 42, null, [KYC_EVENT]]) {
      assert.throws(() => inbox.accept(payload, { receivedAt: 100 }), TypeError);
    }
    assert.equal(inbox.get(SUBJECT).status, "submitted");
  });

  test("a malformed expiry clock fails closed", () => {
    const inbox = createKycCallbackInbox();
    inbox.openSubject(SUBJECT, { deadline: 50 });
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assert.throws(() => inbox.expire(now), RangeError, String(now));
    }
    assert.equal(inbox.get(SUBJECT).timedOut, false);
    assert.deepEqual(inbox.expire(51), [SUBJECT]);
  });
});

describe("delivery queue internals", () => {
  test("a malformed delivery or drain time fails closed without dropping pending work", () => {
    const signer = createCallbackSigner({
      key: freshKey(),
      domain: "kyc",
      random: createSeededRandom("internals-audit"),
    });
    const queue = new DeliveryQueue(signer);
    const payload = { domain: "kyc", environment: SIMULATOR_ENVIRONMENT };
    assert.throws(() => queue.schedule(payload, Number.NaN), RangeError);
    assert.throws(() => queue.schedule(payload, 1.5), RangeError);
    assert.throws(() => queue.schedule(payload, -1), RangeError);
    assert.equal(queue.size(), 0);
    queue.schedule(payload, 100);
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assert.throws(() => queue.drain(now), RangeError, String(now));
    }
    assert.equal(queue.size(), 1, "pending deliveries survive a rejected drain");
    assert.equal(queue.drain(100).length, 1);
    assert.equal(queue.size(), 0);
  });
});
