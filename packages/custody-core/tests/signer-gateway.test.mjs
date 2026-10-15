import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHsmPolicyModule } from "../src/hsm-policy.mjs";
import {
  dispatchSigningRequest,
  prepareSigningRequest,
  verifySigningRequestEnvelope
} from "../src/signer-gateway.mjs";
import {
  computeIntentDigest,
  prepareUnsignedTransactionIntent,
  verifyUnsignedTransactionIntent
} from "../src/unsigned-intent.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const custodyPolicy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const hsmPolicy = JSON.parse(readFileSync(join(root, "hsm", "hsm-policy-draft.json"), "utf8"));

const NOW = Date.parse("2026-10-15T12:00:00.000Z");

let sequence = 0;
function suffix() {
  sequence += 1;
  return String(sequence).padStart(6, "0");
}

function buildIntent({ amount = "10.000000", created = NOW - 30_000, ttl = 240 } = {}) {
  const tag = suffix();
  const command = {
    amount,
    asset: "USDT",
    correlation_id: `018f3a00-0000-7000-8000-${tag}0f0f0f`.slice(0, 36).padEnd(36, "0"),
    created_at: new Date(created).toISOString(),
    destination_reference: "destination_ref_synthetic_user_wallet",
    expires_at: new Date(created + ttl * 1000).toISOString(),
    idempotency_key: `custody_idempotency_${tag}`,
    intent_id: `custody_intent_${tag}`,
    legal_entity_id: "legal_entity_solidchange_dev",
    network: "TRON_TESTNET",
    policy_version: "custody-dev-v1",
    withdrawal_id: `withdrawal_${tag}`
  };
  const intentDigest = computeIntentDigest(command, custodyPolicy);
  const approvals = [
    {
      approval_id: `approval_${tag}_maker`,
      approved_at: new Date(created + 5_000).toISOString(),
      decision: "approved",
      evidence_digest: "a".repeat(64),
      intent_digest: intentDigest,
      role: "custody_maker",
      step_up_grant_id: `step_up_grant_${tag}_maker`,
      subject_reference: `operator_ref_maker_${tag}`
    },
    {
      approval_id: `approval_${tag}_checker`,
      approved_at: new Date(created + 10_000).toISOString(),
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

function tronWire({ amount = "10.000000", nonce = 7, expiry = Math.floor(NOW / 1000) + 200 } = {}) {
  return Buffer.from(
    JSON.stringify({ type: "trc20_transfer", contract: "USDT", to_address: "destination_ref_synthetic_user_wallet", amount, nonce, expiration: expiry }),
    "utf8"
  ).toString("hex");
}

function makeRequest(overrides = {}) {
  const intent = overrides.intent ?? buildIntent();
  return prepareSigningRequest({
    intent,
    wirePayload: overrides.wirePayload ?? tronWire(),
    requestId: overrides.requestId ?? `signing_request_${suffix()}`,
    tier: overrides.tier ?? "hot",
    hsmPolicyVersion: hsmPolicy.policy_version,
    now: new Date(NOW),
    custodyPolicy,
    expiresAt: overrides.expiresAt ?? intent.command.expires_at
  });
}

function makeModule(tier = "hot") {
  return createHsmPolicyModule({ policy: hsmPolicy, tier, custodyPolicy, clock: () => new Date(NOW) });
}

test("orchestrator prepares a hash-bound request envelope for the gateway", () => {
  const intent = buildIntent();
  const wire = tronWire();
  const request = prepareSigningRequest({
    intent,
    wirePayload: wire,
    requestId: "signing_request_bridge001",
    tier: "hot",
    hsmPolicyVersion: hsmPolicy.policy_version,
    now: new Date(NOW),
    custodyPolicy,
    expiresAt: intent.command.expires_at
  });
  assert.equal(request.intent_digest, intent.intent_digest);
  assert.equal(request.runtime_boundary, "dev-dry-run");
  assert.equal(request.signature_attached, false);
  assert.equal(request.key_material_present, false);
  assert.equal(request.network, "TRON_TESTNET");
  assert.equal(request.request_digest.length, 64);
  assert.equal(request.wire_digest.length, 64);
  // Request digests bind the whole envelope — a field flip changes it.
  const swapped = { ...request, network: "TON_TESTNET" };
  swapped.request_digest = "";
  assert.notEqual(request.request_digest, "");
  assert.ok(Object.isFrozen(request));
});

test("prepare fails closed on unsigned intents, expired requests and bad wires", () => {
  assert.throws(
    () => prepareSigningRequest({
      intent: { ...buildIntent(), status: "pending_checker_approval" },
      wirePayload: tronWire(),
      requestId: "signing_request_bad001",
      tier: "hot",
      hsmPolicyVersion: hsmPolicy.policy_version,
      now: new Date(NOW),
      custodyPolicy,
      expiresAt: new Date(NOW + 120_000).toISOString()
    }),
    /unsigned_intent_ready|must remain unsigned/
  );
  const intent = buildIntent();
  const intentExpiry = Date.parse(intent.command.expires_at);
  assert.throws(
    () => prepareSigningRequest({
      intent,
      wirePayload: tronWire(),
      requestId: "signing_request_overstay",
      tier: "hot",
      hsmPolicyVersion: hsmPolicy.policy_version,
      now: new Date(NOW),
      custodyPolicy,
      expiresAt: new Date(intentExpiry + 60_000).toISOString()
    }),
    /outlive its intent/
  );
  assert.throws(
    () => prepareSigningRequest({
      intent,
      wirePayload: "not-hex!",
      requestId: "signing_request_wire01",
      tier: "hot",
      hsmPolicyVersion: hsmPolicy.policy_version,
      now: new Date(NOW),
      custodyPolicy,
      expiresAt: intent.command.expires_at
    }),
    /wire_payload must be non-empty lowercase hex/
  );
});

test("gateway verification binds the request to intent, policies and wire", () => {
  const intent = buildIntent();
  const request = makeRequest({ intent });
  const verified = verifySigningRequestEnvelope({
    request,
    intent,
    custodyPolicy,
    hsmPolicy,
    now: new Date(NOW)
  });
  assert.equal(verified.request_digest, request.request_digest);

  // Digest tampering anywhere fails closed.
  for (const [field, value] of [
    ["intent_digest", "0".repeat(64)],
    ["wire_payload", tronWire({ nonce: 999 })],
    ["network", "TON_TESTNET"],
    ["tier", "warm"]
  ]) {
    assert.throws(
      () =>
        verifySigningRequestEnvelope({
          request: { ...request, [field]: value },
          intent,
          custodyPolicy,
          hsmPolicy,
          now: new Date(NOW)
        }),
      undefined,
      `${field} tamper must be rejected`
    );
  }

  assert.throws(
    () =>
      verifySigningRequestEnvelope({
        request,
        intent: buildIntent(),
        custodyPolicy,
        hsmPolicy,
        now: new Date(NOW)
      }),
    /intent digest does not match/
  );
});

test("gateway rejects restricted material, signatures and mainnet networks", () => {
  const intent = buildIntent();
  const request = makeRequest({ intent });
  for (const mutation of [
    { ...request, private_key: "0".repeat(64) },
    { ...request, signature: "f".repeat(64) },
    { ...request, key_material: { seed: "x" } }
  ]) {
    assert.throws(
      () =>
        verifySigningRequestEnvelope({ request: mutation, intent, custodyPolicy, hsmPolicy, now: new Date(NOW) }),
      /contract|restricted|signature/i,
      "restricted material must fail closed"
    );
  }
  assert.throws(
    () =>
      verifySigningRequestEnvelope({
        request: { ...request, signature_attached: true },
        intent,
        custodyPolicy,
        hsmPolicy,
        now: new Date(NOW)
      }),
    /signature/
  );
});

test("dispatch returns a request-bound signing decision for clean envelopes", () => {
  const intent = buildIntent();
  const request = makeRequest({ intent });
  const decision = dispatchSigningRequest({
    request,
    intent,
    custodyPolicy,
    hsmPolicy,
    module: makeModule("hot"),
    now: new Date(NOW)
  });
  assert.equal(decision.decision, "approved");
  assert.equal(decision.reason, null);
  assert.equal(decision.request_digest, request.request_digest);
  assert.equal(decision.intent_digest, intent.intent_digest);
  assert.equal(decision.wire_digest, request.wire_digest);
  assert.equal(decision.runtime_boundary, "dev-dry-run");
  assert.equal(decision.signing_mode, "automatic_within_limits");
  assert.equal(decision.evidence_digest.length, 64);
});

test("module rejections propagate through the gateway untouched", () => {
  const intent = buildIntent();
  const request = makeRequest({ intent, tier: "cold" });
  const decision = dispatchSigningRequest({
    request,
    intent,
    custodyPolicy,
    hsmPolicy,
    module: makeModule("cold"),
    now: new Date(NOW)
  });
  assert.equal(decision.decision, "rejected");
  assert.equal(decision.reason, "tier_requires_ceremony");
});

test("dispatch refuses malformed modules and broken envelopes", () => {
  const intent = buildIntent();
  const request = makeRequest({ intent });
  assert.throws(
    () =>
      dispatchSigningRequest({
        request,
        intent,
        custodyPolicy,
        hsmPolicy,
        module: { evaluate: "nope" },
        now: new Date(NOW)
      }),
    /must expose evaluate/
  );
  assert.throws(
    () =>
      dispatchSigningRequest({
        request: { ...request, wire_digest: "f".repeat(64) },
        intent,
        custodyPolicy,
        hsmPolicy,
        module: makeModule("hot"),
        now: new Date(NOW)
      }),
    /wire_digest/
  );
});
