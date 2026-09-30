BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (7, '0007_ledger_replica_reference_guard');

CREATE OR REPLACE FUNCTION financial_core.validate_account()
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account definition %/% does not exist',
      NEW.chart_version,
      NEW.definition_code
      USING ERRCODE = '23503';
  END IF;

  PERFORM 1
    FROM financial_core.ledger_assets
   WHERE asset_code = NEW.asset_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asset % does not exist', NEW.asset_code
      USING ERRCODE = '23503';
  END IF;

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
    RAISE EXCEPTION 'journal % does not exist', target_journal_id
      USING ERRCODE = '23503';
  END IF;

  SELECT
    rule.allowed_actor_types,
    rule.entry_pattern
    INTO allowed_actor_types, expected_entry_pattern
    FROM financial_core.posting_rule_registry AS rule
   WHERE rule.journal_type = target_journal.journal_type
     AND rule.posting_rule_version = target_journal.posting_rule_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal % references missing posting rule %/%',
      target_journal_id,
      target_journal.journal_type,
      target_journal.posting_rule_version
      USING ERRCODE = '23503';
  END IF;

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

  IF EXISTS (
    SELECT 1
      FROM financial_core.ledger_entries AS entry
      LEFT JOIN financial_core.ledger_accounts AS account
        ON account.account_id = entry.account_id
       AND account.legal_entity_id = entry.legal_entity_id
       AND account.asset_code = entry.asset_code
     WHERE entry.journal_id = target_journal_id
       AND (
         entry.legal_entity_id <> target_journal.legal_entity_id
         OR account.account_id IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'journal % entries violate reference integrity', target_journal_id
      USING ERRCODE = '23503';
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

CREATE FUNCTION financial_core.validate_delivery_attempt_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM financial_core.ledger_outbox_events
     WHERE outbox_id = NEW.outbox_id
  ) THEN
    RAISE EXCEPTION 'outbox event % does not exist', NEW.outbox_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_delivery_attempts_validate_outbox
BEFORE INSERT ON financial_core.ledger_outbox_delivery_attempts
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_delivery_attempt_reference();

ALTER TABLE financial_core.ledger_outbox_delivery_attempts
  ENABLE ALWAYS TRIGGER ledger_delivery_attempts_validate_outbox;

REVOKE ALL ON FUNCTION financial_core.validate_delivery_attempt_reference() FROM PUBLIC;

COMMIT;
