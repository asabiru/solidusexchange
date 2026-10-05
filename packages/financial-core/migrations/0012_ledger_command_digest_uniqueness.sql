BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (12, '0012_ledger_command_digest_uniqueness');

ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_command_digest_unique
  UNIQUE (command_digest);

ALTER TABLE financial_core.ledger_idempotency_registry
  ADD CONSTRAINT ledger_idempotency_command_digest_unique
  UNIQUE (command_digest);

ALTER TABLE financial_core.ledger_journal_seals
  ADD CONSTRAINT ledger_journal_seals_command_digest_unique
  UNIQUE (command_digest);

CREATE UNIQUE INDEX ledger_outbox_events_command_digest_unique
  ON financial_core.ledger_outbox_events ((payload ->> 'command_digest'));

COMMIT;
