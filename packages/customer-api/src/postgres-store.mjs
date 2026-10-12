import {
  assertAuthSessionBindDeviceCommand,
  assertAuthSessionGetByTokenCommand,
  assertAuthSessionGetCommand,
  assertAuthSessionIssueCommand,
  assertAuthSessionListCommand,
  assertAuthSessionRefreshCommand,
  assertAuthSessionRevokeCommand,
  assertAuthSessionSweepCommand
} from "./auth-session-store.mjs";
import {
  assertRateLimitConsumeCommand,
  StoreConfigError,
  StoreError,
  StoreUnavailableError
} from "./store.mjs";

// PostgreSQL backend for the customer-api store seam (`CUSTOMER_API_STORE=
// postgres`, DSN via `CUSTOMER_API_STORE_DSN`). Dev-only groundwork so the
// rate-limit control state can survive restarts; the schema it requires is
// `migrations/0001_customer_api_store.sql`, applied through the package's
// `verify:migrations`-governed source catalog. The store speaks only to the
// `customer_api` schema and only for its own tables.
//
// The `pg` driver loads lazily inside initialize(): consumers that import
// this module but never select the postgres backend never touch the driver,
// so the package stays importable without the dependency installed, while a
// postgres-mode startup without a working driver still fails fast.
//
// The fixed-window consume runs as one CTE statement so concurrent consumes
// stay atomic without a client-managed transaction:
//   - `prior` sees the key's bucket (live or expired) as of statement start;
//   - `occupancy` counts LIVE buckets, matching the memory backend's
//     prune-then-size bound;
//   - `row_total` counts every bucket row, matching the memory map's `size`;
//   - `expired` physically prunes dead buckets only for a NEW key when the
//     table already sits at the bound — the memory backend's lazy eviction
//     exactly (the key's own expired row is kept so the upsert below can
//     reset it, and pruning never runs for an existing key);
//   - `write` inserts a fresh bucket only when the key has no bucket and the
//     table is not full of live buckets, and otherwise resolves the row
//     through ON CONFLICT: an expired bucket restarts the window, a live one
//     increments. The upsert re-reads the row post-conflict, so two racing
//     consumes of one key serialize like the memory map's single thread.
// Clock semantics never come from the database: `now` is the caller's
// injected clock, exactly like the memory backend.

const schemaVersion = 2;

const CONSUME_SQL = `
WITH prior AS (
  SELECT bucket.request_count, bucket.reset_at_ms
    FROM customer_api.rate_limit_buckets AS bucket
   WHERE bucket.namespace = $5
     AND bucket.bucket_key = $1
),
occupancy AS (
  SELECT count(*) AS buckets
    FROM customer_api.rate_limit_buckets AS bucket
   WHERE bucket.namespace = $5
     AND bucket.reset_at_ms > $2
),
row_total AS (
  SELECT count(*) AS total
    FROM customer_api.rate_limit_buckets AS bucket
   WHERE bucket.namespace = $5
),
expired AS (
  DELETE FROM customer_api.rate_limit_buckets
   WHERE namespace = $5
     AND reset_at_ms <= $2
     AND bucket_key <> $1
     AND NOT EXISTS (SELECT 1 FROM prior)
     AND (SELECT total FROM row_total) >= $4
),
write AS (
  INSERT INTO customer_api.rate_limit_buckets (namespace, bucket_key, request_count, reset_at_ms)
  SELECT $5, $1, 1, $2 + $3
  WHERE EXISTS (SELECT 1 FROM prior)
     OR (SELECT buckets FROM occupancy) < $4
  ON CONFLICT (namespace, bucket_key) DO UPDATE
    SET request_count = CASE
          WHEN customer_api.rate_limit_buckets.reset_at_ms <= $2 THEN 1
          ELSE customer_api.rate_limit_buckets.request_count + 1
        END,
        reset_at_ms = CASE
          WHEN customer_api.rate_limit_buckets.reset_at_ms <= $2 THEN $2 + $3
          ELSE customer_api.rate_limit_buckets.reset_at_ms
        END,
        updated_at = transaction_timestamp()
  RETURNING request_count, reset_at_ms
)
SELECT
  (SELECT write_result.request_count FROM write AS write_result) AS request_count,
  (SELECT write_result.reset_at_ms FROM write AS write_result) AS reset_at_ms;
`;

