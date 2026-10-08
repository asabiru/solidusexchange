import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  prepareUnsignedTransactionIntent,
  verifyUnsignedTransactionIntent
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

test("one step-up grant cannot satisfy both maker and checker", () => {
  assert.throws(
    () =>
      prepare({}, {
        step_up_grant_id: "step_up_grant_001"
      }),
    /step-up grant references must be unique/u
  );
});

test("one evidence digest cannot back two distinct approvals", () => {
  assert.throws(
    () =>
      prepare({}, {
        evidence_digest: "a".repeat(64)
      }),
    /approval evidence digests must be unique/u
  );
});

test("amount cannot exceed the ledger precision limit", () => {
  assert.throws(
    () => prepare({ amount: `${"9".repeat(79)}` }),
    /custody precision limit/u
  );
  assert.throws(
    () => prepare({ amount: `${"9".repeat(77)}.${"0".repeat(6)}` }),
    /custody precision limit/u
  );
  assert.doesNotThrow(() =>
    prepare({ amount: `${"9".repeat(72)}.000001` })
  );
});

test("command references require a suffix and stay inside the outbox bound", () => {
  assert.throws(
    () => prepare({ withdrawal_id: "withdrawal_" }),
    /withdrawal_id must be a withdrawal_ reference/u
  );
  assert.throws(
    () => prepare({ intent_id: `custody_intent_${"x".repeat(113)}` }),
    /intent_id must be a custody_intent_ reference/u
  );
  assert.throws(
    () => prepare({ idempotency_key: `custody_idempotency_${"x".repeat(108)}` }),
    /idempotency_key must be a custody_idempotency_ reference/u
  );
  assert.doesNotThrow(() =>
    prepare({ intent_id: `custody_intent_${"x".repeat(112)}` })
  );
});

test("withdrawal approval operator subject cannot be a bare prefix", () => {
  const intent = prepare();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          actor: { subject: "operator_", type: "operator" }
        })
      }),
    /actor subject must be an operator reference/u
  );
});

test("withdrawal approval payload approval_id cannot be a bare prefix", () => {
  const intent = prepare();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          payload: {
            approval_id: "approval_",
            approver_count: intent.approvals.length,
            evidence_digest: intent.approval_evidence_digest,
            withdrawal_id: intent.command.withdrawal_id
          }
        })
      }),
    /approval_id must be an approval reference/u
  );
});

test("rejects non-positive, over-scale and non-string amounts", () => {
  for (const [amount, expected] of [
    ["0", /must be positive/u],
    ["0.000000", /must be positive/u],
    ["-1", /canonical positive decimal/u],
    ["+1", /canonical positive decimal/u],
    ["1.0000000", /exceeds asset scale/u],
    ["25.000001\t", /canonical positive decimal/u],
    ["1_000", /canonical positive decimal/u],
    ["1e6", /canonical positive decimal/u]
  ]) {
    assert.throws(() => prepare({ amount }), expected, `amount=${amount}`);
  }
  assert.throws(
    () => prepare({ amount: 25.5 }),
    /amount must be a decimal string/u
  );
});

test("rejects non-canonical, expired and out-of-range intent timing", () => {
  assert.throws(
    () => prepare({ created_at: "2026-10-01T12:00:00Z" }),
    /canonical UTC form/u
  );
  assert.throws(
    () => prepare({ created_at: "2026-10-01T12:02:00.001Z" }),
    /cannot be created in the future/u
  );
  assert.throws(
    () =>
      prepare({
        created_at: "2026-10-01T11:56:00.000Z",
        expires_at: "2026-10-01T12:04:00.000Z"
      }),
    /TTL exceeds custody policy/u
  );
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals("0".repeat(64)),
        command: command({ expires_at: "2026-10-01T12:02:00.000Z" }),
        now,
        policy
      }),
    /intent has expired/u
  );
});

test("rejects approvals outside the intent validity window", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest, {
          approved_at: "2026-10-01T11:59:59.999Z"
        }),
        command: custodyCommand,
        now,
        policy
      }),
    /predates the custody intent/u
  );
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest, {
          approved_at: "2026-10-01T12:03:00.000Z"
        }),
        command: custodyCommand,
        now,
        policy
      }),
    /cannot be approved in the future/u
  );
});

