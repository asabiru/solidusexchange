import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BANK_SCENARIOS,
  createBankCallbackInbox,
  createBankCallbackVerifier,
  createBankSimulator,
  createSimulatedClock,
  parseAmount,
  validateBankCallback,
} from "../src/index.mjs";
import { epochOf, freshKey, runFlow } from "./helpers.mjs";

const base = { intent_ref: "sim-intent-1", amount: "1500.00", currency: "RUB", method: "sbp", idempotency_key: "idem-bank-0001" };
const GRACE = 300;

const flow = (scenario, overrides = {}) =>
  runFlow({
    createSimulator: createBankSimulator,
    createVerifier: createBankCallbackVerifier,
    createInbox: createBankCallbackInbox,
    request: { method: "createPaymentIntent", body: { ...base, ...overrides } },
    scenario,
    subjectOf: (response) => response.intent_id,
    deadlineOf: (response) => epochOf(response.expires_at) + GRACE,
  });

const trace = (steps) => steps.map((step) => `${step.status}:${step.action}`);

describe("RUB/SBP bank simulator scenarios", () => {
  test("covers payment and delivery scenarios", () => {
    assert.deepEqual(Object.keys(BANK_SCENARIOS), [
      "payment_found", "payment_not_found", "partial_payment", "duplicate_payment", "reversed_payment",
      "provider_outage", "duplicate_callback", "out_of_order_callback", "late_callback",
    ]);
  });

  test("intent is a synthetic record with no ledger effect", async () => {
    const run = await flow("payment_found");
    assert.equal(run.response.status, "awaiting_payment");
    assert.equal(run.response.posting, "none");
    assert.match(run.response.payment_reference, /^SIMSBP[0-9A-F]{12}$/);
    assert.equal(epochOf(run.response.expires_at) - epochOf(run.response.created_at), 900);
    for (const step of run.steps) {
      assert.equal(step.payload.posting, "none");
    }
  });

  test("payment found", async () => {
    const run = await flow("payment_found");
    assert.deepEqual(trace(run.steps), ["payment_received:applied"]);
    assert.equal(run.steps[0].payload.paid_amount, "1500.00");
    const status = await run.simulator.getPaymentStatus(run.subject);
    assert.deepEqual({ status: status.status, received: status.received_total, reversed: status.reversed_total }, { status: "payment_received", received: "1500.00", reversed: "0.00" });
  });

  test("payment not found expires without a transaction", async () => {
    const run = await flow("payment_not_found");
    assert.deepEqual(trace(run.steps), ["expired_no_payment:applied"]);
    assert.equal(run.steps[0].payload.paid_amount, "0.00");
    assert.equal(run.steps[0].payload.bank_transaction_id, null);
    assert.equal(run.state.status, "expired_no_payment");
  });

  test("partial payment is below the expected amount", async () => {
    const run = await flow("partial_payment", { amount: "1000.01" });
    const paid = parseAmount("RUB", run.steps[0].payload.paid_amount);
    assert.ok(paid > 0n && paid < 100001n);
    assert.equal(run.state.status, "partial_payment");
    assert.deepEqual(run.expired, [run.subject], "an unresolved underpayment times out for review");
  });

  test("duplicate payment is a second incoming transfer referencing the first", async () => {
    const run = await flow("duplicate_payment");
    assert.deepEqual(trace(run.steps), ["payment_received:applied", "duplicate_payment:applied"]);
    const [first, second] = run.steps.map((step) => step.payload);
    assert.notEqual(second.bank_transaction_id, first.bank_transaction_id);
    assert.equal(second.related_transaction_id, first.bank_transaction_id);
    assert.equal((await run.simulator.getPaymentStatus(run.subject)).received_total, "3000.00");
  });

  test("reversed payment", async () => {
    const run = await flow("reversed_payment");
    assert.deepEqual(trace(run.steps), ["payment_received:applied", "payment_reversed:applied"]);
    assert.equal(run.steps[1].payload.related_transaction_id, run.steps[0].payload.bank_transaction_id);
    const status = await run.simulator.getPaymentStatus(run.subject);
    assert.equal(status.status, "payment_reversed");
    assert.equal(status.reversed_total, "1500.00");
  });

  test("provider outage", async () => {
    const simulator = createBankSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "provider_outage" });
    await assert.rejects(simulator.createPaymentIntent(base), (error) => error.code === "provider_unavailable" && error.retryable);
    assert.equal(simulator.pendingCallbacks(), 0);
  });

  test("duplicate callback", async () => {
    const run = await flow("duplicate_callback");
    assert.deepEqual(trace(run.steps), ["payment_received:applied", "payment_received:duplicate"]);
  });

  test("out-of-order callback", async () => {
    const run = await flow("out_of_order_callback");
    assert.deepEqual(trace(run.steps), ["payment_reversed:buffered", "payment_received:applied"]);
    assert.equal(run.state.status, "payment_reversed");
  });

  test("late callback after expiry is held for review", async () => {
    const run = await flow("late_callback");
    assert.equal(run.steps.length, 1);
    assert.equal(run.steps[0].action, "late");
    assert.equal(run.state.status, "awaiting_payment");
    assert.ok(epochOf(run.steps[0].payload.occurred_at) > epochOf(run.response.expires_at));
  });
});