const SCHEMA_VERSION_SQL = `
SELECT migration.version
  FROM customer_api.schema_migrations AS migration
 ORDER BY migration.version DESC
 LIMIT 1;
`;

// Parameters for the startup surface probe: one valid consume command run
// inside a transaction that is always rolled back, so the probe exercises
// the whole consume statement — table, columns and the ON CONFLICT arbiter —
// and leaves no trace.
const PROBE_PARAMETERS = ["__schema_probe__", 1, 1, 1, "__schema_probe__"];

// ---------------------------------------------------------------------------
// Auth-session store (`migrations/0002_auth_sessions.sql`).
//
// Every lifecycle op is one CTE statement inside a short explicit
// transaction; `tail` serializes the writes so the in-process ordering is
// identical to the memory backend's single thread, and a per-subject
// advisory transaction lock (issue and revoke only — the ops that enforce
// a per-subject bound) extends that serialization to every other store
// instance sharing the database.
// Each statement reproduces the memory model exactly:
//   - `issue`: a same-snapshot conflict check (session id or bearer digest
//     held by any stored record is a deterministic StoreError), the expired
//     sweep, then the subject overflow evict on live records only — dead
//     actives are already gone, so the OFFSET ordering never counts them;
//   - `get`: the lazy-evict DELETE plus a NOT EXISTS gate so an expired
//     unrevoked row reads as absent, exactly like the map's lazy expiry;
//   - `refresh`/`revoke`/`bindDevice`: FOR UPDATE on the target, the same
//     lazy evict, then the UPDATE guarded by the liveness predicates and —
//     for refresh — the digest-conflict check; the UPDATE applies GREATEST
//     so expiry, last-used and revoked_at only move forward;
//   - `revoke` additionally evicts the subject's revoked records beyond the
//     bound, ordered by newest revoked_at first, computed against the
//     pre-update snapshot (the revoked row itself never competes);
//   - `sweep` and `list` are the plain evict/read surfaces.
// Clock semantics never come from the database: `now` is the caller's
// injected clock, exactly like the memory backend.
// ---------------------------------------------------------------------------

const AUTH_ISSUE_SQL = `
WITH conflicts AS (
  SELECT session_id
    FROM customer_api.auth_sessions
   WHERE session_id = $1
      OR token_digest = $3
   LIMIT 1
),
evicted AS (
  DELETE FROM customer_api.auth_sessions AS target
  USING (
    SELECT session_id
      FROM customer_api.auth_sessions
     WHERE revoked_at_ms IS NULL
       AND expires_at_ms <= $7
    UNION ALL
    SELECT session_id
      FROM (
        SELECT session_id
          FROM customer_api.auth_sessions
         WHERE subject = $2
           AND revoked_at_ms IS NULL
           AND expires_at_ms > $7
         ORDER BY issued_at_ms DESC, session_id ASC
         OFFSET ($8::integer - 1)
      ) AS overflow
  ) AS doomed
  WHERE target.session_id = doomed.session_id
    AND NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING target.session_id
),
inserted AS (
  INSERT INTO customer_api.auth_sessions
    (session_id, subject, token_digest, device_digest,
     issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
  SELECT $1, $2, $3, $4, $5, $6, $7, false, NULL
  WHERE NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING session_id, subject, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM inserted AS row) AS session_id,
  (SELECT row.subject FROM inserted AS row) AS subject,
  (SELECT row.token_digest FROM inserted AS row) AS token_digest,
  (SELECT row.device_digest FROM inserted AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM inserted AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM inserted AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM inserted AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM inserted AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM inserted AS row) AS revoked_at_ms;
`;

const AUTH_GET_SQL = `
WITH stale AS (
  DELETE FROM customer_api.auth_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
)
SELECT session_id, subject, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM customer_api.auth_sessions
 WHERE session_id = $1
   AND NOT EXISTS (SELECT 1 FROM stale);
`;

const AUTH_GET_BY_TOKEN_SQL = `
WITH stale AS (
  DELETE FROM customer_api.auth_sessions
   WHERE token_digest = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
)
SELECT session_id, subject, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM customer_api.auth_sessions
 WHERE token_digest = $1
   AND NOT EXISTS (SELECT 1 FROM stale);
`;

