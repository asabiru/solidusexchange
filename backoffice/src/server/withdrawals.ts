import type { AuditSourceEvent, WithdrawalIntent, WithdrawalIntentStatus } from "../data/demo.js";

// Custody withdrawal intents stay read-only here: operators inspect the
// synthetic lifecycle and evidence, but approval, broadcast and cancellation
// remain on the maker-checker path — this view accepts no commands.
export const withdrawalStatuses: readonly WithdrawalIntentStatus[] = Object.freeze([
  "draft",
  "screened",
  "pending_maker_approval",
  "pending_checker_approval",
  "unsigned_intent_ready",
  "broadcast",
  "confirmed",
  "rejected",
  "cancelled",
  "expired"
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
