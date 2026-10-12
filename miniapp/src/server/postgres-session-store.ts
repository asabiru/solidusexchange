import {
  assertSessionCountCommand,
  assertSessionDeleteByTokenCommand,
  assertSessionGetByTokenCommand,
  assertSessionGetCommand,
  assertSessionIssueCommand,
  assertSessionListCommand,
  assertSessionRevokeCommand,
  assertSessionSweepCommand,
  assertSessionTouchCommand,
  assertSessionVerifyKycCommand,
  type CustomerSessionRecord,
  type SessionCountCommand,
  type SessionDeleteByTokenCommand,
  type SessionGetByTokenCommand,
  type SessionGetCommand,
  type SessionIssueCommand,
  type SessionKyc,
  type SessionListCommand,
  type SessionRevokeCommand,
  type SessionSource,
  type SessionStore,
  type SessionSweepCommand,
  type SessionTouchCommand,
  type SessionVerifyKycCommand,
  SessionStoreConfigError,
  SessionStoreError,
  SessionStoreUnavailableError
} from "./session-store.js";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

// PostgreSQL backend for the Mini App session-store seam
// (`MINIAPP_SESSION_STORE=postgresql`, DSN via `MINIAPP_SESSION_STORE_DSN`).
// Dev-only groundwork so customer sessions survive a BFF restart; the
// schema it requires is `migrations/0001_customer_sessions.sql`, applied
// through the package's `verify:migrations`-governed source catalog. The
// store speaks only to the `miniapp_control` schema and only for its own
// table.
//
// The `pg` driver loads lazily inside initialize(): consumers that import
// this module but never select the postgres backend never touch the driver,
// so the package stays importable without the dependency installed, while a
// postgres-mode startup without a working driver still fails fast.
//
// Every lifecycle op is one CTE statement, run inside an explicit
// transaction so same-subject writers on different store instances
// serialize: the bound-enforcing ops (issue, revoke) take a per-subject
// advisory transaction lock before their statement runs, while `tail`
// serializes the writes inside this instance so the in-process ordering is
// identical to the memory backend's single thread.
// Each statement reproduces the memory model exactly:
//   - `issue`: a same-snapshot conflict check (session id or bearer digest
//     held by any stored record is a deterministic SessionStoreError), the
//     expired sweep, then the subject overflow evict on live records only —
//     dead actives are already gone, so the OFFSET ordering never counts
//     them;
//   - `get`: the lazy-evict DELETE plus a NOT EXISTS gate so an expired
//     unrevoked row reads as absent, exactly like the map's lazy expiry;
//   - `touch`/`verifyKyc`/`revoke`: FOR UPDATE on the target, the same lazy
//     evict, then the UPDATE guarded by the liveness predicates; touch and
//     revoke apply GREATEST so last-used and revoked_at only move forward,
//     and verifyKyc is a one-way set;
//   - `revoke` additionally evicts the subject's revoked records beyond the
//     bound minus one (the new tombstone takes the last slot), ordered by
//     newest revoked_at first against the pre-update snapshot;
//   - `delete` drops the row outright — the logout path keeps no tombstone;
//   - `sweep`, `list`, `listRevoked` and `count` are the plain evict/read
//     surfaces.
// Clock semantics never come from the database: `now` is the caller's
// injected clock, exactly like the memory backend.

const schemaVersion = 1;

const SCHEMA_VERSION_SQL = `
SELECT migration.version
  FROM miniapp_control.schema_migrations AS migration
 ORDER BY migration.version DESC
 LIMIT 1;
`;

const ISSUE_SQL = `
WITH conflicts AS (
  SELECT session_id
    FROM miniapp_control.customer_sessions
   WHERE session_id = $1
      OR token_digest = $5
   LIMIT 1
),
evicted AS (
  DELETE FROM miniapp_control.customer_sessions AS target
  USING (
    SELECT session_id
      FROM miniapp_control.customer_sessions
     WHERE revoked_at_ms IS NULL
       AND expires_at_ms <= $9
    UNION ALL
    SELECT session_id
      FROM (
        SELECT session_id
          FROM miniapp_control.customer_sessions
         WHERE subject = $2
           AND revoked_at_ms IS NULL
           AND expires_at_ms > $9
         ORDER BY store_seq DESC, session_id ASC
         OFFSET ($10::integer - 1)
      ) AS overflow
  ) AS doomed
  WHERE target.session_id = doomed.session_id
    AND NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING target.session_id
),
inserted AS (
  INSERT INTO miniapp_control.customer_sessions
    (session_id, subject, source, kyc, token_digest, device_digest,
     issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
  SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, false, NULL
  WHERE NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING session_id, subject, source, kyc, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM inserted AS row) AS session_id,
  (SELECT row.subject FROM inserted AS row) AS subject,
  (SELECT row.source FROM inserted AS row) AS source,
  (SELECT row.kyc FROM inserted AS row) AS kyc,
  (SELECT row.token_digest FROM inserted AS row) AS token_digest,
  (SELECT row.device_digest FROM inserted AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM inserted AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM inserted AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM inserted AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM inserted AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM inserted AS row) AS revoked_at_ms;
`;