const AUTH_REFRESH_SQL = `
WITH target AS (
  SELECT session_id, revoked_at_ms
    FROM customer_api.auth_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM customer_api.auth_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $3
  RETURNING session_id
),
conflicts AS (
  SELECT session_id
    FROM customer_api.auth_sessions
   WHERE token_digest = $2
     AND session_id <> $1
   LIMIT 1
),
updated AS (
  UPDATE customer_api.auth_sessions
     SET token_digest = $2,
         expires_at_ms = GREATEST($4::bigint, expires_at_ms),
         last_used_at_ms = GREATEST($3::bigint, last_used_at_ms)
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
     AND NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING session_id, subject, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms,
  EXISTS (
    SELECT 1
      FROM conflicts
     WHERE EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
       AND NOT EXISTS (SELECT 1 FROM stale)
  ) AS conflicted;
`;

const AUTH_REVOKE_SQL = `
WITH target AS (
  SELECT session_id, subject, revoked_at_ms
    FROM customer_api.auth_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM customer_api.auth_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
),
evicted AS (
  DELETE FROM customer_api.auth_sessions AS doomed_session
  USING (
    SELECT session_id
      FROM (
        SELECT session_id
          FROM customer_api.auth_sessions
         WHERE subject = (SELECT subject FROM target)
           AND revoked_at_ms IS NOT NULL
           AND session_id <> $1
         ORDER BY revoked_at_ms DESC, session_id ASC
         OFFSET $3::integer
      ) AS overflow
  ) AS doomed
  WHERE doomed_session.session_id = doomed.session_id
    -- Revoking an expired or already-revoked record is a no-op: the
    -- eviction must fire only when the target will actually transition,
    -- exactly like the memory backend's early return. The order in
    -- which sibling CTEs evaluate target and stale is unspecified,
    -- so the gate repeats the liveness predicates instead of relying on
    -- target being empty once stale has fired.
    AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
    AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING doomed_session.session_id
),
updated AS (
  UPDATE customer_api.auth_sessions
     SET revoked = true,
         revoked_at_ms = GREATEST($2::bigint, issued_at_ms)
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const AUTH_BIND_DEVICE_SQL = `
WITH target AS (
  SELECT session_id, revoked_at_ms, device_digest
    FROM customer_api.auth_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM customer_api.auth_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $3
  RETURNING session_id
),
updated AS (
  UPDATE customer_api.auth_sessions
     SET device_digest = $2,
         last_used_at_ms = GREATEST($3::bigint, last_used_at_ms)
   WHERE session_id = $1
     AND EXISTS (
       SELECT 1 FROM target
        WHERE target.revoked_at_ms IS NULL
          AND target.device_digest IS NULL
     )
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const AUTH_SWEEP_SQL = `
DELETE FROM customer_api.auth_sessions
 WHERE revoked_at_ms IS NULL
   AND expires_at_ms <= $1
RETURNING session_id;
`;

const AUTH_LIST_SQL = `
SELECT session_id, subject, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM customer_api.auth_sessions
 WHERE subject = $1
   AND revoked_at_ms IS NULL
   AND expires_at_ms > $2
 ORDER BY last_used_at_ms DESC, session_id ASC
 LIMIT $3::integer;
`;

// Parameters for the auth-session startup probe: one valid issue, refresh
// and get run inside a transaction that is always rolled back, so the probe
// exercises the write path, the mutation trigger, the conflict and evict
// CTEs and the read surface, and leaves no trace.
const AUTH_PROBE_PARAMETERS = [
  "sess_000000000000000000000000",
  "syn_cust_schemaprobe",
  "0000000000000000000000000000000000000000000000000000000000000000",
  null,
  1,
  2,
  1,
  1
];
const AUTH_PROBE_ROTATE_DIGEST =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// The subject lock serializing cross-instance writes on one subject's
// bound: a transaction-scoped advisory lock on the subject's hash, taken
// before the lifecycle statement runs so its snapshot already includes
// every earlier writer's commit.
const LOCK_SUBJECT_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0));";

// Resolves a session's subject inside the write transaction so the
// tombstone-bound ops can take the same per-subject advisory lock issue
// takes.
const AUTH_SUBJECT_SQL = `
SELECT subject
  FROM customer_api.auth_sessions
 WHERE session_id = $1;
`;

/** @param {unknown} error */
function unavailable(error) {
  return error instanceof StoreError ? error : new StoreUnavailableError();
}

const NAMESPACE_PATTERN = /^[a-z0-9_-]{1,64}$/u;

/**
 * @param {{ dsn: unknown, namespace?: unknown }} options
 * @returns {import("./store.mjs").CustomerApiStore}
 */
