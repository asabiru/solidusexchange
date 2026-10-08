import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "../auth/access.js";
import { withdrawalStatuses } from "../server/withdrawals.js";
import { demoRepository, type WithdrawalIntentStatus } from "../data/demo.js";
import { hasMessage } from "./i18n.js";
import { navigation } from "./navigation.js";

const docStatuses = [
  "draft",
  "pending-approval",
  "screened",
  "broadcast",
  "confirmed",
  "rejected",
  "cancelled"
] as const satisfies readonly WithdrawalIntentStatus[];

describe("withdrawal intents wiring", () => {
  it("exposes a withdrawal screen gated by the custody:read capability", () => {
    const item = navigation.find((entry) => entry.id === "withdrawal");
    assert.ok(item);
    assert.equal(item.group, "money-movement");
    assert.equal(item.capability, "custody:read");
    assert.equal(item.implemented, true);
    for (const role of ["compliance-lead", "aml-investigator", "auditor"]) {
      assert.equal(can(role, "custody:read"), true, role);
    }
    assert.equal(can("support-l1", "custody:read"), false);
    assert.equal(can("fraud-investigator", "custody:read"), false);
  });

  it("covers every documented intent status with data and a localized label", () => {
    assert.deepEqual([...withdrawalStatuses], [...docStatuses]);
    const statuses = new Set(demoRepository.withdrawalIntents().map((intent) => intent.status));
    for (const status of docStatuses) {
      assert.ok(statuses.has(status), status);
      assert.equal(hasMessage(`withdrawals.status.${status}`), true, status);
    }
    assert.equal(hasMessage("withdrawals.status.all"), true);
    assert.equal(hasMessage("screen.withdrawal"), true);
  });

  it("keeps amounts exact decimal strings and carries no command surface", () => {
    for (const intent of demoRepository.withdrawalIntents()) {
      assert.match(intent.id, /^WDR-\d{6}$/);
      assert.match(intent.subject, /^sim-/);
      assert.match(intent.intentId, /^custody_intent_[a-z0-9_]+$/);
      assert.match(intent.withdrawalId, /^withdrawal_[a-z0-9_]+$/);
      assert.match(intent.destinationReference, /^destination_ref_[a-z0-9_]+$/);
      assert.match(intent.idempotencyKey, /^custody_idempotency_[a-z0-9_]+$/);
      assert.match(intent.amount, /^\d+\.\d+$/);
      assert.match(intent.network, /_TESTNET$/);
      assert.equal(intent.policyVersion, "custody-dev-v1");
      assert.equal(intent.runtimeBoundary, "dev-dry-run");
      assert.equal(intent.executionAuthority, false);
      assert.equal(intent.productionSigningEnabled, false);
      assert.equal(intent.keyMaterialPresent, false);
      assert.equal(intent.requiredApprovals, 2);
      for (const step of intent.approvalSteps) {
        assert.match(step.id, /^approval_[a-z0-9_]+$/);
        assert.match(step.subjectReference, /^operator_ref_[a-z0-9_]+$/);
        assert.ok(["custody_maker", "custody_checker"].includes(step.role));
      }
      assert.ok(intent.timeline.length > 0);
      assert.ok(intent.evidenceItems.length > 0);
      assert.match(intent.auditEvidenceDigest, /^sha256:[0-9a-f]+$/);
      assert.deepEqual(
        Object.keys(intent).filter((key) => /approve|broadcast|cancel|execute|command|action/i.test(key)),
        []
      );
    }
  });
});
