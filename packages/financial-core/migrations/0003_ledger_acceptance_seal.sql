BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (3, '0003_ledger_acceptance_seal');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM financial_core.ledger_journals) THEN
    RAISE EXCEPTION
      'pre-seal journals require independent revalidation before migration 0003'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE financial_core.posting_rule_registry (
  registry_version INTEGER NOT NULL CHECK (registry_version > 0),
  journal_type TEXT NOT NULL CHECK (journal_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  posting_rule_version TEXT NOT NULL CHECK (
    posting_rule_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$'
  ),
  status TEXT NOT NULL CHECK (status = 'draft'),
  runtime_boundary TEXT NOT NULL CHECK (runtime_boundary = 'dev-dry-run'),
  production_execution_enabled BOOLEAN NOT NULL CHECK (
    production_execution_enabled = FALSE
  ),
  scope TEXT NOT NULL CHECK (scope = 'synthetic-test-only'),
  allowed_actor_types TEXT[] NOT NULL CHECK (
    cardinality(allowed_actor_types) > 0
    AND allowed_actor_types <@ ARRAY['MIGRATION_JOB', 'OPERATOR', 'SERVICE']::TEXT[]
  ),
  entry_pattern JSONB NOT NULL CHECK (
    jsonb_typeof(entry_pattern) = 'array'
    AND jsonb_array_length(entry_pattern) >= 2
  ),
  purpose TEXT NOT NULL CHECK (char_length(purpose) >= 24),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (journal_type, posting_rule_version)
);

INSERT INTO financial_core.posting_rule_registry (
  registry_version,
  journal_type,
  posting_rule_version,
  status,
  runtime_boundary,
  production_execution_enabled,
  scope,
  allowed_actor_types,
  entry_pattern,
  purpose,
  created_at
) VALUES (
  1,
  'SYNTHETIC_PROVIDER_POSITION',
  'synthetic-provider-position-v1',
  'draft',
  'dev-dry-run',
  FALSE,
  'synthetic-test-only',
  ARRAY['SERVICE'],
  '[
    {"definition_code": "TREASURY_ASSET", "side": "DEBIT"},
    {"definition_code": "PROVIDER_PAYABLE_LIABILITY", "side": "CREDIT"}
  ]'::JSONB,
  'Exercise balanced posting and projection controls with synthetic assets only.',
  '2026-09-25T10:00:00.000Z'
);

ALTER TABLE financial_core.ledger_journals
  ADD CONSTRAINT ledger_journals_posting_rule_fk
  FOREIGN KEY (journal_type, posting_rule_version)
  REFERENCES financial_core.posting_rule_registry (
    journal_type,
    posting_rule_version
  ),
  ADD CONSTRAINT ledger_journals_id_digest_unique
  UNIQUE (journal_id, command_digest);

CREATE TABLE financial_core.ledger_journal_seals (
  journal_id UUID PRIMARY KEY,
  command_digest TEXT NOT NULL CHECK (command_digest ~ '^[0-9a-f]{64}$'),
  entry_count SMALLINT NOT NULL CHECK (entry_count BETWEEN 1 AND 1000),
  sealed_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (journal_id, command_digest)
    REFERENCES financial_core.ledger_journals (journal_id, command_digest)
);

CREATE FUNCTION financial_core.reject_sealed_journal_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM financial_core.ledger_journal_seals
     WHERE journal_id = NEW.journal_id
  ) THEN
    RAISE EXCEPTION 'journal % is sealed', NEW.journal_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_reject_sealed_journal
BEFORE INSERT ON financial_core.ledger_entries
FOR EACH ROW
EXECUTE FUNCTION financial_core.reject_sealed_journal_entry();

CREATE OR REPLACE FUNCTION financial_core.validate_entry_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  configured_scale SMALLINT;
  total_digits INTEGER;
BEGIN
  SELECT decimal_places
    INTO configured_scale
    FROM financial_core.ledger_assets
   WHERE asset_code = NEW.asset_code
     AND enabled_for_posting = TRUE;

  IF configured_scale IS NULL THEN
    RAISE EXCEPTION 'asset % is not enabled for posting', NEW.asset_code
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'amount must be finite'
      USING ERRCODE = '22003';
  END IF;
  IF scale(NEW.amount) > configured_scale THEN
    RAISE EXCEPTION 'amount scale exceeds asset % scale', NEW.asset_code
      USING ERRCODE = '23514';
  END IF;

  total_digits := char_length(
    replace(replace(NEW.amount::TEXT, '.', ''), '-', '')
  );
  IF total_digits > 78 THEN
    RAISE EXCEPTION 'amount exceeds ledger precision limit'
      USING ERRCODE = '22003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION financial_core.assert_journal_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  target_journal_id UUID;
  target_journal financial_core.ledger_journals%ROWTYPE;
  target_seal financial_core.ledger_journal_seals%ROWTYPE;
  entry_count INTEGER;
  allowed_actor_types TEXT[];
  expected_entry_pattern JSONB;