export function createPostgresStore({ dsn, namespace = "rate-limit" }) {
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new StoreConfigError("PostgreSQL store requires a connection DSN");
  }
  if (typeof namespace !== "string" || !NAMESPACE_PATTERN.test(namespace)) {
    throw new StoreConfigError("PostgreSQL store namespace must match ^[a-z0-9_-]{1,64}$");
  }
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new StoreConfigError("PostgreSQL store DSN must be a valid connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new StoreConfigError("PostgreSQL store DSN must use a postgres:// or postgresql:// URL");
  }
  // The DSN (user, password, host) is connection material: it is never logged,
  // and failure paths surface only StoreUnavailableError.
  const connectionDsn = /** @type {string} */ (dsn);
  /** @type {import("pg").Pool | null} */
  let pool = null;
  /** @type {Promise<void> | null} */
  let opening = null;
  let closed = false;

  async function openPool() {
    const { Pool } = await import("pg");
    const created = new Pool({
      connectionString: connectionDsn,
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // A query stuck on a dead or wedged connection must bound like a
      // request, not hang the consume forever.
      query_timeout: 15_000
    });
    // An idle pooled client can die outside any request (server restart,
    // administrator kill); the pool forwards that as an 'error' event which
    // is an unhandled EventEmitter error — Node rethrows it and kills the
    // whole application. Query failures still surface per request as
    // StoreUnavailableError, so the pool-level event only means "drop the
    // dead client".
    created.on("error", () => {});
    pool = created;
  }

  /**
   * The startup contract is not just reachability: the schema must carry
   * every relation and constraint the consume statement relies on. The
   * version check pins the catalog revision; the rolled-back consume probe
   * proves the whole statement resolves (a missing table, renamed column or
   * dropped primary key rejects here instead of per request at runtime).
   */
  async function probeSchema() {
    const checked = /** @type {import("pg").Pool} */ (pool);
    const result = await checked.query(SCHEMA_VERSION_SQL);
    if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
      throw new StoreUnavailableError("customer-api store schema is missing or incompatible");
    }
    const client = await checked.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(CONSUME_SQL, PROBE_PARAMETERS);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async function openOnce() {
    if (pool === null) {
      await openPool();
    }
    try {
      await probeSchema();
    } catch (error) {
      // A failed probe must not leave a reachable backend behind: drain the
      // pool so every later consume fails closed instead of running against
      // an unrecognized schema.
      const ending = pool;
      pool = null;
      await ending?.end().catch(() => undefined);
      throw unavailable(error);
    }
    // close() raced with this initialize: drain the pool it just opened.
    if (closed) {
      const orphan = pool;
      pool = null;
      await orphan?.end().catch(() => undefined);
    }
  }

  return Object.freeze({
    kind: "postgresql",
    async initialize() {
      closed = false;
      // Single-flight: concurrent callers share one probe so a racing pair
      // can never create two pools and leak the loser.
      opening ??= openOnce();
      await opening.finally(() => {
        opening = null;
      });
    },
    /**
     * @param {import("./rate-limit.mjs").RateLimitConsumeCommand} command
     * @returns {Promise<import("./rate-limit.mjs").RateLimitResult>}
     */
    async consumeRateLimit(command) {
      assertRateLimitConsumeCommand(command);
      const { key, now, windowMs, limit, maxKeys } = command;
      if (pool === null) {
        throw new StoreUnavailableError("customer-api store is not initialized");
      }
      try {
        const result = await pool.query(CONSUME_SQL, [key, now, windowMs, maxKeys, namespace]);
        const row = result.rows[0] ?? {};
        if (row.request_count === null || row.request_count === undefined) {
          // The table is full of live buckets and this key owns none: deny
          // exactly like the memory backend's bounded-map answer.
          return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        }
        const count = Number(row.request_count);
        const resetAt = Number(row.reset_at_ms);
        if (count > limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
          };
        }
        return { allowed: true };
      } catch (error) {
        throw unavailable(error);
      }
    },
    async close() {
      closed = true;
      const ending = pool;
      pool = null;
      await ending?.end();
    }
  });
}

/**
 * @param {Record<string, unknown>} row
 * @returns {import("./auth-session-store.mjs").AuthSessionRecord | null}
 */
