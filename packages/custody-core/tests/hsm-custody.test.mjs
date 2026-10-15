import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHsmPolicyModule } from "../src/hsm-policy.mjs";
import { decodeTonTransaction, decodeTronTransaction } from "../src/tx-decoders.mjs";
import { createCustodyWatcher } from "../src/watcher.mjs";
import {
  computeIntentDigest,
  prepareUnsignedTransactionIntent,
  verifyUnsignedTransactionIntent
} from "../src/unsigned-intent.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const custodyPolicy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const hsmPolicy = JSON.parse(readFileSync(join(root, "hsm", "hsm-policy-draft.json"), "utf8"));

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const clock = () => new Date(NOW);

let sequence = 0;
function suffix() {
  sequence += 1;
  return String(sequence).padStart(6, "0");
}

function buildIntent({ amount = "10.000000", asset = "USDT", network = "TRON_TESTNET", created = NOW - 30_000, ttl = 240 } = {}) {
  const tag = suffix();
  const command = {
    amount,
    asset,
    correlation_id: `018f3a00-0000-7000-8000-${tag}0f0f0f`.slice(0, 36).padEnd(36, "0"),
    created_at: new Date(created).toISOString(),
    destination_reference: "destination_ref_synthetic_user_wallet",
    expires_at: new Date(created + ttl * 1000).toISOString(),
    idempotency_key: `custody_idempotency_${tag}`,
    intent_id: `custody_intent_${tag}`,
    legal_entity_id: "legal_entity_solidchange_dev",
    network,
    policy_version: "custody-dev-v1",
    withdrawal_id: `withdrawal_${tag}`
  };
  const intentDigest = computeIntentDigest(command, custodyPolicy);
  const makerAt = new Date(created + 5_000).toISOString();
  const checkerAt = new Date(created + 10_000).toISOString();
  const approvals = [
    {
      approval_id: `approval_${tag}_maker`,
      approved_at: makerAt,
      decision: "approved",
      evidence_digest: "a".repeat(64),
      intent_digest: intentDigest,
      role: "custody_maker",
      step_up_grant_id: `step_up_grant_${tag}_maker`,
      subject_reference: `operator_ref_maker_${tag}`
    },
    {
      approval_id: `approval_${tag}_checker`,
      approved_at: checkerAt,
      decision: "approved",
      evidence_digest: "b".repeat(64),
      intent_digest: intentDigest,
      role: "custody_checker",
      step_up_grant_id: `step_up_grant_${tag}_checker`,
      subject_reference: `operator_ref_checker_${tag}`
    }
  ];
  const intent = prepareUnsignedTransactionIntent({
    approvals,
    command,
    now: new Date(NOW),
    policy: custodyPolicy
  });
  return verifyUnsignedTransactionIntent({ intent, now: new Date(NOW), policy: custodyPolicy });
}

function tronWire({ to = "destination_ref_synthetic_user_wallet", amount = "10.000000", nonce = 7, expiry = Math.floor(NOW / 1000) + 200 } = {}) {
  return Buffer.from(
    JSON.stringify({ type: "trc20_transfer", contract: "USDT", to_address: to, amount, nonce, expiration: expiry }),
    "utf8"
  ).toString("hex");
}

function tonWire({ to = "destination_ref_synthetic_user_wallet", nano = "10500000000", seqno = 42, expiry = Math.floor(NOW / 1000) + 200 } = {}) {
  return Buffer.from(
    JSON.stringify({ type: "ton_transfer", to, amount_nano: nano, seqno, valid_until: expiry }),
    "utf8"
  ).toString("hex");
}

function createModule(tier = "hot", now = NOW) {
  return createHsmPolicyModule({
    policy: hsmPolicy,
    tier,
    custodyPolicy,
    clock: () => new Date(now)
  });
}

test("hot tier approves a policy-clean intent + matching synthetic wire", () => {
  const intent = buildIntent();
  const module = createModule("hot");
  const result = module.evaluate({ intent, transaction: { raw_payload: tronWire() } });
  assert.equal(result.decision, "approved");
  assert.equal(result.tier, "hot");
  assert.equal(result.intent_digest, intent.intent_digest);
  assert.equal(result.runtime_boundary, "dev-dry-run");
  for (const [name, passed] of Object.entries(result.checks)) {
    assert.equal(passed, true, `check ${name} must pass`);
  }
  assert.equal(typeof result.evidence_digest, "string");
  assert.equal(result.evidence_digest.length, 64);
});

