-- packages/customer-api PostgreSQL store migration 0002.
--
-- This revision is a single SERIALIZABLE transaction: it either records the
-- complete package schema or rolls back and updates nothing. The command
-- file that applies it owns ordering; the file is also safe to apply
-- idempotently through the versioned history table.

BEGIN;

-- ---------------------------------------------------------------------------
-- Rev 0002 — dev auth-session store
--
-- The mutable auth-session lifecycle lives inside the dev-only customer-api:
-- issue, token rotation, revocation, expiry sweep and device binding. Its
-- durable shape is one append-forward record per session — issued rows never
-- mutate except through the lifecycle the store itself serializes. Raw
-- bearer tokens never reach the store: only the namespaced sha256 digest a
-- session currently answers to, plus the digest of a bound device. The
-- columns and CHECK constraints pin the same invariants the in-memory model
-- enforces (expiry after issue, last-used from issue, revocation terminals,
-- the sess_* id and digest grammars, the synthetic subject refs).
-- ---------------------------------------------------------------------------

CREATE TABLE customer_api.auth_sessions (
  session_id text PRIMARY KEY
    CHECK (session_id ~ '^sess_[0-9a-f]{24}$'),
  subject text NOT NULL
    CHECK (subject ~ '^syn_(cust|oper)_[a-z0-9]{8,32}$'),
  token_digest text NOT NULL
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  device_digest text
    CHECK (device_digest IS NULL OR device_digest ~ '^[0-9a-f]{64}$'),
  issued_at_ms bigint NOT NULL
    CHECK (issued_at_ms > 0),
  expires_at_ms bigint NOT NULL
    CHECK (expires_at_ms > issued_at_ms),
  last_used_at_ms bigint NOT NULL
    CHECK (last_used_at_ms >= issued_at_ms),
  revoked boolean NOT NULL DEFAULT false,
  revoked_at_ms bigint
    CHECK ((revoked_at_ms IS NULL) = (revoked = false)),
  CHECK (revoked_at_ms IS NULL OR revoked_at_ms >= issued_at_ms)
);

-- Only one live session may answer a bearer digest at a time; the digest
-- column is the token index, so uniqueness also holds across revoked and
-- expired history until rows are evicted.
CREATE UNIQUE INDEX auth_sessions_token_digest_uq
  ON customer_api.auth_sessions (token_digest);

CREATE INDEX auth_sessions_subject_idx
  ON customer_api.auth_sessions (subject, issued_at_ms DESC);

-- Issued sessions are append-forward: the lifecycle may rotate the bearer
-- digest, extend expiry, move last-used forward, bind a device once and mark
-- revocation — and nothing else may change. Identity columns (session_id,
-- subject, issued_at_ms) are immutable, a revoked record is terminal, and
-- neither expires_at_ms, last_used_at_ms nor device_digest may regress.
CREATE OR REPLACE FUNCTION customer_api.reject_auth_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'auth_sessions history is append-forward; truncation is blocked';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.issued_at_ms IS DISTINCT FROM OLD.issued_at_ms THEN
    RAISE EXCEPTION 'auth_sessions session_id, subject and issued_at_ms are immutable';
  END IF;
  IF OLD.revoked_at_ms IS NOT NULL THEN
    RAISE EXCEPTION 'auth_sessions revocation is terminal';
  END IF;
  IF NEW.revoked_at_ms IS NULL AND OLD.revoked = true THEN
    RAISE EXCEPTION 'auth_sessions revocation is terminal';
  END IF;
  IF NEW.expires_at_ms < OLD.expires_at_ms THEN
    RAISE EXCEPTION 'auth_sessions expires_at_ms only moves forward';
  END IF;
  IF NEW.last_used_at_ms < OLD.last_used_at_ms THEN
    RAISE EXCEPTION 'auth_sessions last_used_at_ms only moves forward';
  END IF;
  IF NEW.device_digest IS DISTINCT FROM OLD.device_digest
     AND OLD.device_digest IS NOT NULL THEN
    RAISE EXCEPTION 'auth_sessions device binding is one-time';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER reject_auth_session_mutation
  BEFORE UPDATE OR DELETE ON customer_api.auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION customer_api.reject_auth_session_mutation();

CREATE TRIGGER reject_auth_session_mutation_truncate
  BEFORE TRUNCATE ON customer_api.auth_sessions
  FOR EACH STATEMENT
  EXECUTE FUNCTION customer_api.reject_auth_session_mutation();

-- The canonical history row: version, then the file name, exactly once.
INSERT INTO customer_api.schema_migrations (version, migration_name)
VALUES (2, '0002_auth_sessions');

-- The dev store is the only writer: sessions are never readable by grants.
REVOKE ALL ON TABLE customer_api.auth_sessions FROM PUBLIC;

COMMIT;