BEGIN
  target_journal_id := NEW.journal_id;

  SELECT *
    INTO target_journal
    FROM financial_core.ledger_journals
   WHERE journal_id = target_journal_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    rule.allowed_actor_types,
    rule.entry_pattern
    INTO allowed_actor_types, expected_entry_pattern
    FROM financial_core.posting_rule_registry AS rule
   WHERE rule.journal_type = target_journal.journal_type
     AND rule.posting_rule_version = target_journal.posting_rule_version;

  IF target_journal.actor_type <> ALL(allowed_actor_types) THEN
    RAISE EXCEPTION 'journal % actor is not permitted by its posting rule', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(
    rule_entry.value
    ORDER BY
      rule_entry.value ->> 'definition_code' COLLATE "C",
      rule_entry.value ->> 'side' COLLATE "C"
  )
    INTO expected_entry_pattern
    FROM jsonb_array_elements(expected_entry_pattern) AS rule_entry(value);

  SELECT count(*)
    INTO entry_count
    FROM financial_core.ledger_entries
   WHERE journal_id = target_journal_id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'journal % requires at least two entries', target_journal_id
      USING ERRCODE = '23514';
  END IF;
  IF entry_count > 1000 THEN
    RAISE EXCEPTION 'journal % exceeds the 1000-entry limit', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM financial_core.ledger_entries
     WHERE journal_id = target_journal_id
     GROUP BY asset_code
    HAVING sum(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END) <> 0
  ) THEN
    RAISE EXCEPTION 'journal % is not balanced per asset', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT entry.asset_code
      FROM financial_core.ledger_entries AS entry
      JOIN financial_core.ledger_accounts AS account
        ON account.account_id = entry.account_id
     WHERE entry.journal_id = target_journal_id
     GROUP BY entry.asset_code
    HAVING jsonb_agg(
      jsonb_build_object(
        'definition_code', account.definition_code,
        'side', entry.side
      )
      ORDER BY
        account.definition_code COLLATE "C",
        entry.side COLLATE "C"
    ) <> expected_entry_pattern
  ) THEN
    RAISE EXCEPTION 'journal % entries violate its posting rule', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM financial_core.ledger_idempotency_registry
     WHERE journal_id = target_journal_id
       AND legal_entity_id = target_journal.legal_entity_id
       AND idempotency_key = target_journal.idempotency_key
       AND command_digest = target_journal.command_digest
  ) THEN
    RAISE EXCEPTION 'journal % is missing its idempotency record', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM financial_core.ledger_outbox_events
     WHERE journal_id = target_journal_id
       AND payload ->> 'journal_id' = target_journal_id::TEXT
       AND payload ->> 'command_digest' = target_journal.command_digest
  ) THEN
    RAISE EXCEPTION 'journal % is missing its immutable outbox event', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  SELECT *
    INTO target_seal
    FROM financial_core.ledger_journal_seals
   WHERE journal_id = target_journal_id;

  IF NOT FOUND
    OR target_seal.command_digest <> target_journal.command_digest
    OR target_seal.entry_count <> entry_count
    OR target_seal.sealed_at <> target_journal.accepted_at
  THEN
    RAISE EXCEPTION 'journal % is missing its immutable acceptance seal', target_journal_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_journal_seals_complete
AFTER INSERT ON financial_core.ledger_journal_seals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION financial_core.assert_journal_complete();

CREATE TRIGGER posting_rule_registry_append_only
BEFORE UPDATE OR DELETE ON financial_core.posting_rule_registry
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_journal_seals_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_journal_seals
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

REVOKE ALL ON financial_core.posting_rule_registry FROM PUBLIC;
REVOKE ALL ON financial_core.ledger_journal_seals FROM PUBLIC;
REVOKE ALL ON FUNCTION financial_core.reject_sealed_journal_entry() FROM PUBLIC;

COMMIT;
