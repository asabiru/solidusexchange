import type { AuditSourceEvent, LedgerJournal, LedgerJournalType } from "../data/demo.js";

// The ledger surface is strictly read-only: operators inspect the synthetic
// append-only journals and their projections — posting, reversal creation
// and holds stay inside packages/financial-core and its approval gate.
export const ledgerJournalTypes: readonly LedgerJournalType[] = Object.freeze([
  "SYNTHETIC_PROVIDER_POSITION",
  "SYNTHETIC_PROVIDER_POSITION_REVERSAL",
  "SYNTHETIC_CUSTOMER_CREDIT",
  "SYNTHETIC_HOLD_CREATE",
  "SYNTHETIC_HOLD_RELEASE",
  "SYNTHETIC_FEE_CHARGE",
  "SYNTHETIC_SPREAD_RECOGNITION",
  "SYNTHETIC_MIGRATION_OPENING",
  "SYNTHETIC_SUSPENSE_PARK_IN",
  "SYNTHETIC_SUSPENSE_PARK_OUT",
  "SYNTHETIC_SUSPENSE_CLEAR_IN",
  "SYNTHETIC_SUSPENSE_CLEAR_OUT"
]);

export function isLedgerJournalType(value: string): value is LedgerJournalType {
  return (ledgerJournalTypes as readonly string[]).includes(value);
}

export function ledgerAccessEvent(eventId: string, actor: string, journal: LedgerJournal): AuditSourceEvent {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    actor,
    action: "ledger.journal_viewed",
    resource: `ledger:${journal.id}`,
    outcome: "recorded",
    evidenceDigest: journal.auditEvidenceDigest
  };
}
