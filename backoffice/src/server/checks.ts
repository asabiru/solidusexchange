import type { AuditSourceEvent, ChatCheck, CheckStatus } from "../data/demo.js";

// Telegram chat checks, read-only over synthetic data. Operators can inspect
// check history; funds movement stays on the maker-checker path and no check
// route accepts commands.

export const checkStatuses: readonly CheckStatus[] = Object.freeze([
  "created",
  "waiting-recipient-kyc",
  "claimed",
  "cancelled",
  "expired"
]);

export function isCheckStatus(value: string): value is CheckStatus {
  return (checkStatuses as readonly string[]).includes(value);
}

export function checkAccessEvent(eventId: string, actor: string, check: ChatCheck): AuditSourceEvent {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    actor,
    action: "check.viewed",
    resource: `check:${check.id}`,
    outcome: "recorded",
    evidenceDigest: check.auditEvidenceDigest
  };
}