function authSessionRecord(row) {
  if (row.session_id === null || row.session_id === undefined) {
    return null;
  }
  return Object.freeze({
    session_id: String(row.session_id),
    subject: String(row.subject),
    token_digest: String(row.token_digest),
    device_digest:
      row.device_digest === null || row.device_digest === undefined
        ? null
        : String(row.device_digest),
    issued_at_ms: Number(row.issued_at_ms),
    expires_at_ms: Number(row.expires_at_ms),
    last_used_at_ms: Number(row.last_used_at_ms),
    revoked: row.revoked === true,
    revoked_at_ms:
      row.revoked_at_ms === null || row.revoked_at_ms === undefined
        ? null
        : Number(row.revoked_at_ms)
  });
}

/**
 * The PostgreSQL backend of the auth-session seam. Same hardening as the
 * rate-limit backend — lazily loaded driver, bounded pool, query timeout,
 * idle-client 'error' listener, single-flight initialize with drain on
 * probe failure and on a close race — plus the journal-style serialized
 * write queue (`tail`) whose first non-StoreError failure latches `failure`
 * so every later operation fails closed with the same unavailable error.
 * SQLSTATE classes 22/23 are deterministic rejections of the command
 * itself: they surface as StoreError without latching.
 *
 * @param {{ dsn: unknown }} options
 * @returns {import("./auth-session-store.mjs").AuthSessionStore}
 */
