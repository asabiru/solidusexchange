BEGIN;

CREATE SCHEMA financial_core;

CREATE TABLE financial_core.schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  migration_name TEXT NOT NULL UNIQUE CHECK (migration_name ~ '^[0-9]{4}_[a-z0-9_]+$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (1, '0001_ledger_foundation');

CREATE TABLE financial_core.ledger_assets (
  asset_code TEXT PRIMARY KEY CHECK (asset_code ~ '^[A-Z0-9]{2,12}$'),
  decimal_places SMALLINT NOT NULL CHECK (decimal_places BETWEEN 0 AND 18),
  enabled_for_posting BOOLEAN NOT NULL DEFAULT FALSE,
  evidence_reference TEXT NOT NULL CHECK (
    evidence_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE financial_core.account_definitions (
  chart_version INTEGER NOT NULL CHECK (chart_version > 0),
  definition_code TEXT NOT NULL CHECK (definition_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  category TEXT NOT NULL CHECK (
    category IN ('customer', 'custody', 'fee', 'provider', 'suspense', 'treasury')
  ),
  account_class TEXT NOT NULL CHECK (
    account_class IN ('ASSET', 'EQUITY', 'EXPENSE', 'LIABILITY', 'REVENUE')
  ),
  normal_side TEXT NOT NULL CHECK (normal_side IN ('CREDIT', 'DEBIT')),
  owner_scope TEXT NOT NULL CHECK (owner_scope IN ('forbidden', 'optional', 'required')),
  purpose TEXT NOT NULL CHECK (char_length(purpose) >= 24),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chart_version, definition_code),
  CHECK (
    (account_class IN ('ASSET', 'EXPENSE') AND normal_side = 'DEBIT')
    OR
    (account_class IN ('EQUITY', 'LIABILITY', 'REVENUE') AND normal_side = 'CREDIT')
  )
);

CREATE TABLE financial_core.ledger_accounts (
  account_id UUID PRIMARY KEY,
  chart_version INTEGER NOT NULL,
  definition_code TEXT NOT NULL,
  legal_entity_id TEXT NOT NULL CHECK (
    legal_entity_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'
  ),
  asset_code TEXT NOT NULL REFERENCES financial_core.ledger_assets (asset_code),
  owner_reference TEXT CHECK (
    owner_reference IS NULL
    OR owner_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'
  ),
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (chart_version, definition_code)
    REFERENCES financial_core.account_definitions (chart_version, definition_code),
  UNIQUE (account_id, legal_entity_id, asset_code)
);

CREATE UNIQUE INDEX ledger_accounts_identity
  ON financial_core.ledger_accounts (
    legal_entity_id,
    asset_code,
    chart_version,
    definition_code,
    COALESCE(owner_reference, '')
  );

CREATE TABLE financial_core.ledger_journals (
  journal_id UUID PRIMARY KEY,
  journal_type TEXT NOT NULL CHECK (journal_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  legal_entity_id TEXT NOT NULL CHECK (
    legal_entity_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'
  ),
  idempotency_key TEXT NOT NULL CHECK (
    idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{15,127}$'
  ),
  command_digest TEXT NOT NULL CHECK (command_digest ~ '^[0-9a-f]{64}$'),
  correlation_id UUID NOT NULL,
  causation_id UUID,
  effective_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('MIGRATION_JOB', 'OPERATOR', 'SERVICE')),
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'),
  authorization_reference TEXT NOT NULL CHECK (
    authorization_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'
  ),
  policy_version TEXT NOT NULL CHECK (
    policy_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$'
  ),
  posting_rule_version TEXT NOT NULL CHECK (
    posting_rule_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$'
  ),
  source_type TEXT NOT NULL CHECK (source_type ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'),
  source_reference TEXT NOT NULL CHECK (
    source_reference ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$'
  ),
  evidence_digest TEXT NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (legal_entity_id, idempotency_key),
  UNIQUE (journal_id, legal_entity_id)
);

CREATE TABLE financial_core.ledger_entries (
  entry_id UUID PRIMARY KEY,
  journal_id UUID NOT NULL,
  sequence_number SMALLINT NOT NULL CHECK (sequence_number > 0),
  account_id UUID NOT NULL,
  legal_entity_id TEXT NOT NULL,
  asset_code TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('CREDIT', 'DEBIT')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (journal_id, sequence_number),
  FOREIGN KEY (journal_id, legal_entity_id)
    REFERENCES financial_core.ledger_journals (journal_id, legal_entity_id),
  FOREIGN KEY (account_id, legal_entity_id, asset_code)
    REFERENCES financial_core.ledger_accounts (account_id, legal_entity_id, asset_code)
);

CREATE TABLE financial_core.ledger_idempotency_registry (
  legal_entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_digest TEXT NOT NULL CHECK (command_digest ~ '^[0-9a-f]{64}$'),
  journal_id UUID NOT NULL UNIQUE REFERENCES financial_core.ledger_journals (journal_id),
  first_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (legal_entity_id, idempotency_key),
  FOREIGN KEY (legal_entity_id, idempotency_key)
    REFERENCES financial_core.ledger_journals (legal_entity_id, idempotency_key)
);

CREATE TABLE financial_core.ledger_outbox_events (
  outbox_id UUID PRIMARY KEY,
  journal_id UUID NOT NULL UNIQUE REFERENCES financial_core.ledger_journals (journal_id),
  event_type TEXT NOT NULL CHECK (event_type = 'internal.ledger.journal-accepted.v1'),
  payload JSONB NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY['journal_id', 'command_digest']
    AND payload - ARRAY['journal_id', 'command_digest'] = '{}'::JSONB
    AND payload ->> 'journal_id' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND payload ->> 'command_digest' ~ '^[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE financial_core.ledger_outbox_delivery_attempts (
  delivery_id UUID PRIMARY KEY,
  outbox_id UUID NOT NULL REFERENCES financial_core.ledger_outbox_events (outbox_id),
  attempted_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('FAILED', 'SUCCEEDED')),
  response_digest TEXT CHECK (
    response_digest IS NULL OR response_digest ~ '^[0-9a-f]{64}$'
  ),
  error_code TEXT CHECK (
    error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CHECK (
    (outcome = 'SUCCEEDED' AND response_digest IS NOT NULL AND error_code IS NULL)
    OR
    (outcome = 'FAILED' AND error_code IS NOT NULL)
  )
);

CREATE FUNCTION financial_core.reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'financial_core tables are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION financial_core.validate_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  expected_owner_scope TEXT;
BEGIN
  SELECT owner_scope
    INTO expected_owner_scope
    FROM financial_core.account_definitions
   WHERE chart_version = NEW.chart_version
     AND definition_code = NEW.definition_code;

  IF expected_owner_scope = 'required' AND NEW.owner_reference IS NULL THEN
    RAISE EXCEPTION 'owner reference is required for account definition %', NEW.definition_code
      USING ERRCODE = '23514';
  END IF;
  IF expected_owner_scope = 'forbidden' AND NEW.owner_reference IS NOT NULL THEN
    RAISE EXCEPTION 'owner reference is forbidden for account definition %', NEW.definition_code
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_accounts_validate
BEFORE INSERT ON financial_core.ledger_accounts
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_account();

CREATE FUNCTION financial_core.validate_entry_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  configured_scale SMALLINT;
  significant_digits INTEGER;
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
  IF scale(NEW.amount) > configured_scale THEN
    RAISE EXCEPTION 'amount scale exceeds asset % scale', NEW.asset_code
      USING ERRCODE = '23514';
  END IF;

  significant_digits := char_length(
    replace(replace(trim_scale(NEW.amount)::TEXT, '.', ''), '-', '')
  );
  IF significant_digits > 78 THEN
    RAISE EXCEPTION 'amount exceeds ledger precision limit'
      USING ERRCODE = '22003';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_validate_amount
BEFORE INSERT ON financial_core.ledger_entries
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_entry_amount();

CREATE FUNCTION financial_core.assert_journal_complete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  target_journal_id UUID;
  target_journal financial_core.ledger_journals%ROWTYPE;
  entry_count INTEGER;
BEGIN
  target_journal_id := NEW.journal_id;

  SELECT *
    INTO target_journal
    FROM financial_core.ledger_journals
   WHERE journal_id = target_journal_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_journals_complete
AFTER INSERT ON financial_core.ledger_journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION financial_core.assert_journal_complete();

CREATE CONSTRAINT TRIGGER ledger_entries_complete
AFTER INSERT ON financial_core.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION financial_core.assert_journal_complete();

CREATE CONSTRAINT TRIGGER ledger_idempotency_complete
AFTER INSERT ON financial_core.ledger_idempotency_registry
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION financial_core.assert_journal_complete();

CREATE CONSTRAINT TRIGGER ledger_outbox_complete
AFTER INSERT ON financial_core.ledger_outbox_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION financial_core.assert_journal_complete();

CREATE TRIGGER schema_migrations_append_only
BEFORE UPDATE OR DELETE ON financial_core.schema_migrations
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_assets_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_assets
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER account_definitions_append_only
BEFORE UPDATE OR DELETE ON financial_core.account_definitions
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_accounts_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_accounts
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_journals_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_journals
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_entries_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_entries
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_idempotency_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_idempotency_registry
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_outbox_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_outbox_events
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

CREATE TRIGGER ledger_delivery_attempts_append_only
BEFORE UPDATE OR DELETE ON financial_core.ledger_outbox_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION financial_core.reject_mutation();

REVOKE ALL ON SCHEMA financial_core FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA financial_core FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA financial_core FROM PUBLIC;

COMMIT;
