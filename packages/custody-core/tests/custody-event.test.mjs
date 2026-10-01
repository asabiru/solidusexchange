import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCustodyIntentPreparedEvent,
  createCustodyProjectionRegistry
} from "../src/custody-event.mjs";
import {
  computeIntentDigest,
  prepareUnsignedTransactionIntent
} from "../src/unsigned-intent.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "..", "..");
const policy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const now = new Date("2026-10-01T12:02:00.000Z");

function preparedIntent(commandOverrides = {}) {
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
    withdrawal_id: "withdrawal_001",
    ...commandOverrides
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
    event_id: "018f3f8a-0017-7000-8000-000000000017",
    occurred_at: "2026-10-01T12:02:00.000Z",
    ...overrides
  };
}

function withdrawalApprovedEvent(intent, overrides = {}) {
  return {
    actor: {
      subject: "operator_002",
      type: "operator"
    },
    aggregate_id: intent.command.withdrawal_id,
    aggregate_type: "withdrawal",
    causation_id: "018f3f8a-0011-7000-8000-000000000011",
    correlation_id: intent.command.correlation_id,
    data_classification: "highly-confidential",
    event_id: "018f3f8a-0012-7000-8000-000000000012",
    event_type: "WithdrawalApproved",
    event_version: 1,
    idempotency_key: null,
    occurred_at: "2026-10-01T12:01:45.000Z",
    payload: {
      approval_id: "approval_set_001",
      approver_count: intent.approvals.length,
      evidence_digest: intent.approval_evidence_digest,
      withdrawal_id: intent.command.withdrawal_id
    },
    producer: "approvals",
    ...overrides
  };
}

