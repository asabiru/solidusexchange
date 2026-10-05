import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createKytCallbackInbox,
  createKytCallbackVerifier,
  createKytSimulator,
  KYT_ASSET_NETWORKS,
  KYT_SCENARIOS,
  kytBindingDigest,
  validateKytCallback,
} from "../src/index.mjs";
import { epochOf, freshKey, runFlow } from "./helpers.mjs";

const base = {
  asset: "USDT",
  network: "TRON_TESTNET",
  direction: "inbound",
  address: "sim-wallet-1",
  tx_ref: "sim-tx-1",
  amount: "250.000000",
  idempotency_key: "idem-kyt-0001",
};

const flow = (scenario, overrides = {}) =>
  runFlow({
    createSimulator: createKytSimulator,
    createVerifier: createKytCallbackVerifier,
    createInbox: createKytCallbackInbox,
    request: { method: "screenTransfer", body: Object.fromEntries(Object.entries({ ...base, ...overrides }).filter(([, value]) => value !== undefined)) },
    scenario,
    subjectOf: (response) => response.assessment_id,
    deadlineOf: (response) => epochOf(response.screening_deadline),
  });

const trace = (steps) => steps.map((step) => `${step.status}:${step.action}`);
const RANGES = { low: [0, 24], medium: [25, 49], high: [50, 74], severe: [75, 100] };

describe("KYT simulator scenarios", () => {
  test("covers risk levels, sanctions and delivery scenarios", () => {
    assert.deepEqual(Object.keys(KYT_SCENARIOS), [
      "low", "medium", "high", "severe", "sanctions_hit", "pending_timeout",
      "provider_outage", "duplicate_callback", "out_of_order_callback", "late_callback",
    ]);
  });

  for (const level of ["low", "medium", "high", "severe"]) {
    test(`${level} risk`, async () => {
      const run = await flow(level);
      assert.equal(run.response.status, "pending");
      assert.deepEqual(trace(run.steps), ["pending:applied", "completed:applied"]);
      const result = run.steps[1].payload;
      assert.equal(result.risk_level, level);
      assert.ok(result.risk_score >= RANGES[level][0] && result.risk_score <= RANGES[level][1]);
      assert.equal(result.sanctions_hit, false);
      assert.equal(result.categories.includes("SIM_SANCTIONS"), false);
      assert.equal(result.binding_digest, kytBindingDigest(result.binding));
      assert.equal((await run.simulator.getAssessment(run.subject)).risk_level, level);
    });
  }

  test("sanctions hit is severe and categorized", async () => {
    const run = await flow("sanctions_hit");
    const result = run.steps[1].payload;
    assert.equal(result.sanctions_hit, true);
    assert.equal(result.risk_level, "severe");
    assert.ok(result.categories.includes("SIM_SANCTIONS"));
    assert.deepEqual(result.categories, [...result.categories].sort());
  });

  test("pending timeout never completes and is timed out by the consumer", async () => {
    const run = await flow("pending_timeout");
    assert.deepEqual(trace(run.steps), ["pending:applied"]);
    assert.deepEqual(run.expired, [run.subject]);
    assert.equal((await run.simulator.getAssessment(run.subject)).status, "pending");
  });

  test("provider outage", async () => {
    const simulator = createKytSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "provider_outage" });
    await assert.rejects(simulator.screenTransfer(base), (error) => error.code === "provider_unavailable" && error.retryable);
    assert.equal(simulator.pendingCallbacks(), 0);
  });

  test("duplicate callback", async () => {
    const run = await flow("duplicate_callback");
    assert.deepEqual(trace(run.steps), ["pending:applied", "completed:applied", "completed:duplicate"]);
  });

  test("out-of-order callback", async () => {
    const run = await flow("out_of_order_callback");
    assert.deepEqual(trace(run.steps), ["completed:buffered", "pending:applied"]);
    assert.equal(run.state.status, "completed");
  });

  test("late callback", async () => {
    const run = await flow("late_callback");
    assert.deepEqual(trace(run.steps), ["pending:applied", "completed:late"]);
    assert.equal(run.state.status, "pending");
    assert.equal(run.state.lateEvents, 1);
  });
});

describe("KYT request binding and validation", () => {
  test("binds asset, network, direction, address, tx and amount", async () => {
    const run = await flow("low", { asset: "TON", network: "TON_TESTNET", amount: "1.500000000", direction: "outbound" });
    const binding = run.steps[1].payload.binding;
    assert.deepEqual({ ...binding }, { asset: "TON", network: "TON_TESTNET", direction: "outbound", address: "sim-wallet-1", tx_ref: "sim-tx-1", amount: "1.500000000" });
    const payload = run.steps[1].payload;
    assert.match(validateKytCallback({ ...payload, binding: { ...binding, amount: "1.600000000" } }), /digest/);
    assert.match(validateKytCallback({ ...payload, binding: { ...binding, network: "TON_MAINNET" } }), /binding/);
    assert.match(validateKytCallback({ ...payload, binding: { ...binding, extra: 1 } }), /binding/);
    assert.match(validateKytCallback({ ...payload, binding: [binding] }), /binding/);
    assert.match(validateKytCallback({ ...payload, risk_score: 99 }), /risk_score/);
    assert.match(validateKytCallback({ ...payload, sanctions_hit: true }), /sanctions/);
    assert.match(validateKytCallback({ ...payload, categories: ["UNKNOWN"] }), /categories/);
    assert.match(validateKytCallback({ ...payload, status: "done" }), /status/);
    assert.match(validateKytCallback({ ...run.steps[0].payload, risk_level: "low" }), /pending/);
    const noTx = await flow("low", { tx_ref: undefined });
    assert.equal(noTx.steps[1].payload.binding.tx_ref, null);
  });

  test("only testnet asset/network pairs with exact scales are accepted", async () => {
    assert.deepEqual(KYT_ASSET_NETWORKS.map((entry) => `${entry.asset}/${entry.network}`), ["TON/TON_TESTNET", "USDT/TON_TESTNET", "USDT/TRON_TESTNET"]);
    const simulator = createKytSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "low" });
    const bad = [
      { network: "TRON_MAINNET" },
      { network: "TON_MAINNET" },
      { asset: "TON", network: "TRON_TESTNET", amount: "1.000000000" },
      { asset: "BTC" },
      { amount: "250.00" },
      { amount: "250" },
      { amount: 250 },
      { amount: "0.000000" },
      { direction: "internal" },
      { address: "TXyz0000realLookingAddress" },
      { tx_ref: "0xdeadbeef" },
      { memo: "x" },
      { tx_ref: undefined },
    ];
    for (const overrides of bad) {
      await assert.rejects(simulator.screenTransfer({ ...base, ...overrides }), (error) => error.code === "invalid_request", JSON.stringify(overrides));
    }
  });

  test("idempotency replay and conflict", async () => {
    const simulator = createKytSimulator({ seed: "seed-1", key: freshKey(), defaultScenario: "medium" });
    const first = await simulator.screenTransfer(base);
    assert.deepEqual(await simulator.screenTransfer({ ...base }), first);
    await assert.rejects(simulator.screenTransfer({ ...base, amount: "251.000000" }), (error) => error.code === "idempotency_conflict");
    await assert.rejects(simulator.getAssessment("kytasm_missing"), (error) => error.code === "not_found");
    assert.throws(() => createKytSimulator({ seed: "seed-1", key: freshKey(), screeningTimeoutSeconds: 1 }), RangeError);
  });
});
