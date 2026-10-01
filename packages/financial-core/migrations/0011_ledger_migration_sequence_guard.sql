BEGIN;

INSERT INTO financial_core.schema_migrations (version, migration_name)
VALUES (11, '0011_ledger_migration_sequence_guard');

CREATE FUNCTION financial_core.validate_migration_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = financial_core, pg_catalog
AS $$
DECLARE
  latest_version INTEGER;
  latest_applied_at TIMESTAMPTZ;
  migration_name_version INTEGER;
BEGIN
  SELECT migration.version, migration.applied_at
    INTO latest_version, latest_applied_at
    FROM financial_core.schema_migrations AS migration
   ORDER BY migration.version DESC
   LIMIT 1;

  IF NEW.version <> latest_version + 1 THEN
    RAISE EXCEPTION
      'migration version % must follow installed version % with version %',
      NEW.version,
      latest_version,
      latest_version + 1
      USING ERRCODE = '23514';
  END IF;

  migration_name_version := substring(NEW.migration_name FROM '^([0-9]{4})_')::INTEGER;
  IF migration_name_version <> NEW.version THEN
    RAISE EXCEPTION 'migration name % must encode version %',
      NEW.migration_name,
      NEW.version
      USING ERRCODE = '23514';
  END IF;

  IF NEW.applied_at <= latest_applied_at THEN
    RAISE EXCEPTION 'migration applied_at must be later than installed version %',
      latest_version
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_migrations_validate_sequence
BEFORE INSERT ON financial_core.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION financial_core.validate_migration_sequence();

ALTER TABLE financial_core.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence;

REVOKE ALL ON FUNCTION financial_core.validate_migration_sequence()
  FROM PUBLIC;

COMMIT;
