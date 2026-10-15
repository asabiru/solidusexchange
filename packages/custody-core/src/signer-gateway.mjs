// Signer-gateway interface contract between the custody orchestrator, the
// signer gateway and the in-HSM policy module (hsm-custody-program.md
// §"Engineering work possible now"). The gateway is the single transport hop
// that carries a signing request — it holds no keys, decodes nothing and
// takes only an intent digest plus quorum evidence upstream.
//
// The envelope is deliberately minimal and hash-bound:
//
//   orchestrator → gateway: signing_request = {
//     request_id, custody_policy_version, hsm_policy_version, tier, network,
//     intent_digest, policy_digest, wire_payload (hex), wire_digest,
//     created_at, expires_at
//   }
//   gateway → HSM module: { intent, transaction: { raw_payload } }
//   HSM module → gateway: decision wrapped in a signing_decision envelope
//
// Everything stays unsigned and dev-only: the wire payload is the synthetic
// transaction the decoders already normalize, and the request carries the
// same boundary flags as every custody artifact — key material, signatures
// and production execution remain prohibited end-to-end.

import { createHash } from "node:crypto";

import {
  assertNoRestrictedMaterial,
  snapshotPlainData,
  verifyUnsignedTransactionIntent
} from "./unsigned-intent.mjs";

const requestKeys = [
  "created_at",
  "custody_policy_version",
  "expires_at",
  "hsm_policy_version",
  "intent_digest",
  "key_material_present",
  "network",
  "policy_digest",
  "request_digest",
  "request_id",
  "runtime_boundary",
  "signature_attached",
  "tier",
  "wire_digest",
  "wire_payload"
];

const decisionKeys = [
  "decision",
  "evidence_digest",
  "hsm_policy_version",
  "intent_digest",
  "reason",
  "request_digest",
  "runtime_boundary",
  "signing_mode",
  "tier",
  "wire_digest"
];

const TIER_NAMES = new Set(["hot", "warm", "cold"]);
const HEX_PATTERN = /^[0-9a-f]+$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;
const REQUEST_ID_PATTERN = /^signing_request_[a-z0-9_]{4,119}$/u;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function wireDigest(hexPayload) {
  return createHash("sha256").update(Buffer.from(hexPayload, "hex")).digest("hex");
}

function assertExactKeys(value, expected, label) {
  assert(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`
  );
  const actual = Object.keys(value).sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} fields must exactly match the signer-gateway contract`
  );
}

