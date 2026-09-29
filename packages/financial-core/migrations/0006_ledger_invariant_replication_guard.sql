BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (6, '0006_ledger_invariant_replication_guard');

ALTER TABLE financial_core.ledger_accounts
  ENABLE ALWAYS TRIGGER ledger_accounts_validate;

ALTER TABLE financial_core.ledger_entries
  ENABLE ALWAYS TRIGGER ledger_entries_validate_amount;
ALTER TABLE financial_core.ledger_entries
  ENABLE ALWAYS TRIGGER ledger_entries_reject_sealed_journal;

ALTER TABLE financial_core.ledger_journals
  ENABLE ALWAYS TRIGGER ledger_journals_complete;
ALTER TABLE financial_core.ledger_entries
  ENABLE ALWAYS TRIGGER ledger_entries_complete;
ALTER TABLE financial_core.ledger_idempotency_registry
  ENABLE ALWAYS TRIGGER ledger_idempotency_complete;
ALTER TABLE financial_core.ledger_outbox_events
  ENABLE ALWAYS TRIGGER ledger_outbox_complete;
ALTER TABLE financial_core.ledger_journal_seals
  ENABLE ALWAYS TRIGGER ledger_journal_seals_complete;

COMMIT;