const GET_SQL = `
WITH stale AS (
  DELETE FROM miniapp_control.customer_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
)
SELECT session_id, subject, source, kyc, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM miniapp_control.customer_sessions
 WHERE session_id = $1
   AND NOT EXISTS (SELECT 1 FROM stale);
`;

const GET_BY_TOKEN_SQL = `
WITH stale AS (
  DELETE FROM miniapp_control.customer_sessions
   WHERE token_digest = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
)
SELECT session_id, subject, source, kyc, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM miniapp_control.customer_sessions
 WHERE token_digest = $1
   AND NOT EXISTS (SELECT 1 FROM stale);
`;

const TOUCH_SQL = `
WITH target AS (
  SELECT session_id, revoked_at_ms
    FROM miniapp_control.customer_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM miniapp_control.customer_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
),
updated AS (
  UPDATE miniapp_control.customer_sessions
     SET last_used_at_ms = GREATEST($2::bigint, last_used_at_ms)
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, source, kyc, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.source FROM updated AS row) AS source,
  (SELECT row.kyc FROM updated AS row) AS kyc,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const VERIFY_KYC_SQL = `
WITH target AS (
  SELECT session_id, revoked_at_ms
    FROM miniapp_control.customer_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM miniapp_control.customer_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
),
updated AS (
  UPDATE miniapp_control.customer_sessions
     SET kyc = 'verified'
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, source, kyc, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.source FROM updated AS row) AS source,
  (SELECT row.kyc FROM updated AS row) AS kyc,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const REVOKE_SQL = `
WITH target AS (
  SELECT session_id, subject, revoked_at_ms
    FROM miniapp_control.customer_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM miniapp_control.customer_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
),
evicted AS (
  DELETE FROM miniapp_control.customer_sessions AS doomed_session
  USING (
    SELECT session_id
      FROM (
        SELECT session_id
          FROM miniapp_control.customer_sessions
         WHERE subject = (SELECT subject FROM target)
           AND revoked_at_ms IS NOT NULL
           AND session_id <> $1
         ORDER BY store_seq DESC, session_id ASC
         OFFSET ($3::integer - 1)
      ) AS overflow
  ) AS doomed
  WHERE doomed_session.session_id = doomed.session_id
  RETURNING doomed_session.session_id
),
updated AS (
  UPDATE miniapp_control.customer_sessions
     SET revoked = true,
         revoked_at_ms = GREATEST($2::bigint, issued_at_ms),
         store_seq = nextval('miniapp_control.customer_sessions_seq')
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, source, kyc, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.source FROM updated AS row) AS source,
  (SELECT row.kyc FROM updated AS row) AS kyc,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const DELETE_BY_TOKEN_SQL = `
DELETE FROM miniapp_control.customer_sessions
 WHERE token_digest = $1
RETURNING session_id, subject, source, kyc, token_digest, device_digest,
          issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms;
`;

const SWEEP_SQL = `
DELETE FROM miniapp_control.customer_sessions
 WHERE revoked_at_ms IS NULL
   AND expires_at_ms <= $1
RETURNING session_id;
`;

const LIST_SQL = `
SELECT session_id, subject, source, kyc, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM miniapp_control.customer_sessions
 WHERE subject = $1
   AND revoked_at_ms IS NULL
   AND expires_at_ms > $2
 ORDER BY last_used_at_ms DESC, session_id ASC
 LIMIT $3::integer;
