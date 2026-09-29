import { createHash } from "node:crypto";
import type {
  ApprovalPreview,
  ApprovalRow,
  AuditEvent,
  AuditSourceEvent,
  Tone
} from "../data/demo.js";

export const auditGenesisHash = "0".repeat(64);

export function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function auditTone(outcome: AuditSourceEvent["outcome"]): Tone {
  if (outcome === "denied") return "danger";
  if (outcome === "reviewed") return "info";
  return "success";
}

export function buildAuditChain(source: readonly AuditSourceEvent[]): readonly AuditEvent[] {
  let previousHash = auditGenesisHash;
  const events = source.map((event, index) => {
    const chained = buildAuditEvent(index + 1, previousHash, event);
    previousHash = chained.hash;
    return chained;
  });
  return Object.freeze(events);
}

export function buildAuditEvent(
  sequence: number,
  previousHash: string,
  event: AuditSourceEvent
): AuditEvent {
  const occurredAt = new Date(event.occurredAt);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || Number.isNaN(occurredAt.valueOf())) {
    throw new Error("Audit event is not canonicalizable");
  }
  const canonical = { ...event, occurredAt: occurredAt.toISOString() };
  const hash = sha256({ sequence, previousHash, ...canonical });
  return Object.freeze({
    sequence,
    previousHash,
    ...canonical,
    hash,
    tone: auditTone(event.outcome)
  });
}

export function verifyAuditChain(events: readonly AuditEvent[]): boolean {
  let previousHash = auditGenesisHash;
  for (const [index, event] of events.entries()) {
    const { hash, tone: _tone, ...payload } = event;
    if (
      event.sequence !== index + 1
      || event.previousHash !== previousHash
      || sha256(payload) !== hash
    ) return false;
    previousHash = hash;
  }
  return true;
}

export function approvalCommandDigest(approval: ApprovalRow): string {
  return sha256({
    approvalId: approval.id,
    action: approval.action,
    resource: approval.resource,
    exposure: approval.exposure
  });
}

export function buildApprovalPreview(
  approval: ApprovalRow,
  reviewerSubject: string,
  audit: readonly AuditEvent[],
  stepUpVerified = false
): ApprovalPreview {
  const independentApprover = reviewerSubject !== approval.makerSubject;
  const readyEvidence = approval.evidenceItems.filter((item) => item.status === "ready").length;
  const evidenceDigest = sha256(approval.evidenceItems);
  const blockers = [
    ...(independentApprover ? [] : ["maker_cannot_approve"]),
    ...(readyEvidence === approval.evidenceItems.length ? [] : ["evidence_incomplete"]),
    ...(approval.stepUpRequired && !stepUpVerified ? ["step_up_mfa_required"] : []),
    ...(approval.completedApprovals >= approval.requiredApprovals ? [] : ["approvals_incomplete"]),
    "command_client_absent"
  ];
  const anchor = audit.at(-1);
  if (!anchor) throw new Error("Audit chain is empty");

  return {
    approvalId: approval.id,
    generatedAt: new Date().toISOString(),
    command: {
      action: approval.action,
      resource: approval.resource,
      exposure: approval.exposure,
      digest: approvalCommandDigest(approval)
    },
    evidence: {
      ready: readyEvidence,
      total: approval.evidenceItems.length,
      digest: evidenceDigest,
      items: approval.evidenceItems
    },
    policy: {
      makerSubject: approval.makerSubject,
      reviewerSubject,
      independentApprover,
      requiredApprovals: approval.requiredApprovals,
      completedApprovals: approval.completedApprovals,
      stepUpMfa: approval.stepUpRequired
        ? (stepUpVerified ? "verified" : "required")
        : "not-required",
      commandClient: "absent",
      executable: false,
      blockers
    },
    auditAnchor: {
      sequence: anchor.sequence,
      hash: anchor.hash
    }
  };
}
