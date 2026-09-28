import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoRepository } from "../data/demo.js";
import {
  approvalCommandDigest,
  buildApprovalPreview,
  buildAuditChain,
  verifyAuditChain
} from "./controls.js";

describe("protected control contracts", () => {
  it("builds a verifiable append-only audit chain", () => {
    const audit = buildAuditChain(demoRepository.auditSource());
    assert.equal(verifyAuditChain(audit), true);
    assert.equal(Object.isFrozen(audit), true);
    assert.equal(Object.isFrozen(audit[0]), true);
    assert.equal(audit[0].previousHash, "0".repeat(64));
    assert.equal(audit.at(-1)?.hash.length, 64);
  });

  it("rejects a modified audit event", () => {
    const audit = buildAuditChain(demoRepository.auditSource());
    const tampered = audit.map((event, index) =>
      index === 1 ? { ...event, resource: "withdrawal:tampered" } : event
    );
    assert.equal(verifyAuditChain(tampered), false);
  });

  it("keeps previews non-executable and enforces maker-checker separation", () => {
    const audit = buildAuditChain(demoRepository.auditSource());
    const approval = demoRepository.approvals().find((item) => item.id === "APV-843918");
    assert.ok(approval);
    const preview = buildApprovalPreview(approval, "dev:compliance-lead", audit);
    assert.equal(preview.command.digest, approvalCommandDigest(approval));
    assert.equal(preview.policy.independentApprover, false);
    assert.equal(preview.policy.executable, false);
    assert.ok(preview.policy.blockers.includes("maker_cannot_approve"));
    assert.ok(preview.policy.blockers.includes("step_up_mfa_required"));
    assert.ok(preview.policy.blockers.includes("command_client_absent"));
  });

  it("blocks incomplete evidence and insufficient approvals", () => {
    const audit = buildAuditChain(demoRepository.auditSource());
    const approval = demoRepository.approvals().find((item) => item.id === "APV-843921");
    assert.ok(approval);
    const preview = buildApprovalPreview(approval, "dev:compliance-lead", audit);
    assert.ok(preview.policy.blockers.includes("evidence_incomplete"));
    assert.ok(preview.policy.blockers.includes("approvals_incomplete"));
    assert.equal(preview.evidence.ready < preview.evidence.total, true);
    assert.equal(preview.policy.executable, false);
  });
});