test("the same intent digest cannot be evaluated twice", () => {
  const intent = buildIntent();
  const module = createModule("hot");
  const first = module.evaluate({ intent, transaction: { raw_payload: tronWire() } });
  assert.equal(first.decision, "approved");
  const replay = module.evaluate({ intent, transaction: { raw_payload: tronWire({ nonce: 8 }) } });
  assert.equal(replay.decision, "rejected");
  assert.equal(replay.reason, "intent_replayed");
});

test("unlisted destination, limits and velocity fail closed", () => {
  const intent = buildIntent();
  const module = createModule("hot");
  const offList = module.evaluate({
    intent: {
      ...buildIntent(),
      command: {
        ...buildIntent().command,
        destination_reference: "destination_ref_not_allowlisted"
      }
    },
    transaction: { raw_payload: tronWire() }
  });
  // The swapped command carries a stale digest binding — quorum check fails
  // before the allowlist arm.
  assert.equal(offList.decision, "rejected");
  assert.equal(offList.reason, "quorum_not_bound");

  const tooBig = buildIntent({ amount: "6000.000000" });
  const overLimit = module.evaluate({ intent: tooBig, transaction: { raw_payload: tronWire({ amount: "6000.000000", nonce: 9 }) } });
  assert.equal(overLimit.decision, "rejected");
  assert.equal(overLimit.reason, "per_transaction_limit_exceeded");

  const module2 = createModule("hot");
  for (let i = 0; i < 4; i++) {
    const ok = module2.evaluate({
      intent: buildIntent({ amount: "5000.000000" }),
      transaction: { raw_payload: tronWire({ amount: "5000.000000", nonce: 20 + i }) }
    });
    assert.equal(ok.decision, "approved");
  }
  const velocity = module2.evaluate({
    intent: buildIntent({ amount: "5000.000000" }),
    transaction: { raw_payload: tronWire({ amount: "5000.000000", nonce: 30 }) }
  });
  assert.equal(velocity.decision, "rejected");
  assert.equal(velocity.reason, "daily_velocity_limit_exceeded");
});

test("wire mismatches, expiry, sequence and decode failures fail closed", () => {
  const module = createModule("hot");
  const intent = buildIntent();
  const wrongAmount = module.evaluate({
    intent,
    transaction: { raw_payload: tronWire({ amount: "11.000000" }) }
  });
  assert.equal(wrongAmount.decision, "rejected");
  assert.equal(wrongAmount.reason, "transaction_intent_mismatch");

  const module2 = createModule("hot");
  const lateExpiry = module2.evaluate({
    intent,
    transaction: { raw_payload: tronWire({ expiry: Math.floor(NOW / 1000) + 10_000 }) }
  });
  assert.equal(lateExpiry.decision, "rejected");
  assert.equal(lateExpiry.reason, "transaction_outlives_intent");

  const module3 = createModule("hot");
  const first = module3.evaluate({ intent, transaction: { raw_payload: tronWire({ nonce: 50 }) } });
  assert.equal(first.decision, "approved");
  const second = module3.evaluate({
    intent: buildIntent(),
    transaction: { raw_payload: tronWire({ nonce: 50 }) }
  });
  assert.equal(second.decision, "rejected");
  assert.equal(second.reason, "sequence_not_advancing");

  const module4 = createModule("hot");
  const garbage = module4.evaluate({
    intent: buildIntent(),
    transaction: { raw_payload: "zzzz" }
  });
  assert.equal(garbage.decision, "rejected");
  assert.ok(garbage.reason.startsWith("transaction_decode_failed"));
});

test("tier policies differ: warm delay enforced, cold never auto-signs", () => {
  const warm = createModule("warm", NOW);
  const young = buildIntent({ created: NOW - 60_000 });
  const denied = warm.evaluate({ intent: young, transaction: { raw_payload: tronWire() } });
  assert.equal(denied.decision, "rejected");
  assert.equal(denied.reason, "tier_time_delay");

  // Warm delay 120s < custody intent TTL cap 300s: an intent created 200s ago
  // is still live and clears the delay. This pairing is what the draft
  // demonstrates — tier delays must stay under the upstream intent TTL.
  const aged = buildIntent({ created: NOW - 200_000, ttl: 300 });
  const agedModule = createModule("warm", NOW);
  const approved = agedModule.evaluate({ intent: aged, transaction: { raw_payload: tronWire({ expiry: Math.floor(NOW / 1000) + 90 }) } });
  assert.equal(approved.decision, "approved");

  const cold = createModule("cold");
  const deniedCold = cold.evaluate({ intent: buildIntent(), transaction: { raw_payload: tronWire() } });
  assert.equal(deniedCold.decision, "rejected");
  assert.equal(deniedCold.reason, "tier_requires_ceremony");
});

