import { verifyUnsignedTransactionIntent } from "./unsigned-intent.mjs";

const eventContextKeys = [
  "causation_id",
  "event_id",
  "occurred_at"
];
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  assert(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected),
    `${label} fields must exactly match the custody event contract`
  );
}

function assertUuidV7(value, label) {
  assert(typeof value === "string" && uuidV7Pattern.test(value), `${label} must be a UUIDv7`);
}

function parseTimestamp(value, label) {
  assert(typeof value === "string", `${label} must be a canonical UTC timestamp`);
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} must be a canonical UTC timestamp`);
  assert(new Date(parsed).toISOString() === value, `${label} must use canonical UTC form`);
  return parsed;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function createCustodyIntentPreparedEvent({ context, intent, policy }) {
  assertExactKeys(context, eventContextKeys, "event context");
  assertUuidV7(context.event_id, "event_id");
  assertUuidV7(context.causation_id, "causation_id");
  assert(context.event_id !== context.causation_id, "event_id and causation_id must differ");

  const occurredAt = parseTimestamp(context.occurred_at, "occurred_at");
  verifyUnsignedTransactionIntent({
    intent,
    now: new Date(occurredAt),
    policy
  });

  return deepFreeze({
    actor: {
      subject: "custody_orchestrator",
      type: "service"
    },
    aggregate_id: intent.command.withdrawal_id,
    aggregate_type: "withdrawal",
    causation_id: context.causation_id,
    correlation_id: intent.command.correlation_id,
    data_classification: "highly-confidential",
    event_id: context.event_id,
    event_type: "CustodyIntentPrepared",
    event_version: 1,
    idempotency_key: intent.command.idempotency_key,
    occurred_at: context.occurred_at,
    payload: {
      approval_evidence_digest: intent.approval_evidence_digest,
      asset: intent.command.asset,
      custody_intent_id: intent.command.intent_id,
      execution_authority: false,
      expires_at: intent.command.expires_at,
      intent_digest: intent.intent_digest,
      network: intent.command.network,
      policy_digest: intent.policy_digest,
      production_signing_enabled: false,
      status: "unsigned_intent_ready",
      withdrawal_id: intent.command.withdrawal_id
    },
    producer: "custody-orchestrator"
  });
}
