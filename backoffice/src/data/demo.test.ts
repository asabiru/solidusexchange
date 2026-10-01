import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalCommandDigest } from "../server/controls.js";
import { demoRepository, type ReadonlyBackofficeRepository } from "./demo.js";

const collections = [
  "metrics",
  "queues",
  "customers",
  "kycCases",
  "amlCases",
  "investigationCases",
  "fraudAlerts",
  "approvals",
  "auditSource"
] as const satisfies readonly (keyof ReadonlyBackofficeRepository)[];

function assertDeepFrozen(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${path} is mutable`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

describe("synthetic read-only repository", () => {
  it("deeply freezes every synthetic collection", () => {
    for (const collection of collections) {
      const rows = demoRepository[collection]();
      assert.ok(rows.length > 0, `${collection} is empty`);
      assertDeepFrozen(rows, collection);
    }
  });

  it("rejects runtime mutation of shared synthetic state", () => {
    const approval = demoRepository.approvals()[0];
    const digest = approvalCommandDigest(approval);
    const mutableApproval = approval as { exposure: string; completedApprovals: number };
    const mutableEvidence = approval.evidenceItems as unknown as { status: string }[];
    const mutableApprovals = demoRepository.approvals() as unknown[];
    const mutableAudit = demoRepository.auditSource() as unknown as { outcome: string }[];

    assert.throws(() => { mutableApproval.exposure = "₽ 0"; }, TypeError);
    assert.throws(() => { mutableApproval.completedApprovals = 99; }, TypeError);
    assert.throws(() => { mutableEvidence[0].status = "ready"; }, TypeError);
    assert.throws(() => { mutableEvidence.push({ status: "ready" }); }, TypeError);
    assert.throws(() => { mutableApprovals.length = 0; }, TypeError);
    assert.throws(() => { mutableAudit[0].outcome = "denied"; }, TypeError);

    assert.equal(approvalCommandDigest(demoRepository.approvals()[0]), digest);
    assert.equal(demoRepository.approvals()[0], approval);
  });
});
