BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (4, '0004_ledger_truncate_guard');

CREATE TRIGGER schema_migrations_reject_truncate
BEFORE TRUNCATE ON financial_core.schema_migrations
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_assets_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_assets
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER account_definitions_reject_truncate
BEFORE TRUNCATE ON financial_core.account_definitions
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_accounts_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_accounts
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_journals_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_journals
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_entries_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_entries
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_idempotency_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_idempotency_registry
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_outbox_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_outbox_events
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_delivery_attempts_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_outbox_delivery_attempts
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER posting_rule_registry_reject_truncate
BEFORE TRUNCATE ON financial_core.posting_rule_registry
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_journal_seals_reject_truncate
BEFORE TRUNCATE ON financial_core.ledger_journal_seals
FOR EACH STATEMENT EXECUTE FUNCTION financial_core.reject_mutation();

COMMIT;