test("freeze denies every evaluation; unfreeze requires the full quorum", () => {
  const module = createModule("hot");
  module.freeze();
  const denied = module.evaluate({ intent: buildIntent(), transaction: { raw_payload: tronWire() } });
  assert.equal(denied.reason, "tier_frozen");
  assert.equal(module.isFrozen(), true);
  assert.throws(() => module.unfreeze({ subjects: ["operator_ref_only_one"] }));
  const unfrozen = module.unfreeze({
    subjects: ["operator_ref_maker_a", "operator_ref_checker_b"]
  });
  assert.equal(unfrozen.frozen, false);
  const approved = module.evaluate({ intent: buildIntent(), transaction: { raw_payload: tronWire({ nonce: 60 }) } });
  assert.equal(approved.decision, "approved");
});

test("decoders normalize both wire families into the canonical shape", () => {
  const tron = decodeTronTransaction(tronWire({ nonce: 99 }));
  assert.deepEqual(tron, {
    chain: "TRON",
    network: "TRON_TESTNET",
    asset: "USDT",
    amount: "10.000000",
    destination_reference: "destination_ref_synthetic_user_wallet",
    expiry: Math.floor(NOW / 1000) + 200,
    sequence: 99
  });
  const ton = decodeTonTransaction(tonWire());
  assert.deepEqual(ton, {
    chain: "TON",
    network: "TON_TESTNET",
    asset: "TON",
    amount: "10.500000000",
    destination_reference: "destination_ref_synthetic_user_wallet",
    expiry: Math.floor(NOW / 1000) + 200,
    sequence: 42
  });
  assert.throws(() => decodeTonTransaction(Buffer.from(JSON.stringify({ type: "jetton_transfer", jetton: "BTC", to: "destination_ref_x", amount: "1", seqno: 1, valid_until: 1 }), "utf8").toString("hex")), /unsupported jetton/);
  assert.throws(() => decodeTronTransaction("0"), /wire payload must be/);
});

test("watcher reconciles intended outflows and freezes networks on unexplained ones", () => {
  const intent = buildIntent();
  const watcher = createCustodyWatcher({ intents: [intent] });
  const matched = watcher.observe({
    tx_id: "tx_synthetic_001",
    network: "TRON_TESTNET",
    direction: "outflow",
    asset: "USDT",
    amount: "10.000000",
    destination_reference: "destination_ref_synthetic_user_wallet",
    observed_at: NOW
  });
  assert.equal(matched.matched, true);
  assert.equal(matched.intent_digest, intent.intent_digest);

  const rogue = watcher.observe({
    tx_id: "tx_synthetic_002",
    network: "TRON_TESTNET",
    direction: "outflow",
    asset: "USDT",
    amount: "99.000000",
    destination_reference: "destination_ref_not_allowlisted",
    observed_at: NOW
  });
  assert.equal(rogue.matched, false);
  assert.equal(rogue.incident.severity, "critical");
  assert.equal(rogue.incident.reason, "outflow_without_intent");

  const afterFreeze = watcher.observe({
    tx_id: "tx_synthetic_003",
    network: "TRON_TESTNET",
    direction: "outflow",
    asset: "USDT",
    amount: "1.000000",
    destination_reference: "destination_ref_synthetic_user_wallet",
    observed_at: NOW
  });
  assert.equal(afterFreeze.incident.reason, "outflow_on_frozen_network");

  const report = watcher.report();
  assert.equal(report.reconciliations.length, 1);
  assert.equal(report.incidents.length, 2);
  assert.deepEqual(report.frozen_networks, ["TRON_TESTNET"]);
});

test("watcher deduplicates tx ids and records inflows separately", () => {
  const watcher = createCustodyWatcher({ intents: [] });
  const inflow = {
    tx_id: "tx_inflow_001",
    network: "TON_TESTNET",
    direction: "inflow",
    asset: "TON",
    amount: "3.000000000",
    destination_reference: null,
    observed_at: NOW
  };
  assert.equal(watcher.observe(inflow).kind, "inflow");
  assert.equal(watcher.observe(inflow).duplicate, true);
  assert.equal(watcher.report().reconciliations.length, 1);
});
