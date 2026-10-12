-- backoffice PostgreSQL migration 0002.
--
-- This revision is a single transaction: it either records the complete
-- package schema or rolls back and updates nothing. The command file that
-- applies it owns ordering; the file is also safe to apply idempotently
-- through the versioned history table.

BEGIN;

-- ---------------------------------------------------------------------------
-- Catalog machinery — the same append-only migration history the
-- customer-api package pins (sequential versions, name-encoded revisions,
-- monotonically increasing applied_at, history rows that can never mutate).
-- The backoffice catalog is backfilled with revision 0001, the audit schema
-- that pre-dates the catalog, so the sequence stays gap-free.
-- ---------------------------------------------------------------------------

CREATE TABLE backoffice_control.schema_migrations (
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

CREATE FUNCTION backoffice_control.reject_migration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'backoffice_control migration history is append-only';
END;
$$;

CREATE FUNCTION backoffice_control.validate_migration_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = backoffice_control, pg_catalog
AS $$
DECLARE
  latest_version integer;
  latest_applied_at timestamptz;
  expected_version integer;
  migration_name_version integer;
BEGIN
  SELECT migration.version, migration.applied_at
    INTO latest_version, latest_applied_at
    FROM backoffice_control.schema_migrations AS migration
   ORDER BY migration.version DESC
   LIMIT 1;

  expected_version := COALESCE(latest_version, 0) + 1;

  IF NEW.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION
      'backoffice_control migration version % must follow installed version % with version %',
      NEW.version,
      COALESCE(latest_version, 0),
      expected_version
      USING ERRCODE = '23514';
  END IF;

  migration_name_version := substring(NEW.migration_name FROM '^([0-9]{4})_')::integer;
  IF migration_name_version IS DISTINCT FROM NEW.version THEN
    RAISE EXCEPTION 'backoffice_control migration name % must encode version %',
      NEW.migration_name,
      NEW.version
      USING ERRCODE = '23514';
  END IF;

  IF latest_applied_at IS NOT NULL AND NEW.applied_at <= latest_applied_at THEN
    RAISE EXCEPTION 'backoffice_control migration applied_at must be later than installed version %',
      latest_version
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER schema_migrations_validate_sequence
BEFORE INSERT ON backoffice_control.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION backoffice_control.validate_migration_sequence();

ALTER TABLE backoffice_control.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence;

CREATE TRIGGER schema_migrations_append_only
BEFORE UPDATE OR DELETE ON backoffice_control.schema_migrations
FOR EACH ROW
EXECUTE FUNCTION backoffice_control.reject_migration_history_mutation();

ALTER TABLE backoffice_control.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_append_only;

CREATE TRIGGER schema_migrations_reject_truncate
BEFORE TRUNCATE ON backoffice_control.schema_migrations
FOR EACH STATEMENT
EXECUTE FUNCTION backoffice_control.reject_migration_history_mutation();

ALTER TABLE backoffice_control.schema_migrations
  ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate;

-- Revision 0001 predates the catalog; it is recorded now so the sequence
-- stays gap-free. clock_timestamp() advances per statement, so this row's
-- applied_at is strictly before the revision-2 row recorded below.
INSERT INTO backoffice_control.schema_migrations (version, migration_name)
VALUES (1, '0001_append_only_audit');

-- ---------------------------------------------------------------------------
-- Rev 0002 — dev operator-session store
--
-- The mutable operator-session lifecycle lives inside the dev-only
-- backoffice BFF: issue, token rotation, revocation, expiry sweep, device
-- displacement and device binding. Its durable shape is one append-forward
-- record per session — issued rows never mutate except through the
-- lifecycle the store itself serializes. Raw bearer tokens never reach the
-- store: only the namespaced sha256 digest a session currently answers to,
-- plus the digest of a bound device. The columns and CHECK constraints pin
-- the same invariants the in-memory model enforces (expiry after issue,
-- last-used from issue, revocation terminals, the sess_* id and digest
-- grammars, the bounded operator-subject and identity fields, the role
-- enum).
-- ---------------------------------------------------------------------------

CREATE TABLE backoffice_control.operator_sessions (
  session_id text PRIMARY KEY
    CHECK (session_id ~ '^sess_[0-9a-f]{24}$'),
  subject text NOT NULL
    CHECK (subject ~ '^[a-zA-Z0-9_.+:@|-]{1,128}$'),
  email text NOT NULL
    CHECK (char_length(email) <= 320),
  name text NOT NULL
    CHECK (char_length(name) <= 200),
  role text NOT NULL
    CHECK (role IN (
      'compliance-lead',
      'support-l1',
      'aml-investigator',
      'fraud-investigator',
      'auditor'
    )),
  token_digest text NOT NULL
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  device_digest text
    CHECK (device_digest IS NULL OR device_digest ~ '^[0-9a-f]{64}$'),
  issued_at_ms bigint NOT NULL
    CHECK (issued_at_ms > 0),
  expires_at_ms bigint NOT NULL,
  last_used_at_ms bigint NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  revoked_at_ms bigint,
  CONSTRAINT operator_sessions_expires_after_issued
    CHECK (expires_at_ms > issued_at_ms),
  CONSTRAINT operator_sessions_last_used_from_issue
    CHECK (last_used_at_ms >= issued_at_ms),
  CONSTRAINT operator_sessions_revoked_terminal
    CHECK ((revoked_at_ms IS NULL) = (revoked = false)),
  CONSTRAINT operator_sessions_revoked_at_from_issue
    CHECK (revoked_at_ms IS NULL OR revoked_at_ms >= issued_at_ms)
);

-- Only one live session may answer a bearer digest at a time; the digest
-- column is the token index, so uniqueness also holds across revoked and
-- expired history until rows are evicted.
CREATE UNIQUE INDEX operator_sessions_token_digest_uq
  ON backoffice_control.operator_sessions (token_digest);

CREATE INDEX operator_sessions_subject_idx
  ON backoffice_control.operator_sessions (subject, issued_at_ms DESC);

CREATE INDEX operator_sessions_device_idx
  ON backoffice_control.operator_sessions (device_digest)
  WHERE device_digest IS NOT NULL;

-- Issued sessions are append-forward: the lifecycle may rotate the bearer
-- digest, extend expiry, move last-used forward, bind a device once and mark
-- revocation — and nothing else may change. Identity columns (session_id,
-- subject, email, name, role, issued_at_ms) are immutable, a revoked record
-- is terminal, and neither expires_at_ms, last_used_at_ms nor device_digest
-- may regress.
CREATE FUNCTION backoffice_control.reject_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'operator_sessions history is append-forward; truncation is blocked';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.issued_at_ms IS DISTINCT FROM OLD.issued_at_ms THEN
    RAISE EXCEPTION 'operator_sessions session_id, subject, email, name, role and issued_at_ms are immutable';
  END IF;
  IF OLD.revoked_at_ms IS NOT NULL THEN
    RAISE EXCEPTION 'operator_sessions revocation is terminal';
  END IF;
  IF NEW.revoked_at_ms IS NULL AND OLD.revoked = true THEN
    RAISE EXCEPTION 'operator_sessions revocation is terminal';
  END IF;
  IF NEW.expires_at_ms < OLD.expires_at_ms THEN
    RAISE EXCEPTION 'operator_sessions expires_at_ms only moves forward';
  END IF;
  IF NEW.last_used_at_ms < OLD.last_used_at_ms THEN
    RAISE EXCEPTION 'operator_sessions last_used_at_ms only moves forward';
  END IF;
  IF NEW.device_digest IS DISTINCT FROM OLD.device_digest
     AND OLD.device_digest IS NOT NULL THEN
    RAISE EXCEPTION 'operator_sessions device binding is one-time';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER reject_session_mutation
  BEFORE UPDATE OR DELETE ON backoffice_control.operator_sessions
  FOR EACH ROW
  EXECUTE FUNCTION backoffice_control.reject_session_mutation();

CREATE TRIGGER reject_session_mutation_truncate
  BEFORE TRUNCATE ON backoffice_control.operator_sessions
  FOR EACH STATEMENT
  EXECUTE FUNCTION backoffice_control.reject_session_mutation();

-- The canonical history row: version, then the file name, exactly once.
INSERT INTO backoffice_control.schema_migrations (version, migration_name)
VALUES (2, '0002_operator_sessions');

-- The dev store is the only writer: sessions are never readable by grants.
REVOKE ALL ON TABLE backoffice_control.operator_sessions FROM PUBLIC;
REVOKE ALL ON TABLE backoffice_control.schema_migrations FROM PUBLIC;

COMMIT;