function assertTimestamp(value, label) {
  assert(typeof value === "string", `${label} must be an RFC 3339 timestamp`);
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} must be an RFC 3339 timestamp`);
  assert(new Date(parsed).toISOString() === value, `${label} must use canonical UTC form`);
  return parsed;
}

function assertWirePayload(value, label) {
  assert(
    typeof value === "string" && value.length % 2 === 0 && HEX_PATTERN.test(value) && value.length > 0,
    `${label} must be non-empty lowercase hex`
  );
}

function requestBody(request) {
  const { request_digest: _digest, ...body } = request;
  return body;
}

function computeRequestDigest(request) {
  return digest(requestBody(request));
}

// Orchestrator side: the verified unsigned intent plus the unsigned wire
// payload become a hash-bound request envelope. The wire digest pins the
// exact bytes the HSM module will later decode; nothing signed or keyed is
// present, so the envelope can cross the gateway unencrypted at rest.
export function prepareSigningRequest({
  intent: intentInput,
  wirePayload: wirePayloadInput,
  requestId,
  tier,
  hsmPolicyVersion,
  now = new Date(),
  custodyPolicy: custodyPolicyInput,
  expiresAt
}) {
  const custodyPolicy = snapshotPlainData(custodyPolicyInput, "custody policy");
  const intent = verifyUnsignedTransactionIntent({
    intent: intentInput,
    now,
    policy: custodyPolicy
  });
  const wirePayload = snapshotPlainData(wirePayloadInput, "wire payload");
  assertWirePayload(wirePayload, "wire_payload");
  assertNoRestrictedMaterial({ wirePayload }, "wire");
  assert(typeof requestId === "string" && REQUEST_ID_PATTERN.test(requestId), "request_id must be a signing_request_ reference");
  assert(TIER_NAMES.has(tier), `unknown wallet tier ${tier}`);
  assert(
    typeof hsmPolicyVersion === "string" && /^[a-z][a-z0-9-]*$/u.test(hsmPolicyVersion),
    "hsm policy version must be a draft identifier"
  );
  assert(now instanceof Date && Number.isFinite(now.getTime()), "now must be a valid Date");
  const nowMs = now.getTime();
  const createdMs = assertTimestamp(new Date(nowMs).toISOString(), "created_at");
  const expiryMs = assertTimestamp(expiresAt, "expires_at");
  const intentExpiryMs = Date.parse(intent.command.expires_at);
  assert(expiryMs > nowMs, "signing request must not expire in the past");
  assert(expiryMs <= intentExpiryMs, "signing request must not outlive its intent");

  const request = {
    created_at: new Date(createdMs).toISOString(),
    custody_policy_version: intent.command.policy_version,
    expires_at: expiresAt,
    hsm_policy_version: hsmPolicyVersion,
    intent_digest: intent.intent_digest,
    key_material_present: false,
    network: intent.command.network,
    policy_digest: intent.policy_digest,
    request_digest: "",
    request_id: requestId,
    runtime_boundary: "dev-dry-run",
    signature_attached: false,
    tier,
    wire_digest: wireDigest(wirePayload),
    wire_payload: wirePayload
  };
  request.request_digest = computeRequestDigest(request);
  return deepFreeze(request);
}

// Gateway side: verify the envelope is intact and bound to the intent the
// upstream boundary verified — exact keys, digest chain, network pinning
// and a live policy version. Throws on any violation; the gateway forwards
// nothing it cannot prove.
export function verifySigningRequestEnvelope({
  request: requestInput,
  intent: intentInput,
  custodyPolicy: custodyPolicyInput,
  hsmPolicy: hsmPolicyInput,
  now = new Date()
}) {
  const request = snapshotPlainData(requestInput, "signing request");
  const custodyPolicy = snapshotPlainData(custodyPolicyInput, "custody policy");
  const hsmPolicy = snapshotPlainData(hsmPolicyInput, "hsm policy");
  assertNoRestrictedMaterial(request, "signing request");
  assertExactKeys(request, requestKeys, "signing request");
  assert(REQUEST_ID_PATTERN.test(request.request_id), "request_id must be a signing_request_ reference");
  assert(request.runtime_boundary === "dev-dry-run", "signing request must remain dev-dry-run");
  assert(request.key_material_present === false, "signing request must not carry key material");
  assert(request.signature_attached === false, "signing request must not carry a signature");
  assert(TIER_NAMES.has(request.tier), `unknown wallet tier ${request.tier}`);
  assert(
    typeof request.network === "string" && /^[A-Z][A-Z0-9_]{2,31}_TESTNET$/u.test(request.network),
    "signing request network must be testnet"
  );
  assert(DIGEST_PATTERN.test(request.intent_digest), "intent_digest must be SHA-256");
  assert(DIGEST_PATTERN.test(request.policy_digest), "policy_digest must be SHA-256");
  assert(DIGEST_PATTERN.test(request.wire_digest), "wire_digest must be SHA-256");
  assert(DIGEST_PATTERN.test(request.request_digest), "request_digest must be SHA-256");
  assertWirePayload(request.wire_payload, "wire_payload");
  assert(request.wire_digest === wireDigest(request.wire_payload), "wire payload does not match wire_digest");
  assert(request.request_digest === computeRequestDigest(request), "request digest does not match the envelope");

  const nowMs = now.getTime();
  const createdMs = assertTimestamp(request.created_at, "created_at");
  const expiresMs = assertTimestamp(request.expires_at, "expires_at");
  assert(createdMs <= nowMs, "signing request cannot be created in the future");
  assert(nowMs < expiresMs, "signing request has expired");

  const intent = verifyUnsignedTransactionIntent({ intent: intentInput, now, policy: custodyPolicy });
  assert(request.intent_digest === intent.intent_digest, "request intent digest does not match the verified intent");
  assert(request.policy_digest === intent.policy_digest, "request policy digest does not match the custody policy");
  assert(request.custody_policy_version === intent.command.policy_version, "custody policy version mismatch");
  assert(request.network === intent.command.network, "request network does not match the intent command");
  assert(expiresMs <= Date.parse(intent.command.expires_at), "signing request must not outlive its intent");
  assert(request.hsm_policy_version === hsmPolicy.policy_version, "hsm policy version mismatch");
  assert(hsmPolicy.tiers?.[request.tier] !== undefined, "hsm policy does not define this tier");
  return deepFreeze(request);
}

// Gateway dispatch: after the envelope is verified the request hands the
// intent and the raw wire to the HSM policy module's evaluation contract and
// wraps the verdict in a signed_decision envelope bound to the request
// digest. Any module rejection propagates verbatim — the gateway never
// upgrades a rejection.
export function dispatchSigningRequest({
  request: requestInput,
  intent: intentInput,
  custodyPolicy: custodyPolicyInput,
  hsmPolicy: hsmPolicyInput,
  module: hsmModule,
  now = new Date()
}) {
  const request = verifySigningRequestEnvelope({
    request: requestInput,
    intent: intentInput,
    custodyPolicy: custodyPolicyInput,
    hsmPolicy: hsmPolicyInput,
    now
  });
  if (
    hsmModule === null ||
    typeof hsmModule !== "object" ||
    typeof hsmModule.evaluate !== "function"
  ) {
    fail("hsm policy module must expose evaluate");
  }
  const verdict = hsmModule.evaluate({
    intent: intentInput,
    transaction: { raw_payload: request.wire_payload }
  });
  assert(verdict === null || typeof verdict === "object", "policy module must return a decision");
  const reason = verdict.decision === "approved" ? null : (verdict.reason ?? "policy_rejected");
  const decision = {
    decision: verdict.decision === "approved" ? "approved" : "rejected",
    evidence_digest:
      typeof verdict.evidence_digest === "string" && DIGEST_PATTERN.test(verdict.evidence_digest)
        ? verdict.evidence_digest
        : digest(verdict),
    hsm_policy_version: request.hsm_policy_version,
    intent_digest: request.intent_digest,
    reason,
    request_digest: request.request_digest,
    runtime_boundary: "dev-dry-run",
    signing_mode: typeof verdict.signing_mode === "string" ? verdict.signing_mode : "none",
    tier: request.tier,
    wire_digest: request.wire_digest
  };
  assertExactKeys(decision, decisionKeys, "signing decision");
  return deepFreeze(decision);
}
