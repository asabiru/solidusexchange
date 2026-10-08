import type { AuditSourceEvent, WithdrawalIntent, WithdrawalIntentStatus } from "../data/demo.js";

// Custody withdrawal intents stay read-only here: operators inspect the
// synthetic lifecycle and evidence, but approval, broadcast and cancellation
// remain on the maker-checker path — this view accepts no commands.
export const withdrawalStatuses: readonly WithdrawalIntentStatus[] = Object.freeze([
  "draft",
  "pending-approval",
  "screened",
  "broadcast",
  "confirmed",
  "rejected",
  "cancelled"
]);

export function isWithdrawalStatus(value: string): value is WithdrawalIntentStatus {
  return (withdrawalStatuses as readonly string[]).includes(value);
}

export function withdrawalAccessEvent(eventId: string, actor: string, intent: WithdrawalIntent): AuditSourceEvent {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    actor,
    action: "withdrawal.viewed",
    resource: `withdrawal:${intent.id}`,
    outcome: "recorded",
    evidenceDigest: intent.auditEvidenceDigest
  };
}
