BEGIN;

CREATE SCHEMA miniapp_control;

CREATE TABLE miniapp_control.schema_migrations (
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

CREATE FUNCTION miniapp_control.reject_migration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'miniapp_control migration history is append-only';
END;
$$;

CREATE FUNCTION miniapp_control.validate_migration_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = miniapp_control, pg_catalog
AS $$
DECLARE
  latest_version integer;
  latest_applied_at timestamptz;
  expected_version integer;
  migration_name_version integer;
BEGIN
  SELECT migration.version, migration.applied_at
    INTO latest_version, latest_applied_at
    FROM miniapp_control.schema_migrations AS migration
   ORDER BY migration.version DESC
   LIMIT 1;

  expected_version := COALESCE(latest_version, 0) + 1;

  IF NEW.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION
      'miniapp_control migration version % must follow installed version % with version %',
      NEW.version,
      COALESCE(latest_version, 0),
      expected_version
      USING ERRCODE = '23514';
  END IF;

  migration_name_version := substring(NEW.migration_name FROM '^([0-9]{4})_')::integer;
  IF migration_name_version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'miniapp_control migration name % must encode version %',
      NEW.migration_name,
      NEW.version
      USING ERRCODE = '23514';
  END IF;

  IF latest_applied_at IS NOT NULL AND NEW.applied_at <= latest_applied_at THEN
    RAISE EXCEPTION 'miniapp_control migration % must be applied after %',
      NEW.migration_name,
      latest_applied_at
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_migrations_validate_sequence
  BEFORE INSERT ON miniapp_control.schema_migrations
  FOR EACH ROW
  EXECUTE FUNCTION miniapp_control.validate_migration_sequence();

ALTER TABLE miniapp_control.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence;

CREATE TRIGGER schema_migrations_append_only
  BEFORE UPDATE OR DELETE ON miniapp_control.schema_migrations
  FOR EACH ROW
  EXECUTE FUNCTION miniapp_control.reject_migration_history_mutation();

ALTER TABLE miniapp_control.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_append_only;

CREATE TRIGGER schema_migrations_reject_truncate
  BEFORE TRUNCATE ON miniapp_control.schema_migrations
  FOR EACH STATEMENT
  EXECUTE FUNCTION miniapp_control.reject_migration_history_mutation();

ALTER TABLE miniapp_control.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate;

CREATE SEQUENCE miniapp_control.customer_sessions_seq;

CREATE TABLE miniapp_control.customer_sessions (
  session_id text PRIMARY KEY,
  subject text NOT NULL,
  source text NOT NULL,
  kyc text NOT NULL,
  token_digest text NOT NULL,
  device_digest text,
  issued_at_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL,
  last_used_at_ms bigint NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at_ms bigint,
  -- Insertion/revocation ordering for the per-subject bounds: issue claims
  -- the next sequence value, revoke claims a fresh one too, so eviction
  -- order is the same call order the in-memory map kept.
  store_seq bigint NOT NULL DEFAULT nextval('miniapp_control.customer_sessions_seq'),
  CONSTRAINT customer_sessions_session_id_format CHECK (
    session_id ~ '^sess_[0-9a-f]{24}$'
  ),
  CONSTRAINT customer_sessions_subject_format CHECK (
    subject ~ '^(dev|tg)-[0-9a-f]{16}$'
  ),
  CONSTRAINT customer_sessions_source_known CHECK (
    source IN ('telegram', 'dev-synthetic')
  ),
  CONSTRAINT customer_sessions_kyc_known CHECK (
    kyc IN ('kyc-gated', 'verified')
  ),
  CONSTRAINT customer_sessions_token_digest_hex CHECK (
    token_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT customer_sessions_device_digest_hex CHECK (
    device_digest IS NULL OR device_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT customer_sessions_issued_positive CHECK (
    issued_at_ms > 0
  ),
  CONSTRAINT customer_sessions_expires_after_issued CHECK (
    expires_at_ms > issued_at_ms
  ),
  CONSTRAINT customer_sessions_last_used_from_issue CHECK (
    last_used_at_ms >= issued_at_ms
  ),
  CONSTRAINT customer_sessions_revoked_terminal CHECK (
    (revoked_at_ms IS NULL) = (revoked = false)
  ),
  CONSTRAINT customer_sessions_revoked_at_from_issue CHECK (
    revoked_at_ms IS NULL OR revoked_at_ms >= issued_at_ms
  ),
  CONSTRAINT customer_sessions_store_seq_positive CHECK (
    store_seq > 0
  )
);

CREATE UNIQUE INDEX customer_sessions_token_digest_uq
  ON miniapp_control.customer_sessions (token_digest);

CREATE INDEX customer_sessions_subject_idx
  ON miniapp_control.customer_sessions (subject, issued_at_ms DESC);

CREATE INDEX customer_sessions_device_idx
  ON miniapp_control.customer_sessions (device_digest)
  WHERE device_digest IS NOT NULL;

CREATE FUNCTION miniapp_control.reject_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = miniapp_control, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'miniapp_control.customer_sessions is append-only';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- The store's lazy expiry, subject-bounds eviction and logout drop
    -- delete rows by design; the trigger guards updates, not removals.
    RETURN OLD;
  END IF;

  IF NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.issued_at_ms IS DISTINCT FROM OLD.issued_at_ms THEN
    RAISE EXCEPTION 'customer session identity fields are immutable';
  END IF;

  IF OLD.revoked_at_ms IS NOT NULL THEN
    RAISE EXCEPTION 'customer session revocation is terminal';
  END IF;

  IF NEW.revoked_at_ms IS NULL AND OLD.revoked = true THEN
    RAISE EXCEPTION 'customer session revocation is terminal';
  END IF;

  IF NEW.expires_at_ms < OLD.expires_at_ms THEN
    RAISE EXCEPTION 'customer session expiry only moves forward';
  END IF;

  IF NEW.last_used_at_ms < OLD.last_used_at_ms THEN
    RAISE EXCEPTION 'customer session last used only moves forward';
  END IF;

  IF NEW.device_digest IS DISTINCT FROM OLD.device_digest
     AND OLD.device_digest IS NOT NULL THEN
    RAISE EXCEPTION 'customer session device binding is one-time';
  END IF;

  IF NEW.kyc IS DISTINCT FROM OLD.kyc
     AND NOT (OLD.kyc = 'kyc-gated' AND NEW.kyc = 'verified') THEN
    RAISE EXCEPTION 'customer session kyc only promotes gated to verified';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_sessions_append_forward
  BEFORE UPDATE OR DELETE ON miniapp_control.customer_sessions
  FOR EACH ROW
  EXECUTE FUNCTION miniapp_control.reject_session_mutation();

CREATE TRIGGER customer_sessions_reject_truncate
  BEFORE TRUNCATE ON miniapp_control.customer_sessions
  FOR EACH STATEMENT
  EXECUTE FUNCTION miniapp_control.reject_session_mutation();

ALTER TABLE miniapp_control.customer_sessions
  ENABLE ALWAYS TRIGGER customer_sessions_append_forward;
ALTER TABLE miniapp_control.customer_sessions
  ENABLE ALWAYS TRIGGER customer_sessions_reject_truncate;

INSERT INTO miniapp_control.schema_migrations (version, migration_name)
VALUES (1, '0001_customer_sessions');

REVOKE ALL ON miniapp_control.customer_sessions FROM PUBLIC;
REVOKE ALL ON miniapp_control.schema_migrations FROM PUBLIC;

COMMIT;
