BEGIN;

CREATE TABLE custody_core.schema_migrations (
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

CREATE FUNCTION custody_core.reject_migration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'custody migration history is append-only';
END;
$$;

CREATE FUNCTION custody_core.validate_migration_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = custody_core, pg_catalog
AS $$
DECLARE
  latest_version integer;
  latest_applied_at timestamptz;
  expected_version integer;
  migration_name_version integer;
BEGIN
  SELECT migration.version, migration.applied_at
    INTO latest_version, latest_applied_at
    FROM custody_core.schema_migrations AS migration
   ORDER BY migration.version DESC
   LIMIT 1;

  expected_version := COALESCE(latest_version, 0) + 1;

  IF NEW.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION
      'custody migration version % must follow installed version % with version %',
      NEW.version,
      COALESCE(latest_version, 0),
      expected_version
      USING ERRCODE = '23514';
  END IF;

  migration_name_version := substring(NEW.migration_name FROM '^([0-9]{4})_')::integer;
  IF migration_name_version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'custody migration name % must encode version %',
      NEW.migration_name,
      NEW.version
      USING ERRCODE = '23514';
  END IF;

  IF latest_applied_at IS NOT NULL AND NEW.applied_at <= latest_applied_at THEN
    RAISE EXCEPTION 'custody migration applied_at must be later than installed version %',
      latest_version
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_migrations_validate_sequence
BEFORE INSERT ON custody_core.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION custody_core.validate_migration_sequence();

ALTER TABLE custody_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence;

CREATE TRIGGER schema_migrations_append_only
BEFORE UPDATE OR DELETE ON custody_core.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION custody_core.reject_migration_history_mutation();

ALTER TABLE custody_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_append_only;

CREATE TRIGGER schema_migrations_reject_truncate
BEFORE TRUNCATE ON custody_core.schema_migrations
FOR EACH STATEMENT
EXECUTE FUNCTION custody_core.reject_migration_history_mutation();

ALTER TABLE custody_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate;

INSERT INTO custody_core.schema_migrations (version, migration_name)
VALUES (1, '0001_custody_projection_outbox');

INSERT INTO custody_core.schema_migrations (version, migration_name)
VALUES (2, '0002_custody_migration_history');

REVOKE ALL ON TABLE custody_core.schema_migrations FROM PUBLIC;
REVOKE ALL ON FUNCTION custody_core.reject_migration_history_mutation()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION custody_core.validate_migration_sequence()
  FROM PUBLIC;

COMMIT;
