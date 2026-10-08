import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { can } from "../auth/access.js";
import { checkStatuses } from "../server/checks.js";
import { demoRepository, type CheckStatus } from "../data/demo.js";
import { hasMessage } from "./i18n.js";
import { navigation } from "./navigation.js";

const docStatuses = [
  "created",
  "waiting-recipient-kyc",
  "claimed",
  "cancelled",
  "expired"
] as const satisfies readonly CheckStatus[];

describe("checks queue wiring", () => {
  it("exposes a checks screen gated by the checks:read capability", () => {
    const item = navigation.find((entry) => entry.id === "checks");
    assert.ok(item);
    assert.equal(item.group, "money-movement");
    assert.equal(item.capability, "checks:read");
    assert.equal(item.implemented, true);
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "auditor"]) {
      assert.equal(can(role, "checks:read"), true, role);
    }
    assert.equal(can("fraud-investigator", "checks:read"), false);
  });

  it("covers every documented check status with data and a localized label", () => {
    assert.deepEqual([...checkStatuses], [...docStatuses]);
    const statuses = new Set(demoRepository.chatChecks().map((check) => check.status));
    for (const status of docStatuses) {
      assert.ok(statuses.has(status), status);
      assert.equal(hasMessage(`checks.status.${status}`), true, status);
    }
    assert.equal(hasMessage("checks.status.all"), true);
    assert.equal(hasMessage("screen.checks"), true);
  });

  it("keeps amounts exact decimal strings and carries no command surface", () => {
    for (const check of demoRepository.chatChecks()) {
      assert.match(check.id, /^CHK-\d{6}$/);
      assert.equal(check.kind, "personal");
      assert.match(check.amount, /^\d+\.\d+$/);
      assert.match(check.fee, /^\d+\.\d+$/);
      assert.ok(check.timeline.length > 0);
      assert.ok(check.evidenceItems.length > 0);
      assert.match(check.auditEvidenceDigest, /^sha256:[0-9a-f]+$/);
      assert.deepEqual(
        Object.keys(check).filter((key) => /release|refund|execute|command|action/i.test(key)),
        []
      );
    }
  });
});