`;

const LIST_REVOKED_SQL = `
SELECT session_id, subject, source, kyc, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM miniapp_control.customer_sessions
 WHERE subject = $1
   AND revoked_at_ms IS NOT NULL
   AND expires_at_ms > $2
 ORDER BY store_seq DESC, session_id ASC
 LIMIT $3::integer;
`;

const COUNT_SQL = `
SELECT count(*) AS live
  FROM miniapp_control.customer_sessions
 WHERE revoked_at_ms IS NULL
   AND expires_at_ms > $1;
`;

// The subject-bound invariants (active cap on issue, tombstone cap on
// revoke) are evaluated against a statement snapshot, so a second
// backend writing the same subject concurrently would ghost records
// past the cap: each statement sees the other still uncommitted. The
// write queue serializes only this store instance; a per-subject advisory
// transaction lock serializes the same-subject writes of every store
// instance sharing the database. One lock per statement — taken before
// the op and released at commit — cannot deadlock with the row locks
// the CTEs take afterwards, because a lock waiter never holds a row
// lock of its own.
const LOCK_SUBJECT_SQL = "SELECT pg_advisory_xact_lock(hashtextextended($1, 0));";

// A revoke resolves the subject after the lock order starts: the subject is
// read inside the transaction so the lock targets the same row the CTE is
// about to transition.
const SESSION_SUBJECT_SQL = `
SELECT subject
  FROM miniapp_control.customer_sessions
 WHERE session_id = $1;
