BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (5, '0005_ledger_trigger_replication_guard');

ALTER TABLE financial_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_append_only;
ALTER TABLE financial_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate;

ALTER TABLE financial_core.ledger_assets
  ENABLE ALWAYS TRIGGER ledger_assets_append_only;
ALTER TABLE financial_core.ledger_assets
  ENABLE ALWAYS TRIGGER ledger_assets_reject_truncate;

ALTER TABLE financial_core.account_definitions
  ENABLE ALWAYS TRIGGER account_definitions_append_only;
ALTER TABLE financial_core.account_definitions
  ENABLE ALWAYS TRIGGER account_definitions_reject_truncate;

ALTER TABLE financial_core.ledger_accounts
  ENABLE ALWAYS TRIGGER ledger_accounts_append_only;
ALTER TABLE financial_core.ledger_accounts
  ENABLE ALWAYS TRIGGER ledger_accounts_reject_truncate;

ALTER TABLE financial_core.ledger_journals
  ENABLE ALWAYS TRIGGER ledger_journals_append_only;
ALTER TABLE financial_core.ledger_journals
  ENABLE ALWAYS TRIGGER ledger_journals_reject_truncate;

ALTER TABLE financial_core.ledger_entries
  ENABLE ALWAYS TRIGGER ledger_entries_append_only;
ALTER TABLE financial_core.ledger_entries
  ENABLE ALWAYS TRIGGER ledger_entries_reject_truncate;

ALTER TABLE financial_core.ledger_idempotency_registry
  ENABLE ALWAYS TRIGGER ledger_idempotency_append_only;
ALTER TABLE financial_core.ledger_idempotency_registry
  ENABLE ALWAYS TRIGGER ledger_idempotency_reject_truncate;

ALTER TABLE financial_core.ledger_outbox_events
  ENABLE ALWAYS TRIGGER ledger_outbox_append_only;
ALTER TABLE financial_core.ledger_outbox_events
  ENABLE ALWAYS TRIGGER ledger_outbox_reject_truncate;

ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ENABLE ALWAYS TRIGGER ledger_delivery_attempts_append_only;
ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ENABLE ALWAYS TRIGGER ledger_delivery_attempts_reject_truncate;

ALTER TABLE financial_core.posting_rule_registry
  ENABLE ALWAYS TRIGGER posting_rule_registry_append_only;
ALTER TABLE financial_core.posting_rule_registry
  ENABLE ALWAYS TRIGGER posting_rule_registry_reject_truncate;

ALTER TABLE financial_core.ledger_journal_seals
  ENABLE ALWAYS TRIGGER ledger_journal_seals_append_only;
ALTER TABLE financial_core.ledger_journal_seals
  ENABLE ALWAYS TRIGGER ledger_journal_seals_reject_truncate;

COMMIT;
