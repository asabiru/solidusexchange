import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
const policy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const now = new Date("2026-10-01T12:02:00.000Z");

function command(overrides = {}) {
  return {
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
    ...overrides
  };
}

function approval(intentDigest, overrides = {}) {
  return {
    approval_id: "approval_001",
    approved_at: "2026-10-01T12:01:00.000Z",
    decision: "approved",
    evidence_digest: "a".repeat(64),
    intent_digest: intentDigest,
    role: "custody_maker",
    step_up_grant_id: "step_up_grant_001",
    subject_reference: "operator_ref_001",
    ...overrides
  };
}

function approvals(intentDigest, checkerOverrides = {}) {
  return [
    approval(intentDigest),
    approval(intentDigest, {
      approval_id: "approval_002",
      approved_at: "2026-10-01T12:01:30.000Z",
      evidence_digest: "b".repeat(64),
      role: "custody_checker",
      step_up_grant_id: "step_up_grant_002",
      subject_reference: "operator_ref_002",
      ...checkerOverrides
    })
  ];
}

function prepare(commandOverrides = {}, checkerOverrides = {}, policyInput = policy) {
  const custodyCommand = command(commandOverrides);
  const intentDigest = computeIntentDigest(custodyCommand, policyInput);
  return prepareUnsignedTransactionIntent({
    approvals: approvals(intentDigest, checkerOverrides),
    command: custodyCommand,
    now,
    policy: policyInput
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

function distinctSecondIntent(makerOverrides = {}, checkerOverrides = {}) {
  const custodyCommand = command({
    correlation_id: "018f3f8a-4000-7000-8000-000000000014",
    idempotency_key: "custody_idempotency_002",
    intent_id: "custody_intent_002",
    withdrawal_id: "withdrawal_002"
  });
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  return prepareUnsignedTransactionIntent({
    approvals: [
      approval(intentDigest, {
        approval_id: "approval_101",
        evidence_digest: "c".repeat(64),
        step_up_grant_id: "step_up_grant_101",
        subject_reference: "operator_ref_101",
        ...makerOverrides
      }),
      approval(intentDigest, {
        approval_id: "approval_102",
        approved_at: "2026-10-01T12:01:30.000Z",
        evidence_digest: "d".repeat(64),
        role: "custody_checker",
        step_up_grant_id: "step_up_grant_102",
        subject_reference: "operator_ref_102",
        ...checkerOverrides
      })
    ],
    command: custodyCommand,
    now,
    policy
  });
}

function secondProjection(intent, eventOverrides = {}) {
  return {
    context: context({ event_id: "018f3f8a-0018-7000-8000-000000000018" }),
    intent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
      event_id: "018f3f8a-0019-7000-8000-000000000019",
      payload: {
        approval_id: "approval_set_002",
        approver_count: intent.approvals.length,
        evidence_digest: intent.approval_evidence_digest,
        withdrawal_id: intent.command.withdrawal_id
      },
      ...eventOverrides
    })
  };
}

function seededRegistry(options) {
  const registry = createCustodyProjectionRegistry(options);
  const firstIntent = prepare();
  const request = {
    context: context(),
    intent: firstIntent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(firstIntent)
  };
  registry.project(request);
  return { firstIntent, registry, request };
}

test("the projection registry is bounded by a fixed entry capacity", () => {
  const { registry } = seededRegistry({ maxEntries: 1 });
  assert.throws(
    () => registry.project(secondProjection(distinctSecondIntent())),
    /custody projection registry capacity reached/u
  );
});

test("rejects non-integer or non-positive registry capacity", () => {
  for (const maxEntries of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "2",
    null
  ]) {
    assert.throws(
      () => createCustodyProjectionRegistry({ maxEntries }),
      /custody projection registry capacity must be a positive integer/u,
      `maxEntries=${String(maxEntries)}`
    );
  }
});

test("an exact replay does not consume registry capacity", () => {
  const { registry, request } = seededRegistry({ maxEntries: 1 });
  const replay = registry.project(request);
  assert.equal(replay.event_id, request.context.event_id);
});

test("a member approval id cannot be recited as an approval set id", () => {
  const { registry } = seededRegistry();
  const secondIntent = distinctSecondIntent();
  assert.throws(
    () =>
      registry.project(
        secondProjection(secondIntent, {
          payload: {
            approval_id: "approval_001",
            approver_count: secondIntent.approvals.length,
            evidence_digest: secondIntent.approval_evidence_digest,
            withdrawal_id: secondIntent.command.withdrawal_id
          }
        })
      ),
    /withdrawal approval set has already been consumed/u
  );
});

