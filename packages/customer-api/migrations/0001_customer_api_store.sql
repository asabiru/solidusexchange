BEGIN;

CREATE SCHEMA customer_api;

CREATE TABLE customer_api.schema_migrations (
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

CREATE FUNCTION customer_api.reject_migration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'customer_api migration history is append-only';
END;
$$;

CREATE FUNCTION customer_api.validate_migration_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = customer_api, pg_catalog
AS $$
DECLARE
  latest_version integer;
  latest_applied_at timestamptz;
  expected_version integer;
  migration_name_version integer;
BEGIN
  SELECT migration.version, migration.applied_at
    INTO latest_version, latest_applied_at
    FROM customer_api.schema_migrations AS migration
   ORDER BY migration.version DESC
   LIMIT 1;

  expected_version := COALESCE(latest_version, 0) + 1;

  IF NEW.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION
      'customer_api migration version % must follow installed version % with version %',
      NEW.version,
      COALESCE(latest_version, 0),
      expected_version
      USING ERRCODE = '23514';
  END IF;

  migration_name_version := substring(NEW.migration_name FROM '^([0-9]{4})_')::integer;
  IF migration_name_version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'customer_api migration name % must encode version %',
      NEW.migration_name,
      NEW.version
      USING ERRCODE = '23514';
  END IF;

  IF latest_applied_at IS NOT NULL AND NEW.applied_at <= latest_applied_at THEN
    RAISE EXCEPTION 'customer_api migration applied_at must be later than installed version %',
      latest_version
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_migrations_validate_sequence
BEFORE INSERT ON customer_api.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION customer_api.validate_migration_sequence();

ALTER TABLE customer_api.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence;

CREATE TRIGGER schema_migrations_append_only
BEFORE UPDATE OR DELETE ON customer_api.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION customer_api.reject_migration_history_mutation();

ALTER TABLE customer_api.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_append_only;

CREATE TRIGGER schema_migrations_reject_truncate
BEFORE TRUNCATE ON customer_api.schema_migrations
FOR EACH STATEMENT
EXECUTE FUNCTION customer_api.reject_migration_history_mutation();

ALTER TABLE customer_api.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate;

CREATE TABLE customer_api.rate_limit_buckets (
  namespace text NOT NULL,
  bucket_key text NOT NULL,
  request_count bigint NOT NULL,
  reset_at_ms bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (namespace, bucket_key),
  CONSTRAINT rate_limit_buckets_namespace_identifier CHECK (
    namespace ~ '^[a-z0-9_-]{1,64}$'
  ),
  CONSTRAINT rate_limit_buckets_request_count_positive CHECK (request_count > 0),
  CONSTRAINT rate_limit_buckets_reset_at_ms_positive CHECK (reset_at_ms > 0),
  CONSTRAINT rate_limit_buckets_updated_at_finite CHECK (pg_catalog.isfinite(updated_at))
);

INSERT INTO customer_api.schema_migrations (version, migration_name)
VALUES (1, '0001_customer_api_store');

REVOKE ALL ON SCHEMA customer_api FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_api FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_api FROM PUBLIC;

COMMIT;
