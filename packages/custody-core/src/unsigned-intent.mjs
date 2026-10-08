import { createHash } from "node:crypto";
import { types } from "node:util";

const commandKeys = [
  "amount",
  "asset",
  "correlation_id",
  "created_at",
  "destination_reference",
  "expires_at",
  "idempotency_key",
  "intent_id",
  "legal_entity_id",
  "network",
  "policy_version",
  "withdrawal_id"
];

const approvalKeys = [
  "approval_id",
  "approved_at",
  "decision",
  "evidence_digest",
  "intent_digest",
  "role",
  "step_up_grant_id",
  "subject_reference"
];

const policyKeys = [
  "allowed_assets",
  "approval_ttl_seconds",
  "execution_authority",
  "key_material_allowed",
  "maximum_intent_ttl_seconds",
  "minimum_approvals",
  "policy_version",
  "production_signing_enabled",
  "required_approval_roles",
  "runtime_boundary"
];

const assetPolicyKeys = [
  "asset",
  "maximum_scale",
  "network"
];

const restrictedFields = new Set([
  "key_material",
  "mnemonic",
  "private_key",
  "public_key",
  "raw_transaction",
  "secret_key",
  "seed",
  "seed_phrase",
  "signature",
  "signed_transaction",
  "signing_key"
]);
const referencePattern = /^[a-z][a-z0-9_]{2,127}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;
const intentKeys = [
  "approval_evidence_digest",
  "approvals",
  "command",
  "execution_authority",
  "intent_digest",
  "key_material_present",
  "policy_digest",
  "production_signing_enabled",
  "runtime_boundary",
  "status"
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertPlainObject(value, label) {
  assert(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`
  );
}

const arrayIndexPattern = /^(?:0|[1-9][0-9]*)$/u;

export function snapshotPlainData(value, label = "input", ancestors = new Set()) {
  assert(typeof value !== "function", `${label} must be plain data`);
  if (value === null || typeof value !== "object") return value;
  assert(!types.isProxy(value), `${label} must be plain data`);
  assert(!ancestors.has(value), `${label} must not be cyclic`);
  const isArray = Array.isArray(value);
  assert(
    Object.getPrototypeOf(value) === (isArray ? Array.prototype : Object.prototype),
    `${label} must be plain data`
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const snapshot = isArray ? [] : {};
  if (isArray) {
    assert(keys.length === descriptors.length.value + 1, `${label} must be a dense array`);
  }
  ancestors.add(value);
  for (const key of keys) {
    if (isArray && key === "length") continue;
    assert(typeof key === "string", `${label} must not contain symbol keys`);
    if (isArray) {
      assert(arrayIndexPattern.test(key), `${label} must only contain array elements`);
    }
    const descriptor = descriptors[key];
    assert(
      Object.hasOwn(descriptor, "value") && descriptor.enumerable,
      `${label}.${key} must be an enumerable data property`
    );
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotPlainData(descriptor.value, `${label}.${key}`, ancestors),
      writable: true
    });
  }
  ancestors.delete(value);
  return snapshot;
}

function assertNoRestrictedMaterial(value, label = "input") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRestrictedMaterial(item, `${label}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    assert(
      !normalizedKey.endsWith("_address") && !restrictedFields.has(normalizedKey),
      `${label}.${key} contains restricted custody material`
    );
    assertNoRestrictedMaterial(child, `${label}.${key}`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} fields must exactly match the custody contract`
  );
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
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function parseTimestamp(value, label) {
  assert(typeof value === "string", `${label} must be an RFC 3339 timestamp`);
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} must be an RFC 3339 timestamp`);
  assert(new Date(parsed).toISOString() === value, `${label} must use canonical UTC form`);
  return parsed;
}

function assertReference(value, label, prefix) {
  assert(
    typeof value === "string" &&
      value.length > prefix.length &&
      value.length <= 127 &&
      referencePattern.test(value) &&
      value.startsWith(prefix),
    `${label} must be a ${prefix} reference`
  );
}

function assertUuid(value, label) {
  assert(typeof value === "string" && uuidPattern.test(value), `${label} must be a canonical UUID`);
}

function assertPolicy(policy) {
  assertExactKeys(policy, policyKeys, "policy");
  assert(policy.policy_version === "custody-dev-v1", "custody policy version is not supported");
  assert(policy.runtime_boundary === "dev-dry-run", "custody runtime must remain dev-dry-run");
  assert(policy.execution_authority === false, "custody execution authority must remain disabled");
  assert(policy.production_signing_enabled === false, "production signing must remain disabled");
  assert(policy.key_material_allowed === false, "key material must remain prohibited");
  assert(policy.minimum_approvals === 2, "maker-checker requires exactly two approval roles");
  assert(Number.isInteger(policy.approval_ttl_seconds) && policy.approval_ttl_seconds > 0, "approval TTL must be positive");
  assert(
    Number.isInteger(policy.maximum_intent_ttl_seconds) &&
      policy.maximum_intent_ttl_seconds > 0,
    "intent TTL must be positive"
  );
  assert(Array.isArray(policy.required_approval_roles), "approval roles must be an array");
  assert(
    JSON.stringify([...policy.required_approval_roles].sort()) ===
      JSON.stringify(["custody_checker", "custody_maker"]),
    "maker-checker approval roles must be exact"
  );
  assert(Array.isArray(policy.allowed_assets) && policy.allowed_assets.length > 0, "testnet asset allowlist is required");
  const allowedAssets = new Set();
  for (const [index, assetPolicy] of policy.allowed_assets.entries()) {
    const label = `policy.allowed_assets[${index}]`;
    assertExactKeys(assetPolicy, assetPolicyKeys, label);
    assert(/^[A-Z][A-Z0-9]{1,15}$/u.test(assetPolicy.asset), `${label}.asset is invalid`);
    assert(
      typeof assetPolicy.network === "string" &&
        /^[A-Z][A-Z0-9_]{2,31}_TESTNET$/u.test(assetPolicy.network),
      `${label}.network must be testnet`
    );
    assert(
      Number.isInteger(assetPolicy.maximum_scale) &&
        assetPolicy.maximum_scale >= 0 &&
        assetPolicy.maximum_scale <= 18,
      `${label}.maximum_scale is invalid`
    );
    const key = `${assetPolicy.asset}:${assetPolicy.network}`;
    assert(!allowedAssets.has(key), "testnet asset allowlist entries must be unique");
    allowedAssets.add(key);
  }
}

function assertCommand(command, policy, now) {
  assertExactKeys(command, commandKeys, "command");
  assertReference(command.intent_id, "intent_id", "custody_intent_");
  assertReference(command.withdrawal_id, "withdrawal_id", "withdrawal_");
  assertReference(command.legal_entity_id, "legal_entity_id", "legal_entity_");
  assertReference(command.destination_reference, "destination_reference", "destination_ref_");
  assertReference(command.idempotency_key, "idempotency_key", "custody_idempotency_");
  assertUuid(command.correlation_id, "correlation_id");
  assert(command.policy_version === policy.policy_version, "command policy version mismatch");

  const assetPolicy = policy.allowed_assets.find(
    (candidate) =>
      candidate.asset === command.asset &&
      candidate.network === command.network
  );
  assert(assetPolicy, "asset and network are outside the dev custody allowlist");
  assert(command.network.endsWith("_TESTNET"), "mainnet custody is prohibited");

  assert(typeof command.amount === "string", "amount must be a decimal string");
  const amountMatch = decimalPattern.exec(command.amount);
  assert(amountMatch, "amount must be a canonical positive decimal string");
  const amountDigits = command.amount.replace(".", "");
  assert(amountDigits.length <= 78, "amount exceeds the custody precision limit");
  assert(BigInt(amountDigits) > 0n, "amount must be positive");
  assert((amountMatch[1]?.length ?? 0) <= assetPolicy.maximum_scale, "amount exceeds asset scale");

  const createdAt = parseTimestamp(command.created_at, "created_at");
  const expiresAt = parseTimestamp(command.expires_at, "expires_at");
  assert(createdAt <= now, "intent cannot be created in the future");
  assert(now < expiresAt, "intent has expired");
  assert(expiresAt > createdAt, "intent expiry must follow creation");
  assert(
    expiresAt - createdAt <= policy.maximum_intent_ttl_seconds * 1000,
    "intent TTL exceeds custody policy"
  );
  return { createdAt, expiresAt };
}

function assertApprovals(approvals, intentDigest, policy, timing, now) {
  assert(Array.isArray(approvals), "approvals must be an array");
  assert(approvals.length >= policy.minimum_approvals, "maker-checker approval quorum is missing");

  const approvalIds = new Set();
  const subjects = new Set();
  const roles = new Set();
  const stepUpGrantIds = new Set();
  const evidenceDigests = new Set();
  for (const [index, approval] of approvals.entries()) {
    const label = `approvals[${index}]`;
    assertExactKeys(approval, approvalKeys, label);
    assertReference(approval.approval_id, `${label}.approval_id`, "approval_");
    assertReference(approval.subject_reference, `${label}.subject_reference`, "operator_ref_");
    assertReference(approval.step_up_grant_id, `${label}.step_up_grant_id`, "step_up_grant_");
    assert(approval.decision === "approved", `${label}.decision must be approved`);
    assert(policy.required_approval_roles.includes(approval.role), `${label}.role is not allowed`);
    assert(
      approval.intent_digest === intentDigest,
      `${label}.intent_digest does not match command and policy`
    );
    assert(digestPattern.test(approval.evidence_digest), `${label}.evidence_digest must be SHA-256`);
    assert(!approvalIds.has(approval.approval_id), "approval IDs must be unique");
    assert(!subjects.has(approval.subject_reference), "maker and checker must be different humans");
    assert(!roles.has(approval.role), "approval roles must be unique");
    assert(!stepUpGrantIds.has(approval.step_up_grant_id), "step-up grant references must be unique");
    assert(!evidenceDigests.has(approval.evidence_digest), "approval evidence digests must be unique");
    approvalIds.add(approval.approval_id);
    subjects.add(approval.subject_reference);
    roles.add(approval.role);
    stepUpGrantIds.add(approval.step_up_grant_id);
    evidenceDigests.add(approval.evidence_digest);

    const approvedAt = parseTimestamp(approval.approved_at, `${label}.approved_at`);
    assert(approvedAt >= timing.createdAt, `${label} predates the custody intent`);
    assert(approvedAt <= now, `${label} cannot be approved in the future`);
    assert(approvedAt < timing.expiresAt, `${label} must precede intent expiry`);
    assert(now - approvedAt <= policy.approval_ttl_seconds * 1000, `${label} approval has expired`);
  }
  for (const requiredRole of policy.required_approval_roles) {
    assert(roles.has(requiredRole), `required approval role is missing: ${requiredRole}`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function calculateIntentDigest(command, policyDigest) {
  return digest({
    command,
    policy_digest: policyDigest
  });
}

export function computeIntentDigest(commandInput, policyInput) {
  const command = snapshotPlainData(commandInput, "command");
  const policy = snapshotPlainData(policyInput, "policy");
  assertNoRestrictedMaterial(command, "command");
  assertNoRestrictedMaterial(policy, "policy");
  assertPolicy(policy);
  assertExactKeys(command, commandKeys, "command");
  assert(command.policy_version === policy.policy_version, "command policy version mismatch");
  return calculateIntentDigest(command, digest(policy));
}

export function verifyUnsignedTransactionIntent({
  intent: intentInput,
  now = new Date(),
  policy: policyInput
}) {
  const intent = snapshotPlainData(intentInput, "intent");
  const policy = snapshotPlainData(policyInput, "policy");
  assertNoRestrictedMaterial(intent, "intent");
  assertNoRestrictedMaterial(policy, "policy");
  assertExactKeys(intent, intentKeys, "intent");
  assertPolicy(policy);
  assert(now instanceof Date && Number.isFinite(now.getTime()), "now must be a valid Date");
  assert(intent.runtime_boundary === "dev-dry-run", "intent runtime must remain dev-dry-run");
  assert(intent.status === "unsigned_intent_ready", "intent must remain unsigned");
  assert(intent.execution_authority === false, "intent execution authority must remain disabled");
  assert(intent.production_signing_enabled === false, "intent production signing must remain disabled");
  assert(intent.key_material_present === false, "intent must not contain key material");
  assert(digestPattern.test(intent.policy_digest), "intent policy_digest must be SHA-256");
  assert(digestPattern.test(intent.intent_digest), "intent intent_digest must be SHA-256");
  const policyDigest = digest(policy);
  assert(intent.policy_digest === policyDigest, "intent policy digest does not match custody policy");
  assert(
    intent.intent_digest === calculateIntentDigest(intent.command, policyDigest),
    "intent digest does not match sealed command and policy"
  );
  const timing = assertCommand(intent.command, policy, now.getTime());
  assert(Array.isArray(intent.approvals), "intent approvals must be an array");
  assertApprovals(intent.approvals, intent.intent_digest, policy, timing, now.getTime());
  assert(
    intent.approval_evidence_digest === digest(intent.approvals),
    "intent approval evidence digest does not match approvals"
  );

  const orderedApprovals = [...intent.approvals].sort((left, right) =>
    `${left.role}:${left.approval_id}`.localeCompare(`${right.role}:${right.approval_id}`)
  );
  assert(
    JSON.stringify(intent.approvals) === JSON.stringify(orderedApprovals),
    "intent approvals must remain canonically ordered"
  );
  return deepFreeze(intent);
}

export function prepareUnsignedTransactionIntent({
  approvals: approvalsInput,
  command: commandInput,
  now = new Date(),
  policy: policyInput
}) {
  const { approvals, command } = snapshotPlainData(
    { approvals: approvalsInput, command: commandInput },
    "custody_request"
  );
  const policy = snapshotPlainData(policyInput, "policy");
  assertNoRestrictedMaterial({ approvals, command }, "custody_request");
  assertNoRestrictedMaterial(policy, "policy");
  assertPolicy(policy);
  assert(now instanceof Date && Number.isFinite(now.getTime()), "now must be a valid Date");
  const nowTimestamp = now.getTime();
  const timing = assertCommand(command, policy, nowTimestamp);
  const policyDigest = digest(policy);
  const intentDigest = calculateIntentDigest(command, policyDigest);
  assertApprovals(approvals, intentDigest, policy, timing, nowTimestamp);

  const orderedApprovals = approvals
    .map((approval) => ({ ...approval }))
    .sort((left, right) =>
      `${left.role}:${left.approval_id}`.localeCompare(`${right.role}:${right.approval_id}`)
    );

  return deepFreeze({
    approval_evidence_digest: digest(orderedApprovals),
    approvals: orderedApprovals,
    command: { ...command },
    execution_authority: false,
    intent_digest: intentDigest,
    key_material_present: false,
    policy_digest: policyDigest,
    production_signing_enabled: false,
    runtime_boundary: "dev-dry-run",
    status: "unsigned_intent_ready"
  });
}