test("rejects duplicate approval identifiers and roles", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: [
          approval(intentDigest),
          approval(intentDigest, {
            approved_at: "2026-10-01T12:01:30.000Z",
            role: "custody_checker",
            step_up_grant_id: "step_up_grant_002",
            subject_reference: "operator_ref_002"
          })
        ],
        command: custodyCommand,
        now,
        policy
      }),
    /approval IDs must be unique/u
  );
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: [
          approval(intentDigest),
          approval(intentDigest, {
            approval_id: "approval_002",
            approved_at: "2026-10-01T12:01:30.000Z",
            step_up_grant_id: "step_up_grant_002",
            subject_reference: "operator_ref_002"
          })
        ],
        command: custodyCommand,
        now,
        policy
      }),
    /approval roles must be unique/u
  );
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: [
          approval(intentDigest),
          approval(intentDigest, {
            approval_id: "approval_002",
            approved_at: "2026-10-01T12:01:30.000Z",
            role: "custody_observer",
            step_up_grant_id: "step_up_grant_002",
            subject_reference: "operator_ref_002"
          })
        ],
        command: custodyCommand,
        now,
        policy
      }),
    /role is not allowed/u
  );
});

test("rejects non-approval decisions and malformed evidence digests", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest, { decision: "rejected" }),
        command: custodyCommand,
        now,
        policy
      }),
    /decision must be approved/u
  );
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest, { evidence_digest: "not-sha256" }),
        command: custodyCommand,
        now,
        policy
      }),
    /evidence_digest must be SHA-256/u
  );
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest, { approved_at: "next week" }),
        command: custodyCommand,
        now,
        policy
      }),
    /RFC 3339 timestamp/u
  );
});

function evidenceDigestOf(approvals) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonicalize(value[key])])
      );
    }
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(approvals)))
    .digest("hex");
}

test("verify rejects approvals stored out of canonical order", () => {
  const intent = prepare();
  const reorderedApprovals = [...intent.approvals].reverse();
  const reordered = {
    ...structuredClone(intent),
    approval_evidence_digest: evidenceDigestOf(reorderedApprovals),
    approvals: reorderedApprovals
  };
  assert.throws(
    () =>
      verifyUnsignedTransactionIntent({
        intent: reordered,
        now,
        policy
      }),
    /must remain canonically ordered/u
  );
});

test("withdrawal approval event requires operator actor and exact classification", () => {
  const intent = prepare();
  for (const [overrides, expected] of [
    [
      { actor: { subject: "operator_002", type: "service" } },
      /actor must be an operator/u
    ],
    [
      { actor: { subject: "user_002", type: "operator" } },
      /actor subject must be an operator reference/u
    ],
    [
      { data_classification: "confidential" },
      /classification must be highly-confidential/u
    ],
    [{ event_version: 2 }, /event version must be 1/u],
    [{ producer: "custody-orchestrator" }, /producer must be approvals/u],
    [{ aggregate_type: "intent" }, /aggregate must be withdrawal/u],
    [
      { idempotency_key: "custody_idempotency_001" },
      /idempotency_key must be null/u
    ],
    [
      {
        payload: {
          approval_id: "approval_set_001",
          approver_count: 3,
          evidence_digest: "a".repeat(64),
          withdrawal_id: "withdrawal_001"
        }
      },
      /count does not match custody evidence/u
    ]
  ]) {
    assert.throws(
      () =>
        createCustodyIntentPreparedEvent({
          context: context(),
          intent,
          policy,
          withdrawalApprovedEvent: withdrawalApprovedEvent(intent, overrides)
        }),
      expected
    );
  }
});

test("withdrawal approval event cannot cause itself or reuse the prepared event id", () => {
  const intent = prepare();
  assert.throws(
    () =>
      createCustodyIntentPreparedEvent({
        context: context(),
        intent,
        policy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(intent, {
          causation_id: "018f3f8a-0012-7000-8000-000000000012"
        })
      }),
    /cannot cause itself/u
  );
});

test("projection registry rejects replay with tampered policy", () => {
  const registry = createCustodyProjectionRegistry();
  const intent = prepare();
  registry.project({
    context: context(),
    intent,
    policy,
    withdrawalApprovedEvent: withdrawalApprovedEvent(intent)
  });
  const tamperedPolicy = {
    ...policy,
    approval_ttl_seconds: policy.approval_ttl_seconds + 60
  };
  const tamperedCommand = command({ policy_version: "custody-dev-v1" });
  const tamperedDigest = computeIntentDigest(tamperedCommand, tamperedPolicy);
  const tamperedIntent = prepareUnsignedTransactionIntent({
    approvals: approvals(tamperedDigest, {}),
    command: tamperedCommand,
    now,
    policy: tamperedPolicy
  });
  assert.throws(
    () =>
      registry.project({
        context: context({
          event_id: "018f3f8a-0018-7000-8000-000000000018"
        }),
        intent: tamperedIntent,
        policy: tamperedPolicy,
        withdrawalApprovedEvent: withdrawalApprovedEvent(tamperedIntent, {
          event_id: "018f3f8a-0019-7000-8000-000000000019"
        })
      }),
    /idempotency key was reused with different evidence/u
  );
});
