import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCustodyIntentPreparedEvent } from "../src/custody-event.mjs";
import {
  computeIntentDigest,
  prepareUnsignedTransactionIntent
} from "../src/unsigned-intent.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "..", "..");
const policy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const now = new Date("2026-10-01T12:02:00.000Z");

function preparedIntent() {
  const command = {
    amount: "25.000001",
    asset: "USDT",
    correlation_id: "018f3f8a-4000-7000-8000-000000000004",
    created_at: "2026-10-01T12:00:00.000Z",
    destination_reference: "destination_ref_001",
    expires_at: "2026-10-01T12:05:00.000Z",
    idempotency_key: "custody_idempotency_001",
    intent_id: "custody_intent_001",
    legal_entity_id: "legal_entity_001",
    network: "TRON_TESTNET",
    policy_version: "custody-dev-v1",
    withdrawal_id: "withdrawal_001"
  };
  const intentDigest = computeIntentDigest(command, policy);
  return prepareUnsignedTransactionIntent({
    approvals: [
      {
        approval_id: "approval_001",
        approved_at: "2026-10-01T12:01:00.000Z",
        decision: "approved",
        evidence_digest: "a".repeat(64),
        intent_digest: intentDigest,
        role: "custody_maker",
        step_up_grant_id: "step_up_grant_001",
        subject_reference: "operator_ref_001"
      },
      {
        approval_id: "approval_002",
        approved_at: "2026-10-01T12:01:30.000Z",
        decision: "approved",
        evidence_digest: "b".repeat(64),
        intent_digest: intentDigest,
        role: "custody_checker",
        step_up_grant_id: "step_up_grant_002",
        subject_reference: "operator_ref_002"
      }
    ],
    command,
    now,
    policy
  });
}

function context(overrides = {}) {
  return {
    causation_id: "018f3f8a-0012-7000-8000-000000000012",
    event_id: "018f3f8a-0017-7000-8000-000000000017",
    occurred_at: "2026-10-01T12:02:00.000Z",
    ...overrides
  };
}

test("projects an immutable reference-only CustodyIntentPrepared event", () => {
  const intent = preparedIntent();
  const event = createCustodyIntentPreparedEvent({
    context: context(),
    intent,
    policy
  });

  assert.equal(event.event_type, "CustodyIntentPrepared");
  assert.equal(event.aggregate_id, intent.command.withdrawal_id);
  assert.equal(event.correlation_id, intent.command.correlation_id);
  assert.equal(event.idempotency_key, intent.command.idempotency_key);
  assert.equal(event.payload.custody_intent_id, intent.command.intent_id);
  assert.equal(event.payload.intent_digest, intent.intent_digest);
  assert.equal(event.payload.policy_digest, intent.policy_digest);
  assert.equal(event.payload.approval_evidence_digest, intent.approval_evidence_digest);
  assert.equal(event.payload.execution_authority, false);
  assert.equal(event.payload.production_signing_enabled, false);
  assert.equal(event.payload.status, "unsigned_intent_ready");
  assert(!Object.hasOwn(event.payload, "destination_reference"));
  assert(!Object.hasOwn(event.payload, "approvals"));
  assert(Object.isFrozen(event));
  assert(Object.isFrozen(event.payload));
});

test("matches the canonical API domain event contract", () => {
  const event = createCustodyIntentPreparedEvent({
    context: context(),
    intent: preparedIntent(),
    policy
  });
  const schema = JSON.parse(
    readFileSync(
      join(repositoryRoot, "packages/api-contracts/schemas/events/domain-event.schema.json"),
      "utf8"
    )
  );
  const catalog = JSON.parse(
    readFileSync(join(repositoryRoot, "packages/api-contracts/event-catalog.json"), "utf8")
  );
  const condition = schema.allOf.find(
    (candidate) =>
      candidate.if?.properties?.event_type?.const === "CustodyIntentPrepared"
  );
  const payloadSchema = schema.$defs.custodyIntentPrepared;
  const catalogEntry = catalog.events.find(
    (candidate) => candidate.name === "CustodyIntentPrepared"
  );

  assert(schema.properties.event_type.enum.includes(event.event_type));
  assert.equal(condition.then.properties.aggregate_type.const, event.aggregate_type);
  assert.equal(condition.then.properties.payload.$ref, "#/$defs/custodyIntentPrepared");
  assert.deepEqual(Object.keys(event).sort(), [...schema.required].sort());
  assert.deepEqual(Object.keys(event.payload).sort(), [...payloadSchema.required].sort());
  assert.equal(payloadSchema.properties.status.const, event.payload.status);
  assert.equal(
    payloadSchema.properties.execution_authority.const,
    event.payload.execution_authority
  );
  assert.equal(
    payloadSchema.properties.production_signing_enabled.const,
    event.payload.production_signing_enabled
  );
  assert.match(event.payload.network, new RegExp(payloadSchema.properties.network.pattern));
  for (const field of [
    "approval_evidence_digest",
    "intent_digest",
    "policy_digest"
  ]) {
    assert.match(event.payload[field], new RegExp(schema.$defs.digest.pattern));
  }
  assert.equal(catalogEntry.owner, event.producer);
  assert.equal(catalogEntry.aggregate_type, event.aggregate_type);
  assert.equal(catalogEntry.data_classification, event.data_classification);
});

test("rejects tampered intent evidence", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent: {
          ...intent,
          intent_digest: "c".repeat(64)
        },
        policy
      }),
    /intent digest does not match sealed command and policy/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent: {
          ...intent,
          execution_authority: true
        },
        policy
      }),
    /execution authority must remain disabled/u
  );
});

test("rejects invalid event identity and causation", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({ event_id: "event_001" }),
        intent,
        policy
      }),
    /event_id must be a UUIDv7/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({
          causation_id: "018f3f8a-0017-7000-8000-000000000017"
        }),
        intent,
        policy
      }),
    /event_id and causation_id must differ/u
  );
});

test("rejects events before approvals or after intent expiry", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({ occurred_at: "2026-10-01T12:01:00.000Z" }),
        intent,
        policy
      }),
    /cannot be approved in the future/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({ occurred_at: "2026-10-01T12:05:00.000Z" }),
        intent,
        policy
      }),
    /intent has expired/u
  );
});

test("rejects policy drift and signing-enabled policy", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy: {
          ...policy,
          approval_ttl_seconds: policy.approval_ttl_seconds - 1
        }
      }),
    /intent policy digest does not match custody policy/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy: {
          ...policy,
          production_signing_enabled: true
        }
      }),
    /production signing must remain disabled/u
  );
});