export function createPostgresAuthSessionStore({ dsn }) {
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new StoreConfigError("PostgreSQL auth session store requires a connection DSN");
  }
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new StoreConfigError("PostgreSQL auth session store DSN must be a valid connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new StoreConfigError("PostgreSQL auth session store DSN must use a postgres:// or postgresql:// URL");
  }
  // The DSN (user, password, host) is connection material: it is never
  // logged, and failure paths surface only StoreUnavailableError.
  const connectionDsn = /** @type {string} */ (dsn);
  /** @type {import("pg").Pool | null} */
  let pool = null;
  /** @type {Promise<void> | null} */
  let opening = null;
  /** @type {Promise<void> | null} */
  let closing = null;
  let closed = false;
  /** Queued writes, in issue order; resolves after every prior write settles. */
  let tail = Promise.resolve();
  /** First write failure; every later operation rethrows it. */
  /** @type {StoreUnavailableError | null} */
  let failure = null;

  async function openPool() {
    const { Pool } = await import("pg");
    const created = new Pool({
      connectionString: connectionDsn,
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Tags this store's clients so operational probes can distinguish
      // them from the rate-limit store's pool on the same database.
      application_name: "customer-api-auth-session-store",
      // A query stuck on a dead or wedged connection must bound like a
      // request, not hang the lifecycle op forever.
      query_timeout: 15_000
    });
    // An idle pooled client can die outside any request (server restart,
    // administrator kill); the pool forwards that as an 'error' event which
    // is an unhandled EventEmitter error — Node rethrows it and kills the
    // whole application. Query failures still surface per operation as
    // StoreUnavailableError, so the pool-level event only means "drop the
    // dead client".
    created.on("error", () => {});
    pool = created;
  }

  /**
   * The startup contract is not just reachability: the schema must carry
   * every relation and constraint the lifecycle statements rely on. The
   * version check pins the catalog revision; the rolled-back issue /
   * refresh / get probe proves the whole CTE surface resolves (a missing
   * table, renamed column or dropped primary key rejects here instead of
   * per operation at runtime).
   */
  async function probeSchema() {
    const checked = /** @type {import("pg").Pool} */ (pool);
    const result = await checked.query(SCHEMA_VERSION_SQL);
    if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
      throw new StoreUnavailableError("customer-api auth session store schema is missing or incompatible");
    }
    const client = await checked.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(AUTH_ISSUE_SQL, AUTH_PROBE_PARAMETERS);
        await client.query(AUTH_REFRESH_SQL, [
          AUTH_PROBE_PARAMETERS[0],
          AUTH_PROBE_ROTATE_DIGEST,
          1,
          2
        ]);
        await client.query(AUTH_GET_SQL, [AUTH_PROBE_PARAMETERS[0], 1]);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async function openOnce() {
    if (pool === null) {
      await openPool();
    }
    try {
      await probeSchema();
    } catch (error) {
      // A failed probe must not leave a reachable backend behind: drain the
      // pool so every later operation fails closed instead of running
      // against an unrecognized schema.
      const ending = pool;
      pool = null;
      await ending?.end().catch(() => undefined);
      throw unavailable(error);
    }
    // close() raced with this initialize: drain the pool it just opened
    // and fail the initialize instead of resolving on a dead store.
    if (closed) {
      const orphan = pool;
      pool = null;
      await orphan?.end().catch(() => undefined);
      throw new StoreUnavailableError(
        "customer-api auth session store was closed during initialization"
      );
    }
  }

  async function closeOnce() {
    try {
      await tail;
      const ending = pool;
      pool = null;
      await ending?.end();
      if (failure !== null) {
        throw failure;
      }
    } finally {
      closing = null;
    }
  }

  /**
   * The subject-bound invariants (active cap on issue, tombstone cap on
   * revoke) are evaluated against a statement snapshot, so a second
   * backend writing the same subject concurrently would ghost records
   * past the cap: each statement sees the other still uncommitted. The
   * write queue serializes only this store instance; a per-subject advisory
   * transaction lock serializes the same-subject writes of every store
   * instance sharing the database. One lock per statement — taken before
   * the op and released at commit — cannot deadlock with the row locks
   * the CTEs take afterwards, because a lock waiter never holds a row
   * lock yet.
   *
   * @param {import("pg").PoolClient} client
   * @param {string} subject
   */
  async function lockSubject(client, subject) {
    await client.query(LOCK_SUBJECT_SQL, [subject]);
  }

  /**
   * @template T
   * @param {(client: import("pg").PoolClient) => Promise<T>} operation
   * @param {string | ((client: import("pg").PoolClient) => Promise<string | null>) | null} subjectKey
   * @returns {Promise<T>}
   */
  function enqueueWrite(operation, subjectKey = null) {
    const write = tail.then(async () => {
      if (pool === null) {
        throw new StoreUnavailableError("customer-api auth session store is not initialized");
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          const subject =
            typeof subjectKey === "function" ? await subjectKey(client) : subjectKey;
          if (subject !== null && subject !== undefined) {
            await lockSubject(client, subject);
          }
          const result = await operation(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      } finally {
        client.release();
      }
    });
    tail = write.then(
      () => undefined,
      () => undefined
    );
    return write.catch((error) => {
      // StoreError rejections (caller bugs, deterministic storage-side
      // constraint violations) do not latch: only failures the store
      // cannot attribute to the command itself poison durability.
      if (error instanceof StoreError) {
        throw error;
      }
      failure = unavailable(error);
      throw failure;
    });
  }

  /**
   * SQLSTATE classes 22 (data exceptions) and 23 (integrity constraint
   * violations) are deterministic rejections of the command itself — a
   * caller bug, not a durability failure. The rejection surfaces as
   * StoreError without latching, identical to the memory backend.
   *
   * @param {unknown} error
   * @param {string} message
   */
  function storageRejected(error, message) {
    const code =
      error !== null && typeof error === "object"
        ? /** @type {{ code?: unknown }} */ (error).code
        : undefined;
    if (typeof code === "string" && (code.startsWith("22") || code.startsWith("23"))) {
      return new StoreError(message);
    }
    return null;
  }

  /**
   * @param {string} sql
   * @param {unknown[]} parameters
   * @returns {Promise<import("./auth-session-store.mjs").AuthSessionRecord | null>}
   */
  async function readRecord(sql, parameters) {
    await tail;
    if (failure !== null) {
      throw failure;
    }
    if (pool === null) {
      throw new StoreUnavailableError("customer-api auth session store is not initialized");
    }
    try {
      const result = await pool.query(sql, parameters);
      const row = result.rows[0] ?? {};
      return authSessionRecord(row);
    } catch (error) {
      throw unavailable(error);
    }
  }

  return Object.freeze({
    kind: "postgresql",
    async initialize() {
      // A close may be in flight while the pool is still usable: wait it
      // out instead of racing the pool teardown. Once the close lands the
      // store is ready again and a fresh pool is provisioned.
      const teardown = closing;
      if (teardown !== null) {
        await teardown;
      }
      closed = false;
      failure = null;
      tail = Promise.resolve();
      // Single-flight: concurrent callers share one probe so a racing pair
      // can never create two pools and leak the loser.
      opening ??= openOnce();
      await opening.finally(() => {
        opening = null;
      });
    },
    /** @param {import("./auth-session-store.mjs").AuthSessionIssueCommand} command */
    async issueSession(command) {
      assertAuthSessionIssueCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return /** @type {Promise<import("./auth-session-store.mjs").AuthSessionRecord>} */ (
        enqueueWrite(async (client) => {
          let result;
          try {
            result = await client.query(AUTH_ISSUE_SQL, [
              command.session_id,
              command.subject,
              command.token_digest,
              command.device_digest,
              command.issued_at_ms,
              command.expires_at_ms,
              command.last_used_at_ms,
              command.maxPerSubject
            ]);
          } catch (error) {
            const rejected = storageRejected(error, "auth session command was rejected by storage");
            if (rejected !== null) {
              throw rejected;
            }
            throw error;
          }
          const record = authSessionRecord(result.rows[0] ?? {});
          if (record === null) {
            throw new StoreError("auth session conflicts with a stored record");
          }
          return record;
        }, command.subject)
      );
    },
    /** @param {{session_id: string, now: number}} command */
    async getSession(command) {
      assertAuthSessionGetCommand(command);
      return readRecord(AUTH_GET_SQL, [command.session_id, command.now]);
    },
    /** @param {{token_digest: string, now: number}} command */
    async getSessionByTokenDigest(command) {
      assertAuthSessionGetByTokenCommand(command);
      return readRecord(AUTH_GET_BY_TOKEN_SQL, [command.token_digest, command.now]);
    },
    /** @param {import("./auth-session-store.mjs").AuthSessionRefreshCommand} command */
    async refreshSession(command) {
      assertAuthSessionRefreshCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result;
        try {
          result = await client.query(AUTH_REFRESH_SQL, [
            command.session_id,
            command.token_digest,
            command.now,
            command.expires_at_ms
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "auth session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        const row = result.rows[0] ?? {};
        if (row.conflicted === true) {
          throw new StoreError("auth session token digest conflicts with a stored record");
        }
        return authSessionRecord(row);
      });
    },
    /** @param {import("./auth-session-store.mjs").AuthSessionRevokeCommand} command */
    async revokeSession(command) {
      assertAuthSessionRevokeCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(
        async (client) => {
          let result;
          try {
            result = await client.query(AUTH_REVOKE_SQL, [
              command.session_id,
              command.now,
              command.maxRevokedPerSubject
            ]);
          } catch (error) {
            const rejected = storageRejected(error, "auth session command was rejected by storage");
            if (rejected !== null) {
              throw rejected;
            }
            throw error;
          }
          return authSessionRecord(result.rows[0] ?? {});
        },
        // The tombstone bound is per subject: resolve the row's subject
        // inside the transaction, then serialize on it like issue does.
        async (client) => {
          const resolved = await client.query(AUTH_SUBJECT_SQL, [command.session_id]);
          const subject = resolved.rows[0]?.subject;
          return typeof subject === "string" ? subject : null;
        }
      );
    },
    /** @param {import("./auth-session-store.mjs").AuthSessionBindDeviceCommand} command */
    async bindDevice(command) {
      assertAuthSessionBindDeviceCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result;
        try {
          result = await client.query(AUTH_BIND_DEVICE_SQL, [
            command.session_id,
            command.device_digest,
            command.now
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "auth session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        return authSessionRecord(result.rows[0] ?? {});
      });
    },
    /** @param {{now: number}} command */
    async sweepExpiredSessions(command) {
      assertAuthSessionSweepCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        const result = await client.query(AUTH_SWEEP_SQL, [command.now]);
        return { swept: result.rows.length };
      });
    },
    /** @param {{subject: string, now: number, limit: number}} command */
    async listSessions(command) {
      assertAuthSessionListCommand(command);
      await tail;
      if (failure !== null) {
        throw failure;
      }
      if (pool === null) {
        throw new StoreUnavailableError("customer-api auth session store is not initialized");
      }
      try {
        const result = await pool.query(AUTH_LIST_SQL, [
          command.subject,
          command.now,
          command.limit
        ]);
        return Object.freeze(
          result.rows.map((row) =>
            /** @type {import("./auth-session-store.mjs").AuthSessionRecord} */ (
              authSessionRecord(row)
            )
          )
        );
      } catch (error) {
        throw unavailable(error);
      }
    },
    async close() {
      const inFlight = closing;
      if (inFlight !== null) {
        // A second close joins the teardown instead of racing it.
        return inFlight;
      }
      // Mark the store closed synchronously: an initialize() already
      // probing sees the flag inside openOnce and gives up, while an
      // initialize() invoked from here on waits on `closing` before
      // provisioning a new pool.
      closed = true;
      const teardown = closeOnce();
      closing = teardown;
      return teardown;
    }
  });
}
