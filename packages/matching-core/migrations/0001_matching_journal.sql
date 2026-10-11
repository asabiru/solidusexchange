BEGIN;

CREATE SCHEMA matching_core;

CREATE TABLE matching_core.schema_migrations (
  version integer PRIMARY KEY,
  migration_name text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT schema_migrations_version_positive CHECK (version > 0),
  CONSTRAINT schema_migrations_name_canonical CHECK (
    migration_name ~ '^[0-9]{4}_[a-z0-9_]+$'
  ),
  CONSTRAINT schema_migrations_applied_at_finite CHECK (
    pg_catalog.isfinite(applied_at)
  )
);

CREATE FUNCTION matching_core.reject_migration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'matching_core migration history is append-only';
END;
$$;

CREATE FUNCTION matching_core.validate_migration_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = matching_core, pg_catalog
AS $$
DECLARE
  latest_version integer;
  latest_applied_at timestamptz;
  expected_version integer;
  migration_name_version integer;
BEGIN
  SELECT migration.version, migration.applied_at
    INTO latest_version, latest_applied_at
    FROM matching_core.schema_migrations AS migration
   ORDER BY migration.version DESC
   LIMIT 1;

  expected_version := COALESCE(latest_version, 0) + 1;

  IF NEW.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION
      'matching_core migration version % must follow installed version % with version %',
      NEW.version,
      COALESCE(latest_version, 0),
      expected_version
      USING ERRCODE = '23514';
  END IF;

  migration_name_version := substring(NEW.migration_name FROM '^([0-9]{4})_')::integer;
  IF migration_name_version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'matching_core migration name % must encode version %',
      NEW.migration_name,
      NEW.version
      USING ERRCODE = '23514';
  END IF;

  IF latest_applied_at IS NOT NULL AND NEW.applied_at <= latest_applied_at THEN
    RAISE EXCEPTION 'matching_core migration applied_at must be later than installed version %',
      latest_version
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_migrations_validate_sequence
BEFORE INSERT ON matching_core.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION matching_core.validate_migration_sequence();

ALTER TABLE matching_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence;

CREATE TRIGGER schema_migrations_append_only
BEFORE UPDATE OR DELETE ON matching_core.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION matching_core.reject_migration_history_mutation();

ALTER TABLE matching_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_append_only;

CREATE TRIGGER schema_migrations_reject_truncate
BEFORE TRUNCATE ON matching_core.schema_migrations
FOR EACH STATEMENT
EXECUTE FUNCTION matching_core.reject_migration_history_mutation();

ALTER TABLE matching_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate;

CREATE TABLE matching_core.matching_journal (
  namespace text NOT NULL,
  seq bigint NOT NULL,
  at timestamptz NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (namespace, seq),
  CONSTRAINT matching_journal_namespace_identifier CHECK (
    namespace ~ '^[a-z0-9_-]{1,64}$'
  ),
  CONSTRAINT matching_journal_seq_positive CHECK (seq > 0),
  CONSTRAINT matching_journal_at_finite CHECK (pg_catalog.isfinite(at)),
  CONSTRAINT matching_journal_type_event CHECK (
    type = 'accepted'
    OR type = 'resting'
    OR type = 'partially_filled'
    OR type = 'filled'
    OR type = 'cancelled'
    OR type = 'amended'
    OR type = 'rejected'
  ),
  CONSTRAINT matching_journal_recorded_at_finite CHECK (pg_catalog.isfinite(recorded_at)),
  CONSTRAINT matching_journal_payload_document CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT matching_journal_payload_seq_agreement CHECK (
    (payload ->> 'seq')::bigint = seq
  ),
  CONSTRAINT matching_journal_payload_at_agreement CHECK (
    (payload ->> 'at')::timestamptz = at
  ),
  CONSTRAINT matching_journal_payload_type_agreement CHECK (
    payload ->> 'type' = type
  )
);

CREATE FUNCTION matching_core.reject_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'matching journal is append-only';
END;
$$;

CREATE FUNCTION matching_core.validate_journal_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = matching_core, pg_catalog
AS $$
DECLARE
  latest_seq bigint;
BEGIN
  SELECT COALESCE(MAX(journal.seq), 0)
    INTO latest_seq
    FROM matching_core.matching_journal AS journal
   WHERE journal.namespace = NEW.namespace;

  IF NEW.seq IS DISTINCT FROM latest_seq + 1 THEN
    RAISE EXCEPTION 'matching journal seq % must continue from installed seq %',
      NEW.seq,
      latest_seq
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER matching_journal_validate_sequence
BEFORE INSERT ON matching_core.matching_journal
FOR EACH ROW
EXECUTE FUNCTION matching_core.validate_journal_sequence();

ALTER TABLE matching_core.matching_journal
  ENABLE ALWAYS TRIGGER matching_journal_validate_sequence;

CREATE TRIGGER matching_journal_append_only
BEFORE UPDATE OR DELETE ON matching_core.matching_journal
FOR EACH ROW
EXECUTE FUNCTION matching_core.reject_journal_mutation();

ALTER TABLE matching_core.matching_journal
  ENABLE ALWAYS TRIGGER matching_journal_append_only;

CREATE TRIGGER matching_journal_reject_truncate
BEFORE TRUNCATE ON matching_core.matching_journal
FOR EACH STATEMENT
EXECUTE FUNCTION matching_core.reject_journal_mutation();

ALTER TABLE matching_core.matching_journal
  ENABLE ALWAYS TRIGGER matching_journal_reject_truncate;

CREATE FUNCTION matching_core.append_matching_journal(p_namespace text, p_events jsonb)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  base_seq bigint;
BEGIN
  IF p_namespace IS NULL OR p_namespace !~ '^[a-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'matching journal namespace must match ^[a-z0-9_-]{1,64}$'
      USING ERRCODE = '23514';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'matching journal append requires a JSON array of events'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_namespace));

  SELECT COALESCE(MAX(journal.seq), 0)
    INTO base_seq
    FROM matching_core.matching_journal AS journal
   WHERE journal.namespace = p_namespace;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_events) WITH ORDINALITY AS entry(value, ordinality)
     WHERE (entry.value ->> 'seq')::bigint IS DISTINCT FROM base_seq + entry.ordinality
  ) THEN
    RAISE EXCEPTION 'matching journal append must continue seq %',
      base_seq + 1
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO matching_core.matching_journal (namespace, seq, at, type, payload)
  SELECT p_namespace,
         (entry.value ->> 'seq')::bigint,
         (entry.value ->> 'at')::timestamptz,
         entry.value ->> 'type',
         entry.value
    FROM jsonb_array_elements(p_events) AS entry(value);

  RETURN base_seq + jsonb_array_length(p_events);
END;
$$;

INSERT INTO matching_core.schema_migrations (version, migration_name)
VALUES (1, '0001_matching_journal');

REVOKE ALL ON SCHEMA matching_core FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA matching_core FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA matching_core FROM PUBLIC;

COMMIT;
