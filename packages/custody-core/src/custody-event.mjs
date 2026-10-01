import { createHash } from "node:crypto";

import { verifyUnsignedTransactionIntent } from "./unsigned-intent.mjs";

const eventContextKeys = [
  "event_id",
  "occurred_at"
];
const domainEventKeys = [
  "actor",
  "aggregate_id",
  "aggregate_type",
  "causation_id",
  "correlation_id",
  "data_classification",
  "event_id",
  "event_type",
  "event_version",
  "idempotency_key",
  "occurred_at",
  "payload",
  "producer"
];
const actorKeys = [
  "subject",
  "type"
];
const withdrawalApprovedPayloadKeys = [
  "approval_id",
  "approver_count",
  "evidence_digest",
  "withdrawal_id"
];
const referencePattern = /^[a-z][a-z0-9_]{2,127}$/u;
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

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
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

function verifyWithdrawalApprovedEvent({ event, intent, targetEventId, targetOccurredAt }) {
  assertExactKeys(event, domainEventKeys, "withdrawal approval event");
  assertUuidV7(event.event_id, "withdrawal approval event_id");
  assert(
    event.causation_id === null ||
      (typeof event.causation_id === "string" && uuidV7Pattern.test(event.causation_id)),
    "withdrawal approval causation_id must be null or UUIDv7"
  );
  assert(
    event.causation_id !== event.event_id,
    "withdrawal approval event cannot cause itself"
  );
  assert(event.event_id !== targetEventId, "custody event must not reuse approval event_id");
  assert(event.event_type === "WithdrawalApproved", "source event must be WithdrawalApproved");
  assert(event.event_version === 1, "withdrawal approval event version must be 1");
  assert(event.producer === "approvals", "withdrawal approval producer must be approvals");
  assert(event.aggregate_type === "withdrawal", "withdrawal approval aggregate must be withdrawal");
  assert(
    event.aggregate_id === intent.command.withdrawal_id,
    "withdrawal approval aggregate does not match custody intent"
  );
  assert(
    event.correlation_id === intent.command.correlation_id,
    "withdrawal approval correlation does not match custody intent"
  );
  assert(event.idempotency_key === null, "withdrawal approval idempotency_key must be null");
  assert(
    event.data_classification === "highly-confidential",
    "withdrawal approval classification must be highly-confidential"
  );

  assertExactKeys(event.actor, actorKeys, "withdrawal approval actor");
  assert(event.actor.type === "operator", "withdrawal approval actor must be an operator");
  assert(
    typeof event.actor.subject === "string" &&
      referencePattern.test(event.actor.subject) &&
      event.actor.subject.startsWith("operator_"),
    "withdrawal approval actor subject must be an operator reference"
  );

  assertExactKeys(event.payload, withdrawalApprovedPayloadKeys, "withdrawal approval payload");
  assert(
    event.payload.withdrawal_id === intent.command.withdrawal_id,
    "withdrawal approval payload does not match custody intent"
  );
  assert(
    Number.isInteger(event.payload.approver_count) &&
      event.payload.approver_count === intent.approvals.length,
    "withdrawal approval count does not match custody evidence"
  );
  assert(
    event.payload.evidence_digest === intent.approval_evidence_digest,
    "withdrawal approval digest does not match custody evidence"
  );
  assert(
    typeof event.payload.approval_id === "string" &&
      referencePattern.test(event.payload.approval_id) &&
      event.payload.approval_id.startsWith("approval_"),
    "withdrawal approval_id must be an approval reference"
  );

  const sourceOccurredAt = parseTimestamp(
    event.occurred_at,
    "withdrawal approval occurred_at"
  );
  const latestApprovalAt = Math.max(
    ...intent.approvals.map((approval) => Date.parse(approval.approved_at))
  );
  assert(
    sourceOccurredAt >= latestApprovalAt,
    "withdrawal approval event cannot predate custody approvals"
  );
  assert(
    sourceOccurredAt <= targetOccurredAt,
    "custody event cannot predate WithdrawalApproved"
  );
}

export function createCustodyIntentPreparedEvent({
  context,
  intent,
  policy,
  withdrawalApprovedEvent
}) {
  assertExactKeys(context, eventContextKeys, "event context");
  assertUuidV7(context.event_id, "event_id");

  const occurredAt = parseTimestamp(context.occurred_at, "occurred_at");
  verifyUnsignedTransactionIntent({
    intent,
    now: new Date(occurredAt),
    policy
  });
  verifyWithdrawalApprovedEvent({
    event: withdrawalApprovedEvent,
    intent,
    targetEventId: context.event_id,
    targetOccurredAt: occurredAt
  });

  return deepFreeze({
    actor: {
      subject: "custody_orchestrator",
      type: "service"
    },
    aggregate_id: intent.command.withdrawal_id,
    aggregate_type: "withdrawal",
    causation_id: withdrawalApprovedEvent.event_id,
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

export function createCustodyProjectionRegistry() {
  const idempotency = new Map();
  const eventIds = new Map();
  const approvalEventIds = new Map();
  const withdrawalIds = new Map();
  const custodyIntentIds = new Map();

  function project(request) {
    const event = createCustodyIntentPreparedEvent(request);
    const requestDigest = digest(request);
    const idempotencyKey = event.idempotency_key;
    const prior = idempotency.get(idempotencyKey);

    if (prior) {
      assert(
        prior.request_digest === requestDigest,
        "custody projection idempotency key was reused with different evidence"
      );
      return prior.event;
    }

    for (const [registry, identity, message] of [
      [eventIds, event.event_id, "custody event_id has already been projected"],
      [
        approvalEventIds,
        event.causation_id,
        "WithdrawalApproved event has already been projected"
      ],
      [withdrawalIds, event.aggregate_id, "withdrawal already has a custody projection"],
      [
        custodyIntentIds,
        event.payload.custody_intent_id,
        "custody intent already has a projection"
      ]
    ]) {
      assert(!registry.has(identity), message);
    }

    const record = deepFreeze({
      event,
      request_digest: requestDigest
    });
    idempotency.set(idempotencyKey, record);
    eventIds.set(event.event_id, idempotencyKey);
    approvalEventIds.set(event.causation_id, idempotencyKey);
    withdrawalIds.set(event.aggregate_id, idempotencyKey);
    custodyIntentIds.set(event.payload.custody_intent_id, idempotencyKey);
    return event;
  }

  return Object.freeze({ project });
}