describe("bank request and callback validation", () => {
  test("only RUB over SBP with exactly two decimals", async () => {
    const simulator = createBankSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "payment_found" });
    const bad = [
      { amount: 1500 }, { amount: 1500.5 }, { amount: "1500" }, { amount: "1500.5" }, { amount: "1500.000" },
      { amount: "0.00" }, { amount: "-1.00" }, { amount: "1 500.00" }, { currency: "USD" }, { currency: "rub" },
      { method: "card" }, { intent_ref: "order-1" }, { account_number: "40817810000000000000" },
    ];
    for (const overrides of bad) {
      await assert.rejects(simulator.createPaymentIntent({ ...base, ...overrides }), (error) => error.code === "invalid_request", JSON.stringify(overrides));
    }
  });

  test("idempotency replay and conflict", async () => {
    const simulator = createBankSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "payment_found" });
    const first = await simulator.createPaymentIntent(base);
    assert.deepEqual(await simulator.createPaymentIntent({ ...base }), first);
    assert.equal(simulator.pendingCallbacks(), 1);
    await assert.rejects(simulator.createPaymentIntent({ ...base, amount: "1500.01" }), (error) => error.code === "idempotency_conflict");
    await assert.rejects(simulator.getPaymentStatus("bankint_missing"), (error) => error.code === "not_found");
    assert.throws(() => createBankSimulator({ seed: "seed-1", key: freshKey(), intentTtlSeconds: 5 }), RangeError);
  });

  test("status before any simulated event is awaiting payment", async () => {
    const clock = createSimulatedClock();
    const simulator = createBankSimulator({ seed: "seed-1", key: freshKey(), clock, defaultScenario: "payment_found" });
    const intent = await simulator.createPaymentIntent(base);
    const status = await simulator.getPaymentStatus(intent.intent_id);
    assert.deepEqual([status.status, status.sequence, status.received_total], ["awaiting_payment", 0, "0.00"]);
  });

  test("callback validator enforces amount and transaction consistency", async () => {
    const run = await flow("reversed_payment");
    const [received, reversed] = run.steps.map((step) => ({ ...step.payload }));
    assert.equal(validateBankCallback(received), null);
    assert.equal(validateBankCallback(reversed), null);
    assert.match(validateBankCallback({ ...received, paid_amount: "1499.99" }), /equal/);
    assert.match(validateBankCallback({ ...received, paid_amount: "1500.0" }), /amounts/);
    assert.match(validateBankCallback({ ...received, related_transaction_id: received.bank_transaction_id }), /related/);
    assert.match(validateBankCallback({ ...reversed, related_transaction_id: reversed.bank_transaction_id }), /related/);
    assert.match(validateBankCallback({ ...reversed, paid_amount: "1500.01" }), /reversal/);
    assert.match(validateBankCallback({ ...received, posting: "ledger" }), /posting/);
    assert.match(validateBankCallback({ ...received, currency: "USD" }), /currency/);
    assert.match(validateBankCallback({ ...received, bank_transaction_id: "TX1" }), /bank_transaction_id/);
    assert.match(validateBankCallback({ ...received, status: "settled" }), /status/);
    assert.match(validateBankCallback({ ...received, status: "partial_payment" }), /partial/);
    assert.match(validateBankCallback({ ...received, status: "expired_no_payment" }), /expired/);
    assert.match(validateBankCallback({ ...received, intent_ref: "order-1" }), /intent_ref/);
  });
});
