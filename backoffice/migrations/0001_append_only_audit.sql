BEGIN;

CREATE SCHEMA IF NOT EXISTS backoffice_control;

CREATE TABLE IF NOT EXISTS backoffice_control.audit_schema (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  installed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO backoffice_control.audit_schema (singleton, schema_version)
VALUES (true, 1)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS backoffice_control.audit_events (
  sequence bigint PRIMARY KEY CHECK (sequence > 0),
  event_id text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  actor text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('recorded', 'denied', 'reviewed')),
  evidence_digest text NOT NULL,
  previous_hash char(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  hash char(64) NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  retention_until timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retention_until > occurred_at)
);

CREATE OR REPLACE FUNCTION backoffice_control.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'backoffice audit events are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION backoffice_control.enforce_audit_append()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_sequence bigint;
  current_hash char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(7230, 44279);
  SELECT sequence, hash
    INTO current_sequence, current_hash
    FROM backoffice_control.audit_events
   ORDER BY sequence DESC
   LIMIT 1;

  IF current_sequence IS NULL THEN
    IF NEW.sequence <> 1 OR NEW.previous_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'invalid audit genesis event';
    END IF;
  ELSIF NEW.sequence <> current_sequence + 1 OR NEW.previous_hash <> current_hash THEN
    RAISE EXCEPTION 'stale or non-contiguous audit append';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_enforce_append
  ON backoffice_control.audit_events;
CREATE TRIGGER audit_events_enforce_append
BEFORE INSERT ON backoffice_control.audit_events
FOR EACH ROW EXECUTE FUNCTION backoffice_control.enforce_audit_append();

DROP TRIGGER IF EXISTS audit_events_reject_update_delete
  ON backoffice_control.audit_events;
CREATE TRIGGER audit_events_reject_update_delete
BEFORE UPDATE OR DELETE ON backoffice_control.audit_events
FOR EACH ROW EXECUTE FUNCTION backoffice_control.reject_audit_mutation();

DROP TRIGGER IF EXISTS audit_events_reject_truncate
  ON backoffice_control.audit_events;
CREATE TRIGGER audit_events_reject_truncate
BEFORE TRUNCATE ON backoffice_control.audit_events
FOR EACH STATEMENT EXECUTE FUNCTION backoffice_control.reject_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE
  ON backoffice_control.audit_events
  FROM PUBLIC;

COMMIT;