test("projects an immutable reference-only CustodyIntentPrepared event", () => {
  const intent = preparedIntent();
  const event = createCustodyIntentPreparedEvent({
    context: context(),
    intent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
  });

  assert.equal(event.event_type, "CustodyIntentPrepared");
  assert.equal(event.causation_id, "018f3f8a-0012-7000-8000-000000000012");
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

test("returns the original event for an exact custody projection replay", () => {
  const registry = createCustodyProjectionRegistry();
  const intent = preparedIntent();
  const request = {
    context: context(),
    intent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
  };
  const first = registry.project(request);
  const replay = registry.project({
    context: {
      occurred_at: request.context.occurred_at,
      event_id: request.context.event_id
    },
    intent: {
      ...request.intent,
      command: { ...request.intent.command }
    },
    policy: { ...request.policy },
    withdrawalApprovedEvent: {
      ...request.withdrawalApprovedEvent,
      actor: { ...request.withdrawalApprovedEvent.actor },
      payload: { ...request.withdrawalApprovedEvent.payload }
    }
  });

  assert.equal(replay, first);
});

test("rejects conflicting custody projection replays", () => {
  const registry = createCustodyProjectionRegistry();
  const intent = preparedIntent();
  registry.project({
    context: context(),
    intent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
  });

  assert.throws(
    () =>
      registry.project({
        context: context({
          event_id: "018f3f8a-0018-7000-8000-000000000018"
        }),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /idempotency key was reused with different evidence/u
  );
});

test("rejects duplicate custody projection identities", () => {
  const firstIntent = preparedIntent();
  const firstRequest = {
    context: context(),
    intent: firstIntent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(firstIntent)
  };
  const secondIntent = preparedIntent({
    idempotency_key: "custody_idempotency_002",
    intent_id: "custody_intent_002"
  });

  const duplicateEventRegistry = createCustodyProjectionRegistry();
  duplicateEventRegistry.project(firstRequest);
  assert.throws(
    () =>
      duplicateEventRegistry.project({
        context: context(),
        intent: secondIntent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(secondIntent, {
          event_id: "018f3f8a-0019-7000-8000-000000000019"
        })
      }),
    /event_id has already been projected/u
  );

  const duplicateApprovalRegistry = createCustodyProjectionRegistry();
  duplicateApprovalRegistry.project(firstRequest);
  assert.throws(
    () =>
      duplicateApprovalRegistry.project({
        context: context({
          event_id: "018f3f8a-0018-7000-8000-000000000018"
        }),
        intent: secondIntent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(secondIntent)
      }),
    /WithdrawalApproved event has already been projected/u
  );

  const duplicateWithdrawalRegistry = createCustodyProjectionRegistry();
  duplicateWithdrawalRegistry.project(firstRequest);
  assert.throws(
    () =>
      duplicateWithdrawalRegistry.project({
        context: context({
          event_id: "018f3f8a-0018-7000-8000-000000000018"
        }),
        intent: secondIntent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(secondIntent, {
          event_id: "018f3f8a-0019-7000-8000-000000000019"
        })
      }),
    /withdrawal already has a custody projection/u
  );

  const duplicateIntentRegistry = createCustodyProjectionRegistry();
  duplicateIntentRegistry.project(firstRequest);
  const reusedIntent = preparedIntent({
    idempotency_key: "custody_idempotency_002",
    withdrawal_id: "withdrawal_002"
  });
  assert.throws(
    () =>
      duplicateIntentRegistry.project({
        context: context({
          event_id: "018f3f8a-0018-7000-8000-000000000018"
        }),
        intent: reusedIntent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(reusedIntent, {
          event_id: "018f3f8a-0019-7000-8000-000000000019"
        })
      }),
    /custody intent already has a projection/u
  );
});

test("matches the canonical API domain event contract", () => {
  const intent = preparedIntent();
  const sourceEvent = withdrawalApprovedEvent(intent);
  const event = createCustodyIntentPreparedEvent({
    context: context(),
    intent,
    policy,
    withdrawalApprovedEvent: sourceEvent
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
  const approvalCondition = schema.allOf.find(
    (candidate) =>
      candidate.if?.properties?.event_type?.const === "WithdrawalApproved"
  );
  const payloadSchema = schema.$defs.custodyIntentPrepared;
  const approvalPayloadSchema = schema.$defs.withdrawalApproved;
  const catalogEntry = catalog.events.find(
    (candidate) => candidate.name === "CustodyIntentPrepared"
  );

  assert(schema.properties.event_type.enum.includes(event.event_type));
  assert(schema.properties.event_type.enum.includes(sourceEvent.event_type));
  assert.equal(
    approvalCondition.then.properties.aggregate_type.const,
    sourceEvent.aggregate_type
  );
  assert.equal(
    approvalCondition.then.properties.payload.$ref,
    "#/$defs/withdrawalApproved"
  );
  assert.deepEqual(Object.keys(sourceEvent).sort(), [...schema.required].sort());
  assert.deepEqual(
    Object.keys(sourceEvent.payload).sort(),
    [...approvalPayloadSchema.required].sort()
  );
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
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
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
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /execution authority must remain disabled/u
  );
});

test("rejects invalid or reused event identity", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({ event_id: "event_001" }),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /event_id must be a UUIDv7/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({
          event_id: "018f3f8a-0012-7000-8000-000000000012"
        }),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /must not reuse approval event_id/u
  );
});

test("rejects withdrawal approval continuity drift", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          correlation_id: "018f3f8a-4000-7000-8000-000000000099"
        })
      }),
    /correlation does not match custody intent/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          payload: {
            approval_id: "approval_set_001",
            approver_count: intent.approvals.length,
            evidence_digest: "f".repeat(64),
            withdrawal_id: intent.command.withdrawal_id
          }
        })
      }),
    /digest does not match custody evidence/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          occurred_at: "2026-10-01T12:01:00.000Z"
        })
      }),
    /cannot predate custody approvals/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          occurred_at: "2026-10-01T12:02:30.000Z"
        })
      }),
    /cannot predate WithdrawalApproved/u
  );
});

test("rejects events before approvals or after intent expiry", () => {
  const intent = preparedIntent();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({ occurred_at: "2026-10-01T12:01:00.000Z" }),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /cannot be approved in the future/u
  );
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context({ occurred_at: "2026-10-01T12:05:00.000Z" }),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
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
        },
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
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
        },
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /production signing must remain disabled/u
  );
});
