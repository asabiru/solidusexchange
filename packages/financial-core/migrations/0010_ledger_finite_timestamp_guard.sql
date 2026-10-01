BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (10, '0010_ledger_finite_timestamp_guard');

ALTER TABLE financial_core.schema_migrations
  ADD CONSTRAINT schema_migrations_applied_at_finite
  CHECK (pg_catalog.isfinite(applied_at));

ALTER TABLE financial_core.ledger_assets
  ADD CONSTRAINT ledger_assets_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.account_definitions
  ADD CONSTRAINT account_definitions_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.ledger_accounts
  ADD CONSTRAINT ledger_accounts_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_effective_at_finite
  CHECK (pg_catalog.isfinite(effective_at)),
  ADD CONSTRAINT ledger_journals_accepted_at_finite
  CHECK (pg_catalog.isfinite(accepted_at)),
  ADD CONSTRAINT ledger_journals_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.ledger_entries
  ADD CONSTRAINT ledger_entries_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.ledger_idempotency_registry
  ADD CONSTRAINT ledger_idempotency_first_seen_at_finite
  CHECK (pg_catalog.isfinite(first_seen_at));

ALTER TABLE financial_core.ledger_outbox_events
  ADD CONSTRAINT ledger_outbox_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ADD CONSTRAINT ledger_delivery_attempts_attempted_at_finite
  CHECK (pg_catalog.isfinite(attempted_at));

ALTER TABLE financial_core.posting_rule_registry
  ADD CONSTRAINT posting_rule_registry_created_at_finite
  CHECK (pg_catalog.isfinite(created_at));

ALTER TABLE financial_core.ledger_journal_seals
  ADD CONSTRAINT ledger_journal_seals_sealed_at_finite
  CHECK (pg_catalog.isfinite(sealed_at));

COMMIT;
