// Reference implementation of the in-HSM transaction-policy module described
// in hsm-custody-program.md §"Engineering work possible now" — quorum
// structure, limits/velocity, destination allowlist, intent-to-transaction
// matching and replay protection, running outside any HSM so the rules are
// executable and testable before vendor proof-of-concept.
//
// It never sees key material or signatures: the module evaluates the verified
// unsigned intent envelope plus the independently decoded synthetic wire
// transaction and returns an approval decision with evidence. Production
// enforcement replaces the structural quorum check with personal-hardware-key
// signature verification inside the certified boundary — the evaluation
// contract and fail-closed reason set are the reviewable part.

import { createHash } from "node:crypto";

import { snapshotPlainData, computeIntentDigest } from "./unsigned-intent.mjs";
import { decodeTransactionForNetwork } from "./tx-decoders.mjs";

const TIER_NAMES = new Set(["hot", "warm", "cold"]);
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,127}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SECONDS_PER_DAY = 86_400;

function fail(message) {
  throw new Error(message);
}

function clone(value) {
  return structuredClone(value);
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

function evidenceDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function toMinorUnits(amount, scale) {
  if (typeof amount !== "string" || !DECIMAL_PATTERN.test(amount)) {
    fail("amount must be a canonical decimal string");
  }
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > scale) fail("amount exceeds the asset scale");
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

function assertPolicy(policy) {
  if (policy.policy_version !== "hsm-dev-draft-v1") fail("hsm policy version is not supported");
  if (policy.status !== "draft-pending-approval") fail("hsm policy must remain a pending draft");
  if (policy.runtime_boundary !== "dev-dry-run") fail("hsm policy must remain dev-only");
  if (policy.production_signing_enabled !== false) fail("production signing must remain disabled");
  if (policy.key_material_allowed !== false) fail("key material must remain prohibited");
  if (policy.execution_authority !== false) fail("hsm policy must not grant execution authority");
  if (!policy.quorum || !Number.isInteger(policy.quorum.minimum_approvals)) {
    fail("hsm policy quorum is missing");
  }
  if (policy.quorum.minimum_approvals < 2) fail("hsm quorum requires at least two approvals");
  for (const [name, tier] of Object.entries(policy.tiers ?? {})) {
    if (!TIER_NAMES.has(name)) fail(`unknown tier ${name}`);
    if (!Number.isInteger(tier.time_delay_seconds) || tier.time_delay_seconds < 0) {
      fail(`${name} time delay must be a non-negative integer`);
    }
    for (const limit of tier.limits) {
      if (typeof limit.asset !== "string" || typeof limit.network !== "string") {
        fail(`${name} limit entries must name asset and network`);
      }
      if (!Number.isInteger(limit.scale) || limit.scale < 0 || limit.scale > 18) {
        fail(`${name} limit scale is invalid`);
      }
      toMinorUnits(limit.per_transaction_maximum, limit.scale);
      toMinorUnits(limit.daily_velocity_maximum, limit.scale);
    }
  }
  if (!Array.isArray(policy.destination_allowlist)) fail("destination allowlist must be an array");
  for (const reference of policy.destination_allowlist) {
    if (!REFERENCE_PATTERN.test(reference) || !reference.startsWith("destination_ref_")) {
      fail("destination allowlist entries must be destination_ref_ references");
    }
  }
}

function decision(shape) {
  return deepFreeze({ runtime_boundary: "dev-dry-run", ...shape });
}

function rejected(tierName, signingMode, reason, intentDigest, checks) {
  return decision({
    decision: "rejected",
    reason,
    tier: tierName,
    signing_mode: signingMode,
    intent_digest: intentDigest,
    checks
  });
}

export function createHsmPolicyModule({ policy: policyInput, tier, custodyPolicy, clock = () => new Date() }) {
  const policy = snapshotPlainData(policyInput, "hsm policy");
  const custody = snapshotPlainData(custodyPolicy, "custody policy");
  assertPolicy(policy);
  if (!TIER_NAMES.has(tier)) fail(`unknown wallet tier ${tier}`);
  const tierPolicy = policy.tiers[tier];
  if (tierPolicy === undefined) fail(`hsm policy does not define tier ${tier}`);
  if (typeof clock !== "function") fail("clock must be a function");

  const velocity = new Map();
  const consumedIntents = new Set();
  const lastSequence = new Map();
  let frozen = false;

  const dayBucket = (nowMs) => Math.floor(nowMs / 1000 / SECONDS_PER_DAY);

  function evaluate({ intent: intentInput, transaction: transactionInput }) {
    const intent = snapshotPlainData(intentInput, "intent");
    const checks = {
      quorum: false,
      allowlist: false,
      limits: false,
      velocity: false,
      transaction_match: false,
      expiry: false,
      replay: false,
      time_delay: false
    };
    const intentDigest = typeof intent?.intent_digest === "string" ? intent.intent_digest : null;
    const deny = (reason) => rejected(tier, tierPolicy.signing_mode, reason, intentDigest, checks);

    if (frozen) return deny("tier_frozen");
    if (tierPolicy.signing_mode === "ceremony_only") return deny("tier_requires_ceremony");
    if (!DIGEST_PATTERN.test(intentDigest ?? "")) return deny("intent_missing");

    if (consumedIntents.has(intentDigest)) return deny("intent_replayed");
    checks.replay = true;

    const command = intent.command;
    if (command === undefined) return deny("intent_missing");

    const nowMs = clock().getTime();
    if (nowMs >= Date.parse(command.expires_at)) return deny("intent_expired");
    checks.expiry = true;

    const createdMs = Date.parse(command.created_at);
    if (nowMs - createdMs < tierPolicy.time_delay_seconds * 1000) {
      return deny("tier_time_delay");
    }
    checks.time_delay = true;

    // Structural quorum: the upstream boundary already bound every approval
    // to the intent digest; the module re-proves minimum count, exact roles
    // and distinct subjects inside its own evidence.
    const approvals = Array.isArray(intent.approvals) ? intent.approvals : [];
    if (approvals.length < policy.quorum.minimum_approvals) return deny("quorum_missing");
    if (
      intent.intent_digest !== computeIntentDigest(command, custody) ||
      approvals.some((approval) => approval.intent_digest !== intentDigest)
    ) {
      return deny("quorum_not_bound");
    }
    const roles = new Set(approvals.map((approval) => approval.role));
    if (!policy.quorum.required_roles.every((role) => roles.has(role))) {
      return deny("quorum_roles_missing");
    }
    const subjects = new Set(approvals.map((approval) => approval.subject_reference));
    if (policy.quorum.distinct_subjects_required && subjects.size !== approvals.length) {
      return deny("quorum_subjects_overlap");
    }
    checks.quorum = true;

    if (!policy.destination_allowlist.includes(command.destination_reference)) {
      return deny("destination_not_allowlisted");
    }
    checks.allowlist = true;

    const limit = tierPolicy.limits.find(
      (candidate) => candidate.asset === command.asset && candidate.network === command.network
    );
    if (limit === undefined) return deny("asset_not_in_tier");
    const amountMinor = toMinorUnits(command.amount, limit.scale);
    if (amountMinor > toMinorUnits(limit.per_transaction_maximum, limit.scale)) {
      return deny("per_transaction_limit_exceeded");
    }
    checks.limits = true;

    const velocityKey = `${tier}|${command.asset}|${command.network}|${dayBucket(nowMs)}`;
    const velocitySoFar = velocity.get(velocityKey) ?? 0n;
    if (velocitySoFar + amountMinor > toMinorUnits(limit.daily_velocity_maximum, limit.scale)) {
      return deny("daily_velocity_limit_exceeded");
    }
    checks.velocity = true;

    const transaction = snapshotPlainData(transactionInput, "transaction");
    let decoded;
    try {
      decoded = decodeTransactionForNetwork(command.network, transaction.raw_payload);
    } catch (error) {
      return deny(`transaction_decode_failed:${error.message}`);
    }
    if (
      decoded.network !== command.network ||
      decoded.asset !== command.asset ||
      decoded.amount !== command.amount ||
      decoded.destination_reference !== command.destination_reference
    ) {
      return deny("transaction_intent_mismatch");
    }
    if (decoded.expiry * 1000 > Date.parse(command.expires_at)) {
      return deny("transaction_outlives_intent");
    }
    const sequenceKey = `${tier}|${command.network}`;
    const priorSequence = lastSequence.get(sequenceKey);
    if (priorSequence !== undefined && decoded.sequence <= priorSequence) {
      return deny("sequence_not_advancing");
    }
    checks.transaction_match = true;

    velocity.set(velocityKey, velocitySoFar + amountMinor);
    lastSequence.set(sequenceKey, decoded.sequence);
    consumedIntents.add(intentDigest);

    return decision({
      decision: "approved",
      reason: null,
      tier,
      signing_mode: tierPolicy.signing_mode,
      intent_digest: intentDigest,
      transaction: {
        network: decoded.network,
        asset: decoded.asset,
        amount: decoded.amount,
        destination_reference: decoded.destination_reference,
        sequence: decoded.sequence
      },
      checks: deepFreeze(checks),
      evidence_digest: evidenceDigest({
        intent_digest: intentDigest,
        checks,
        tier,
        transaction: decoded
      })
    });
  }

  function freeze() {
    frozen = true;
    return deepFreeze({ frozen: true, tier });
  }

  function unfreeze(quorumEvidence) {
    const evidence = snapshotPlainData(quorumEvidence, "quorum evidence");
    const subjects = Array.isArray(evidence.subjects) ? evidence.subjects : [];
    if (
      new Set(subjects).size !== subjects.length ||
      subjects.length < policy.quorum.minimum_approvals ||
      subjects.some((subject) => !REFERENCE_PATTERN.test(subject))
    ) {
      fail("unfreeze requires the full quorum of distinct subjects");
    }
    frozen = false;
    return deepFreeze({ frozen: false, tier, unfrozen_by: [...subjects].sort() });
  }

  return deepFreeze({
    evaluate,
    freeze,
    unfreeze,
    isFrozen: () => frozen,
    velocityUsage: () =>
      Object.fromEntries(
        [...velocity.entries()].map(([key, minor]) => [key, minor.toString()])
      ),
    tier,
    runtime_boundary: "dev-dry-run"
  });
}
