import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
    correlation_id: "correlation_withdrawal_001",
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

function approvals(intentDigest, overrides = {}) {
  return [
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
      subject_reference: "operator_ref_002",
      ...overrides
    }
  ];
}

test("prepares an immutable unsigned intent without execution authority", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  const intent = prepareUnsignedTransactionIntent({
    approvals: approvals(intentDigest).reverse(),
    command: custodyCommand,
    now,
    policy
  });

  assert.equal(intent.status, "unsigned_intent_ready");
  assert.equal(intent.intent_digest, intentDigest);
  assert.equal(intent.execution_authority, false);
  assert.equal(intent.production_signing_enabled, false);
  assert.equal(intent.key_material_present, false);
  assert.deepEqual(intent.approvals.map(({ role }) => role), [
    "custody_checker",
    "custody_maker"
  ]);
  assert(Object.isFrozen(intent));
  assert(Object.isFrozen(intent.command));
  assert(Object.isFrozen(intent.approvals));
});

test("digest is deterministic across command property order", () => {
  const custodyCommand = command();
  const reordered = Object.fromEntries(Object.entries(custodyCommand).reverse());
  assert.equal(
    computeIntentDigest(reordered, policy),
    computeIntentDigest(custodyCommand, policy)
  );
});

test("rejects missing maker-checker quorum", () => {
  const custodyCommand = command();
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(computeIntentDigest(custodyCommand, policy)).slice(0, 1),
        command: custodyCommand,
        now,
        policy
      }),
    /maker-checker approval quorum is missing/u
  );
});

test("rejects the same human as maker and checker", () => {
  const custodyCommand = command();
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(computeIntentDigest(custodyCommand, policy), {
          subject_reference: "operator_ref_001"
        }),
        command: custodyCommand,
        now,
        policy
      }),
    /maker and checker must be different humans/u
  );
});

test("rejects approval evidence bound to another intent", () => {
  const custodyCommand = command();
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals("c".repeat(64)),
        command: custodyCommand,
        now,
        policy
      }),
    /intent_digest does not match command and policy/u
  );
});

test("rejects approval evidence after custody policy drift", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest),
        command: custodyCommand,
        now,
        policy: {
          ...policy,
          approval_ttl_seconds: policy.approval_ttl_seconds - 1
        }
      }),
    /intent_digest does not match command and policy/u
  );
});

test("rejects expired approval evidence", () => {
  const custodyCommand = command();
  const stalePolicy = {
    ...policy,
    approval_ttl_seconds: 60
  };
  const intentDigest = computeIntentDigest(custodyCommand, stalePolicy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest, {
          approved_at: "2026-10-01T12:00:30.000Z"
        }),
        command: custodyCommand,
        now,
        policy: stalePolicy
      }),
    /approval has expired/u
  );
});

test("rejects mainnet and unapproved asset combinations", () => {
  const custodyCommand = command({ network: "TRON_MAINNET" });
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest),
        command: custodyCommand,
        now,
        policy
      }),
    /outside the dev custody allowlist/u
  );
});

test("rejects raw addresses and key material", () => {
  const custodyCommand = {
    ...command(),
    destination_address: "TExampleAddress"
  };
  assert.throws(
    () => computeIntentDigest(custodyCommand, policy),
    /contains restricted custody material/u
  );

  const commandWithKey = {
    ...command(),
    private_key: "not-a-real-key"
  };
  assert.throws(
    () => computeIntentDigest(commandWithKey, policy),
    /contains restricted custody material/u
  );
});

test("rejects production execution or signing policy", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  for (const [override, expected] of [
    [{ execution_authority: true }, /execution authority must remain disabled/u],
    [{ production_signing_enabled: true }, /production signing must remain disabled/u],
    [{ key_material_allowed: true }, /key material must remain prohibited/u]
  ]) {
    assert.throws(
      () =>
        prepareUnsignedTransactionIntent({
          approvals: approvals(intentDigest),
          command: custodyCommand,
          now,
          policy: {
            ...policy,
            ...override
          }
        }),
      expected
    );
  }
});

test("rejects custody policy containing key material", () => {
  const custodyCommand = command();
  const intentDigest = computeIntentDigest(custodyCommand, policy);
  assert.throws(
    () =>
      prepareUnsignedTransactionIntent({
        approvals: approvals(intentDigest),
        command: custodyCommand,
        now,
        policy: {
          ...policy,
          private_key: "not-a-real-key"
        }
      }),
    /contains restricted custody material/u
  );
});
