import type { AuditSourceEvent, SupportTicket, SupportTicketStatus } from "../data/demo.js";

// Customer-support desk, read-only over synthetic tickets. Operators can
// inspect conversation history and linked entities; replying, assigning or
// closing tickets stays outside this console and no route accepts commands.
export const supportTicketStatuses: readonly SupportTicketStatus[] = Object.freeze([
  "open",
  "pending-customer",
  "escalated",
  "resolved"
]);

export function isSupportTicketStatus(value: string): value is SupportTicketStatus {
  return (supportTicketStatuses as readonly string[]).includes(value);
}

export function supportAccessEvent(eventId: string, actor: string, ticket: SupportTicket): AuditSourceEvent {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    actor,
    action: "support.viewed",
    resource: `support:${ticket.id}`,
    outcome: "recorded",
    evidenceDigest: ticket.auditEvidenceDigest
  };
}