`;

// Parameters for the startup surface probe: one valid issue, touch and get
// run inside a transaction that is always rolled back, so the probe
// exercises the write path, the mutation trigger, the conflict and evict
// CTEs and the read surface, and leaves no trace.
const PROBE_PARAMETERS = [
  "sess_000000000000000000000000",
  "dev-0000000000000000",
  "dev-synthetic",
  "kyc-gated",
  "0000000000000000000000000000000000000000000000000000000000000000",
  null,
  1,
  2,
  1,
  1
];

interface SessionRow extends QueryResultRow {
  session_id: string | null;
  subject?: string;
  source?: string;
  kyc?: string;
  token_digest?: string;
  device_digest?: string | null;
  issued_at_ms?: number | string;
  expires_at_ms?: number | string;
  last_used_at_ms?: number | string;
  revoked?: boolean;
  revoked_at_ms?: number | string | null;
}

function unavailable(error: unknown): SessionStoreError {
  return error instanceof SessionStoreError ? error : new SessionStoreUnavailableError();
}

const SESSION_SOURCE_VALUES: ReadonlySet<string> = new Set<string>([
  "telegram",
  "dev-synthetic"
]);
const SESSION_KYC_VALUES: ReadonlySet<string> = new Set<string>([
  "verified",
  "kyc-gated"
]);

function sessionRecord(row: SessionRow): CustomerSessionRecord | null {
  if (row.session_id === null || row.session_id === undefined) {
    return null;
  }
  const source = String(row.source);
  if (!SESSION_SOURCE_VALUES.has(source)) {
    // The CHECK constraint pins the source enum; anything else is schema
    // drift, which fails closed rather than minting a phantom source.
    throw new SessionStoreError("customer session source stored outside the pinned enum");
  }
  const kyc = String(row.kyc);
  if (!SESSION_KYC_VALUES.has(kyc)) {
    // Same fail-closed drift guard on the KYC view.
    throw new SessionStoreError("customer session kyc stored outside the pinned enum");
  }
  return Object.freeze({
    session_id: String(row.session_id),
    subject: String(row.subject),
    source: source as SessionSource,
    kyc: kyc as SessionKyc,
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
 * The PostgreSQL backend of the customer-session seam. Same hardening as
 * the backoffice operator-session store — lazily loaded driver, bounded
 * pool, query timeout, idle-client 'error' listener, single-flight
 * initialize with drain on probe failure and on a close race — plus the
 * journal-style serialized write queue (`tail`) whose first
 * non-SessionStoreError failure latches `failure` so every later operation
 * fails closed with the same unavailable error. SQLSTATE classes 22/23 are
 * deterministic rejections of the command itself: they surface as
 * SessionStoreError without latching.
 */
export function createPostgresSessionStore(options: { dsn: unknown }): SessionStore {
  const { dsn } = options;
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new SessionStoreConfigError("PostgreSQL session store requires a connection DSN");
  }
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new SessionStoreConfigError("PostgreSQL session store DSN must be a valid connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new SessionStoreConfigError(
      "PostgreSQL session store DSN must use a postgres:// or postgresql:// URL"
    );
  }
  // The DSN (user, password, host) is connection material: it is never
  // logged, and failure paths surface only SessionStoreUnavailableError.
  const connectionDsn = dsn;
  let pool: Pool | null = null;
  let opening: Promise<void> | null = null;
  let closing: Promise<void> | null = null;
  let closed = false;
  /** Queued writes, in issue order; resolves after every prior write settles. */
  let tail = Promise.resolve();
  /** First write failure; every later operation rethrows it. */
  let failure: SessionStoreUnavailableError | null = null;

  async function openPool(): Promise<void> {
    const { Pool: PgPool } = await import("pg");
    const created = new PgPool({
      connectionString: connectionDsn,
      max: 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Tags this store's clients so operational probes can distinguish
      // them from the audit store's pool on the same database.
      application_name: "miniapp-customer-session-store",
      // A query stuck on a dead or wedged connection must bound like a
      // request, not hang the lifecycle op forever.
      query_timeout: 15_000
    });
    // An idle pooled client can die outside any request (server restart,
    // administrator kill); the pool forwards that as an 'error' event which
    // is an unhandled EventEmitter error — Node rethrows it and kills the
    // whole application. Query failures still surface per operation as
    // SessionStoreUnavailableError, so the pool-level event only means
    // "drop the dead client".
    created.on("error", () => {});
    pool = created;
  }

  /**
   * The startup contract is not just reachability: the schema must carry
   * every relation and constraint the lifecycle statements rely on. The
   * version check pins the catalog revision; the rolled-back issue / touch
   * / get probe proves the whole CTE surface resolves (a missing table,
   * renamed column or dropped primary key rejects here instead of per
   * operation at runtime).
   */
  async function probeSchema(): Promise<void> {
    const checked = pool as Pool;
    const result = await checked.query(SCHEMA_VERSION_SQL);
    if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
      throw new SessionStoreUnavailableError(
        "miniapp session store schema is missing or incompatible"
      );
    }
    const client = await checked.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(ISSUE_SQL, PROBE_PARAMETERS);
        await client.query(TOUCH_SQL, [PROBE_PARAMETERS[0], 2]);
        await client.query(GET_SQL, [PROBE_PARAMETERS[0], 1]);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  async function openOnce(): Promise<void> {
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
      throw new SessionStoreUnavailableError(
        "miniapp session store was closed during initialization"
      );
    }
  }

  async function closeOnce(): Promise<void> {
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

  async function lockSubject(client: PoolClient, subject: string): Promise<void> {
    await client.query(LOCK_SUBJECT_SQL, [subject]);
  }

  function enqueueWrite<T>(
    operation: (client: PoolClient) => Promise<T>,
    subjectKey: string | ((client: PoolClient) => Promise<string | null>) | null = null
  ): Promise<T> {
    const write = tail.then(async () => {
      if (pool === null) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
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
    return write.catch((error: unknown) => {
      // SessionStoreError rejections (caller bugs, deterministic
      // storage-side constraint violations) do not latch: only failures the
      // store cannot attribute to the command itself poison durability.
      if (error instanceof SessionStoreError) {
        throw error;
      }
      failure = unavailable(error) as SessionStoreUnavailableError;
      throw failure;
    });
  }

  /**
   * SQLSTATE classes 22 (data exceptions) and 23 (integrity constraint
   * violations) are deterministic rejections of the command itself — a
   * caller bug, not a durability failure. The rejection surfaces as
   * SessionStoreError without latching, identical to the memory backend.
   */
  function storageRejected(error: unknown, message: string): SessionStoreError | null {
    const code =
      error !== null && typeof error === "object"
        ? (error as { code?: unknown }).code
        : undefined;
    if (typeof code === "string" && (code.startsWith("22") || code.startsWith("23"))) {
      return new SessionStoreError(message);
    }
    return null;
  }

  async function readRecord(
    sql: string,
    parameters: unknown[]
  ): Promise<CustomerSessionRecord | null> {
    await tail;
    if (failure !== null) {
      throw failure;
    }
    if (pool === null) {
      throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
    }
    try {
      const result = await pool.query<SessionRow>(sql, parameters);
      const row = result.rows[0] ?? { session_id: null };
      return sessionRecord(row);
    } catch (error) {
      throw unavailable(error);
    }
  }

  async function readRecords(
    sql: string,
    parameters: unknown[]
  ): Promise<readonly CustomerSessionRecord[]> {
    await tail;
    if (failure !== null) {
      throw failure;
    }
    if (pool === null) {
      throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
    }
    try {
      const result = await pool.query<SessionRow>(sql, parameters);
      return Object.freeze(
        result.rows.map((row) => sessionRecord(row) as CustomerSessionRecord)
      );
    } catch (error) {
      throw unavailable(error);
    }
  }

  const NOT_INITIALIZED_PG = "miniapp session store is not initialized";

  return Object.freeze({
    kind: "postgresql" as const,
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
    async issueSession(command: SessionIssueCommand) {
      assertSessionIssueCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result: QueryResult<SessionRow>;
        try {
          result = await client.query<SessionRow>(ISSUE_SQL, [
            command.session_id,
            command.subject,
            command.source,
            command.kyc,
            command.token_digest,
            command.device_digest,
            command.issued_at_ms,
            command.expires_at_ms,
            command.last_used_at_ms,
            command.maxPerSubject
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "customer session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        const record = sessionRecord(result.rows[0] ?? { session_id: null });
        if (record === null) {
          throw new SessionStoreError("customer session conflicts with a stored record");
        }
        return record;
      }, command.subject);
    },
    async getSession(command: SessionGetCommand) {
      assertSessionGetCommand(command);
      return readRecord(GET_SQL, [command.session_id, command.now]);
    },
    async getSessionByTokenDigest(command: SessionGetByTokenCommand) {
      assertSessionGetByTokenCommand(command);
      return readRecord(GET_BY_TOKEN_SQL, [command.token_digest, command.now]);
    },
    async touchSession(command: SessionTouchCommand) {
      assertSessionTouchCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result: QueryResult<SessionRow>;
        try {
          result = await client.query<SessionRow>(TOUCH_SQL, [
            command.session_id,
            command.now
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "customer session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        return sessionRecord(result.rows[0] ?? { session_id: null });
      });
    },
    async verifySessionKyc(command: SessionVerifyKycCommand) {
      assertSessionVerifyKycCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result: QueryResult<SessionRow>;
        try {
          result = await client.query<SessionRow>(VERIFY_KYC_SQL, [
            command.session_id,
            command.now
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "customer session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        return sessionRecord(result.rows[0] ?? { session_id: null });
      });
    },
    async revokeSession(command: SessionRevokeCommand) {
      assertSessionRevokeCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result: QueryResult<SessionRow>;
        try {
          result = await client.query<SessionRow>(REVOKE_SQL, [
            command.session_id,
            command.now,
            command.maxRevokedPerSubject
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "customer session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        return sessionRecord(result.rows[0] ?? { session_id: null });
      }, async (client) => {
        const resolved = await client.query<{ subject?: string }>(SESSION_SUBJECT_SQL, [
          command.session_id
        ]);
        return resolved.rows[0]?.subject ?? null;
      });
    },
    async deleteSessionByTokenDigest(command: SessionDeleteByTokenCommand) {
      assertSessionDeleteByTokenCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        let result: QueryResult<SessionRow>;
        try {
          result = await client.query<SessionRow>(DELETE_BY_TOKEN_SQL, [command.token_digest]);
        } catch (error) {
          const rejected = storageRejected(error, "customer session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        return sessionRecord(result.rows[0] ?? { session_id: null });
      });
    },
    async sweepExpiredSessions(command: SessionSweepCommand) {
      assertSessionSweepCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async (client) => {
        const result = await client.query(SWEEP_SQL, [command.now]);
        return { swept: result.rows.length };
      });
    },
    async listSessions(command: SessionListCommand) {
      assertSessionListCommand(command);
      return readRecords(LIST_SQL, [command.subject, command.now, command.limit]);
    },
    async listRevokedSessions(command: SessionListCommand) {
      assertSessionListCommand(command);
      return readRecords(LIST_REVOKED_SQL, [command.subject, command.now, command.limit]);
    },
    async countSessions(command: SessionCountCommand) {
      assertSessionCountCommand(command);
      await tail;
      if (failure !== null) {
        throw failure;
      }
      if (pool === null) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
      }
      try {
        const result = await pool.query<{ live: string | number }>(COUNT_SQL, [command.now]);
        return Number(result.rows[0]?.live ?? 0);
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
