BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (8, '0008_ledger_acceptance_artifact_guard');

CREATE FUNCTION financial_core.validate_acceptance_artifact_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  expected_accepted_at TIMESTAMPTZ;
  artifact_at TIMESTAMPTZ;
BEGIN
  SELECT accepted_at
    INTO expected_accepted_at
    FROM financial_core.ledger_journals
   WHERE journal_id = NEW.journal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal % does not exist', NEW.journal_id
      USING ERRCODE = '23503';
  END IF;

  artifact_at := CASE TG_TABLE_NAME
    WHEN 'ledger_idempotency_registry'
      THEN (to_jsonb(NEW) ->> 'first_seen_at')::TIMESTAMPTZ
    WHEN 'ledger_outbox_events'
      THEN (to_jsonb(NEW) ->> 'created_at')::TIMESTAMPTZ
    ELSE NULL
  END;

  IF artifact_at IS DISTINCT FROM expected_accepted_at THEN
    RAISE EXCEPTION
      '% acceptance timestamp does not match journal %',
      TG_TABLE_NAME,
      NEW.journal_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_idempotency_validate_acceptance_timestamp
BEFORE INSERT ON financial_core.ledger_idempotency_registry
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_acceptance_artifact_timestamp();

CREATE TRIGGER ledger_outbox_validate_acceptance_timestamp
BEFORE INSERT ON financial_core.ledger_outbox_events
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_acceptance_artifact_timestamp();

ALTER TABLE financial_core.ledger_idempotency_registry
  ENABLE ALWAYS TRIGGER ledger_idempotency_validate_acceptance_timestamp;
ALTER TABLE financial_core.ledger_outbox_events
  ENABLE ALWAYS TRIGGER ledger_outbox_validate_acceptance_timestamp;

REVOKE ALL ON FUNCTION financial_core.validate_acceptance_artifact_timestamp()
  FROM PUBLIC;

COMMIT;