test("an approval set id cannot be recited as a member approval id", () => {
  const { registry } = seededRegistry();
  const secondIntent = distinctSecondIntent({ approval_id: "approval_set_001" });
  assert.throws(
    () => registry.project(secondProjection(secondIntent)),
    /custody approval has already been consumed/u
  );
});

test("a prepared event id cannot be recited as a source event id", () => {
  const { registry } = seededRegistry();
  const secondIntent = distinctSecondIntent();
  assert.throws(
    () =>
      registry.project(
        secondProjection(secondIntent, {
          event_id: "018f3f8a-0017-7000-8000-000000000017"
        })
      ),
    /WithdrawalApproved event has already been projected/u
  );
});

test("a source event id cannot be recited as a prepared event id", () => {
  const { registry } = seededRegistry();
  const secondIntent = distinctSecondIntent();
  assert.throws(
    () =>
      registry.project({
        context: context({ event_id: "018f3f8a-0012-7000-8000-000000000012" }),
        intent: secondIntent,
        policy,
        withdrawalApprovedEvent: secondProjection(secondIntent).withdrawalApprovedEvent
      }),
    /custody event_id has already been projected/u
  );
});

test("custody policy TTL parameters stay inside the dev bound", () => {
  for (const [override, expected] of [
    [{ approval_ttl_seconds: 86401 }, /approval TTL exceeds the custody dev bound/u],
    [{ maximum_intent_ttl_seconds: 86401 }, /intent TTL exceeds the custody dev bound/u],
    [
      { approval_ttl_seconds: Number.MAX_SAFE_INTEGER },
      /approval TTL exceeds the custody dev bound/u
    ],
    [
      { maximum_intent_ttl_seconds: Number.MAX_SAFE_INTEGER },
      /intent TTL exceeds the custody dev bound/u
    ]
  ]) {
    assert.throws(
      () => computeIntentDigest(command(), { ...policy, ...override }),
      expected
    );
  }
  assert.doesNotThrow(() =>
    computeIntentDigest(command(), {
      ...policy,
      approval_ttl_seconds: 86400,
      maximum_intent_ttl_seconds: 86400
    })
  );
});

test("inflated policy TTLs cannot revive stale approval evidence", () => {
  const inflatedPolicy = {
    ...policy,
    approval_ttl_seconds: Number.MAX_SAFE_INTEGER,
    maximum_intent_ttl_seconds: Number.MAX_SAFE_INTEGER
  };
  const weekOldCommand = command({
    created_at: "2026-10-01T00:00:00.000Z",
    expires_at: "2026-10-08T00:00:00.000Z"
  });
  assert.throws(
    () => {
      const intentDigest = computeIntentDigest(weekOldCommand, inflatedPolicy);
      prepareUnsignedTransactionIntent({
        approvals: [
          approval(intentDigest, {
            approved_at: "2026-10-01T00:00:30.000Z"
          }),
          approval(intentDigest, {
            approval_id: "approval_002",
            approved_at: "2026-10-01T00:01:00.000Z",
            evidence_digest: "b".repeat(64),
            role: "custody_checker",
            step_up_grant_id: "step_up_grant_002",
            subject_reference: "operator_ref_002"
          })
        ],
        command: weekOldCommand,
        now: new Date("2026-10-07T23:59:00.000Z"),
        policy: inflatedPolicy
      });
    },
    /TTL exceeds the custody dev bound/u
  );
});

test("canonical approval ordering does not depend on host collation", () => {
  const source = readFileSync(join(root, "src", "unsigned-intent.mjs"), "utf8");
  assert(!source.includes("localeCompare"), "canonical ordering must not use localeCompare");
});

test("the sealed envelope still exposes no signing surface", () => {
  const intent = prepare();
  assert.deepEqual(Object.keys(intent).sort(), [
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
  ]);
  for (const value of Object.values(intent)) {
    if (typeof value === "string") {
      assert(
        !value.includes("BEGIN") && !value.startsWith("0x"),
        "envelope field cannot carry opaque payload material"
      );
    }
  }
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent: { ...intent, signed_blob: "ff".repeat(32) },
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
      }),
    /fields must exactly match the custody contract/u
  );
});
