import {
  assertSessionBindDeviceCommand,
  assertSessionCountCommand,
  assertSessionGetByTokenCommand,
  assertSessionGetCommand,
  assertSessionIssueCommand,
  assertSessionListCommand,
  assertSessionRefreshCommand,
  assertSessionRevokeCommand,
  assertSessionSweepCommand,
  type OperatorSessionRecord,
  type SessionBindDeviceCommand,
  type SessionCountCommand,
  type SessionGetByTokenCommand,
  type SessionGetCommand,
  type SessionIssueCommand,
  type SessionListCommand,
  type SessionRefreshCommand,
  type SessionRevokeCommand,
  type SessionStore,
  type SessionSweepCommand,
  SessionStoreConfigError,
  SessionStoreError,
  SessionStoreUnavailableError
} from "./session-store.js";
import type { OperatorRole } from "../auth/access.js";
import type { Pool, QueryResult, QueryResultRow } from "pg";

// PostgreSQL backend for the backoffice session-store seam
// (`BACKOFFICE_SESSION_STORE=postgresql`, DSN via
// `BACKOFFICE_SESSION_STORE_DSN`). Dev-only groundwork so operator sessions
// and their device bindings survive a BFF restart; the schema it requires is
// `migrations/0002_operator_sessions.sql`, applied through the package's
// `verify:migrations`-governed source catalog. The store speaks only to the
// `backoffice_control` schema and only for its own tables.
//
// The `pg` driver loads lazily inside initialize(): consumers that import
// this module but never select the postgres backend never touch the driver,
// so the package stays importable without the dependency installed, while a
// postgres-mode startup without a working driver still fails fast.
//
// Every lifecycle op is one CTE statement so a store call stays atomic
// without a client-managed transaction; `tail` serializes the writes so the
// in-process ordering is identical to the memory backend's single thread.
// Each statement reproduces the memory model exactly:
//   - `issue`: a same-snapshot conflict check (session id or bearer digest
//     held by any stored record is a deterministic SessionStoreError), the
//     expired sweep, the bound device's live-session displacement, then the
//     subject overflow evict on live records only — dead actives are already
//     gone, so the OFFSET ordering never counts them;
//   - `get`: the lazy-evict DELETE plus a NOT EXISTS gate so an expired
//     unrevoked row reads as absent, exactly like the map's lazy expiry;
//   - `refresh`/`revoke`/`bindDevice`: FOR UPDATE on the target, the same
//     lazy evict, then the UPDATE guarded by the liveness predicates and —
//     for refresh — the digest-conflict check; the UPDATE applies GREATEST
//     so expiry, last-used and revoked_at only move forward;
//   - `revoke` additionally evicts the subject's revoked records beyond the
//     bound, ordered by newest revoked_at first, computed against the
//     pre-update snapshot (the revoked row itself never competes);
//   - `sweep`, `list` and `count` are the plain evict/read surfaces.
// Clock semantics never come from the database: `now` is the caller's
// injected clock, exactly like the memory backend.

const schemaVersion = 2;

const SCHEMA_VERSION_SQL = `
SELECT migration.version
  FROM backoffice_control.schema_migrations AS migration
 ORDER BY migration.version DESC
 LIMIT 1;
`;

const ISSUE_SQL = `
WITH conflicts AS (
  SELECT session_id
    FROM backoffice_control.operator_sessions
   WHERE session_id = $1
      OR token_digest = $6
   LIMIT 1
),
evicted AS (
  DELETE FROM backoffice_control.operator_sessions AS target
  USING (
    SELECT session_id
      FROM backoffice_control.operator_sessions
     WHERE revoked_at_ms IS NULL
       AND expires_at_ms <= $10
    UNION ALL
    SELECT session_id
      FROM backoffice_control.operator_sessions
     WHERE device_digest = $7
       AND revoked_at_ms IS NULL
    UNION ALL
    SELECT session_id
      FROM (
        SELECT session_id
          FROM backoffice_control.operator_sessions
         WHERE subject = $2
           AND revoked_at_ms IS NULL
           AND expires_at_ms > $10
           -- The device branch already dooms the rows bound to the new
           -- session's device: counting them in the keeper window would
           -- under-evict, so the bound applies to the records that survive.
           AND ($7 IS NULL OR device_digest IS DISTINCT FROM $7)
         ORDER BY issued_at_ms DESC, session_id ASC
         OFFSET ($11::integer - 1)
      ) AS overflow
  ) AS doomed
  WHERE target.session_id = doomed.session_id
    AND NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING target.session_id
),
inserted AS (
  INSERT INTO backoffice_control.operator_sessions
    (session_id, subject, email, name, role, token_digest, device_digest,
     issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms)
  SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, NULL
  WHERE NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING session_id, subject, email, name, role, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM inserted AS row) AS session_id,
  (SELECT row.subject FROM inserted AS row) AS subject,
  (SELECT row.email FROM inserted AS row) AS email,
  (SELECT row.name FROM inserted AS row) AS name,
  (SELECT row.role FROM inserted AS row) AS role,
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
  DELETE FROM backoffice_control.operator_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
)
SELECT session_id, subject, email, name, role, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM backoffice_control.operator_sessions
 WHERE session_id = $1
   AND NOT EXISTS (SELECT 1 FROM stale);
`;

const GET_BY_TOKEN_SQL = `
WITH stale AS (
  DELETE FROM backoffice_control.operator_sessions
   WHERE token_digest = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
)
SELECT session_id, subject, email, name, role, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM backoffice_control.operator_sessions
 WHERE token_digest = $1
   AND NOT EXISTS (SELECT 1 FROM stale);
`;

const REFRESH_SQL = `
WITH target AS (
  SELECT session_id, revoked_at_ms
    FROM backoffice_control.operator_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM backoffice_control.operator_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $3
  RETURNING session_id
),
conflicts AS (
  SELECT session_id
    FROM backoffice_control.operator_sessions
   WHERE token_digest = $2
     AND session_id <> $1
   LIMIT 1
),
updated AS (
  UPDATE backoffice_control.operator_sessions
     SET token_digest = $2,
         expires_at_ms = GREATEST($4::bigint, expires_at_ms),
         last_used_at_ms = GREATEST($3::bigint, last_used_at_ms)
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
     AND NOT EXISTS (SELECT 1 FROM conflicts)
  RETURNING session_id, subject, email, name, role, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.email FROM updated AS row) AS email,
  (SELECT row.name FROM updated AS row) AS name,
  (SELECT row.role FROM updated AS row) AS role,
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

const REVOKE_SQL = `
WITH target AS (
  SELECT session_id, subject, revoked_at_ms
    FROM backoffice_control.operator_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM backoffice_control.operator_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $2
  RETURNING session_id
),
evicted AS (
  DELETE FROM backoffice_control.operator_sessions AS doomed_session
  USING (
    SELECT session_id
      FROM (
        SELECT session_id
          FROM backoffice_control.operator_sessions
         WHERE subject = (SELECT subject FROM target)
           AND revoked_at_ms IS NOT NULL
           AND session_id <> $1
         ORDER BY revoked_at_ms DESC, session_id ASC
         OFFSET $3::integer
      ) AS overflow
  ) AS doomed
  WHERE doomed_session.session_id = doomed.session_id
  RETURNING doomed_session.session_id
),
updated AS (
  UPDATE backoffice_control.operator_sessions
     SET revoked = true,
         revoked_at_ms = GREATEST($2::bigint, issued_at_ms)
   WHERE session_id = $1
     AND EXISTS (SELECT 1 FROM target WHERE target.revoked_at_ms IS NULL)
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, email, name, role, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.email FROM updated AS row) AS email,
  (SELECT row.name FROM updated AS row) AS name,
  (SELECT row.role FROM updated AS row) AS role,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const BIND_DEVICE_SQL = `
WITH target AS (
  SELECT session_id, revoked_at_ms, device_digest
    FROM backoffice_control.operator_sessions
   WHERE session_id = $1
   FOR UPDATE
),
stale AS (
  DELETE FROM backoffice_control.operator_sessions
   WHERE session_id = $1
     AND revoked_at_ms IS NULL
     AND expires_at_ms <= $3
  RETURNING session_id
),
updated AS (
  UPDATE backoffice_control.operator_sessions
     SET device_digest = $2,
         last_used_at_ms = GREATEST($3::bigint, last_used_at_ms)
   WHERE session_id = $1
     AND EXISTS (
       SELECT 1 FROM target
        WHERE target.revoked_at_ms IS NULL
          AND target.device_digest IS NULL
     )
     AND NOT EXISTS (SELECT 1 FROM stale)
  RETURNING session_id, subject, email, name, role, token_digest, device_digest,
            issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
)
SELECT
  (SELECT row.session_id FROM updated AS row) AS session_id,
  (SELECT row.subject FROM updated AS row) AS subject,
  (SELECT row.email FROM updated AS row) AS email,
  (SELECT row.name FROM updated AS row) AS name,
  (SELECT row.role FROM updated AS row) AS role,
  (SELECT row.token_digest FROM updated AS row) AS token_digest,
  (SELECT row.device_digest FROM updated AS row) AS device_digest,
  (SELECT row.issued_at_ms FROM updated AS row) AS issued_at_ms,
  (SELECT row.expires_at_ms FROM updated AS row) AS expires_at_ms,
  (SELECT row.last_used_at_ms FROM updated AS row) AS last_used_at_ms,
  (SELECT row.revoked FROM updated AS row) AS revoked,
  (SELECT row.revoked_at_ms FROM updated AS row) AS revoked_at_ms;
`;

const SWEEP_SQL = `
DELETE FROM backoffice_control.operator_sessions
 WHERE revoked_at_ms IS NULL
   AND expires_at_ms <= $1
RETURNING session_id;
`;

const LIST_SQL = `
SELECT session_id, subject, email, name, role, token_digest, device_digest,
       issued_at_ms, expires_at_ms, last_used_at_ms, revoked, revoked_at_ms
  FROM backoffice_control.operator_sessions
 WHERE subject = $1
   AND revoked_at_ms IS NULL
   AND expires_at_ms > $2
 ORDER BY last_used_at_ms DESC, session_id ASC
 LIMIT $3::integer;
`;

const COUNT_SQL = `
SELECT count(*) AS live
  FROM backoffice_control.operator_sessions
 WHERE revoked_at_ms IS NULL
   AND expires_at_ms > $1;
`;

// Parameters for the startup surface probe: one valid issue, refresh and
// get run inside a transaction that is always rolled back, so the probe
// exercises the write path, the mutation trigger, the conflict and evict
// CTEs and the read surface, and leaves no trace.
const PROBE_PARAMETERS = [
  "sess_000000000000000000000000",
  "dev:schema-probe",
  "probe@dev.solidchange.invalid",
  "Schema Probe",
  "auditor",
  "0000000000000000000000000000000000000000000000000000000000000000",
  null,
  1,
  2,
  1,
  1
];
const PROBE_ROTATE_DIGEST =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

interface SessionRow extends QueryResultRow {
  session_id: string | null;
  subject?: string;
  email?: string;
  name?: string;
  role?: string;
  token_digest?: string;
  device_digest?: string | null;
  issued_at_ms?: number | string;
  expires_at_ms?: number | string;
  last_used_at_ms?: number | string;
  revoked?: boolean;
  revoked_at_ms?: number | string | null;
  conflicted?: boolean;
}

function unavailable(error: unknown): SessionStoreError {
  return error instanceof SessionStoreError ? error : new SessionStoreUnavailableError();
}

function isOperatorRole(value: string): value is OperatorRole {
  return (
    value === "compliance-lead"
    || value === "support-l1"
    || value === "aml-investigator"
    || value === "fraud-investigator"
    || value === "auditor"
  );
}

function sessionRecord(row: SessionRow): OperatorSessionRecord | null {
  if (row.session_id === null || row.session_id === undefined) {
    return null;
  }
  const role = String(row.role);
  if (!isOperatorRole(role)) {
    // The CHECK constraint pins the role enum; anything else is schema
    // drift, which fails closed rather than minting a phantom role.
    throw new SessionStoreError("operator session role stored outside the pinned enum");
  }
  return Object.freeze({
    session_id: String(row.session_id),
    subject: String(row.subject),
    email: String(row.email),
    name: String(row.name),
    role,
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
 * The PostgreSQL backend of the operator-session seam. Same hardening as
 * the customer-api store backends — lazily loaded driver, bounded pool,
 * query timeout, idle-client 'error' listener, single-flight initialize
 * with drain on probe failure and on a close race — plus the journal-style
 * serialized write queue (`tail`) whose first non-SessionStoreError failure
 * latches `failure` so every later operation fails closed with the same
 * unavailable error. SQLSTATE classes 22/23 are deterministic rejections of
 * the command itself: they surface as SessionStoreError without latching.
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
      application_name: "backoffice-operator-session-store",
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
   * version check pins the catalog revision; the rolled-back issue /
   * refresh / get probe proves the whole CTE surface resolves (a missing
   * table, renamed column or dropped primary key rejects here instead of
   * per operation at runtime).
   */
  async function probeSchema(): Promise<void> {
    const checked = pool as Pool;
    const result = await checked.query(SCHEMA_VERSION_SQL);
    if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
      throw new SessionStoreUnavailableError(
        "backoffice session store schema is missing or incompatible"
      );
    }
    const client = await checked.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(ISSUE_SQL, PROBE_PARAMETERS);
        await client.query(REFRESH_SQL, [
          PROBE_PARAMETERS[0],
          PROBE_ROTATE_DIGEST,
          1,
          2
        ]);
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
    // close() raced with this initialize: drain the pool it just opened.
    if (closed) {
      const orphan = pool;
      pool = null;
      await orphan?.end().catch(() => undefined);
    }
  }

  function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const write = tail.then(operation);
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
  ): Promise<OperatorSessionRecord | null> {
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

  const NOT_INITIALIZED_PG = "backoffice session store is not initialized";

  return Object.freeze({
    kind: "postgresql" as const,
    async initialize() {
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
      return enqueueWrite(async () => {
        if (pool === null) {
          throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
        }
        let result: QueryResult<SessionRow>;
        try {
          result = await pool.query<SessionRow>(ISSUE_SQL, [
            command.session_id,
            command.subject,
            command.email,
            command.name,
            command.role,
            command.token_digest,
            command.device_digest,
            command.issued_at_ms,
            command.expires_at_ms,
            command.last_used_at_ms,
            command.maxPerSubject
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "operator session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        const record = sessionRecord(result.rows[0] ?? { session_id: null });
        if (record === null) {
          throw new SessionStoreError("operator session conflicts with a stored record");
        }
        return record;
      });
    },
    async getSession(command: SessionGetCommand) {
      assertSessionGetCommand(command);
      return readRecord(GET_SQL, [command.session_id, command.now]);
    },
    async getSessionByTokenDigest(command: SessionGetByTokenCommand) {
      assertSessionGetByTokenCommand(command);
      return readRecord(GET_BY_TOKEN_SQL, [command.token_digest, command.now]);
    },
    async refreshSession(command: SessionRefreshCommand) {
      assertSessionRefreshCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async () => {
        if (pool === null) {
          throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
        }
        let result: QueryResult<SessionRow>;
        try {
          result = await pool.query<SessionRow>(REFRESH_SQL, [
            command.session_id,
            command.token_digest,
            command.now,
            command.expires_at_ms
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "operator session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        const row = result.rows[0] ?? { session_id: null };
        if (row.conflicted === true) {
          throw new SessionStoreError("operator session token digest conflicts with a stored record");
        }
        return sessionRecord(row);
      });
    },
    async revokeSession(command: SessionRevokeCommand) {
      assertSessionRevokeCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async () => {
        if (pool === null) {
          throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
        }
        let result: QueryResult<SessionRow>;
        try {
          result = await pool.query<SessionRow>(REVOKE_SQL, [
            command.session_id,
            command.now,
            command.maxRevokedPerSubject
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "operator session command was rejected by storage");
          if (rejected !== null) {
            throw rejected;
          }
          throw error;
        }
        return sessionRecord(result.rows[0] ?? { session_id: null });
      });
    },
    async bindDevice(command: SessionBindDeviceCommand) {
      assertSessionBindDeviceCommand(command);
      if (failure !== null) {
        throw failure;
      }
      return enqueueWrite(async () => {
        if (pool === null) {
          throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
        }
        let result: QueryResult<SessionRow>;
        try {
          result = await pool.query<SessionRow>(BIND_DEVICE_SQL, [
            command.session_id,
            command.device_digest,
            command.now
          ]);
        } catch (error) {
          const rejected = storageRejected(error, "operator session command was rejected by storage");
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
      return enqueueWrite(async () => {
        if (pool === null) {
          throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
        }
        const result = await pool.query(SWEEP_SQL, [command.now]);
        return { swept: result.rows.length };
      });
    },
    async listSessions(command: SessionListCommand) {
      assertSessionListCommand(command);
      await tail;
      if (failure !== null) {
        throw failure;
      }
      if (pool === null) {
        throw new SessionStoreUnavailableError(NOT_INITIALIZED_PG);
      }
      try {
        const result = await pool.query<SessionRow>(LIST_SQL, [
          command.subject,
          command.now,
          command.limit
        ]);
        return Object.freeze(
          result.rows.map((row) => sessionRecord(row) as OperatorSessionRecord)
        );
      } catch (error) {
        throw unavailable(error);
      }
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
      await tail;
      const ending = pool;
      pool = null;
      await ending?.end();
      closed = true;
      if (failure !== null) {
        throw failure;
      }
    }
  });
}
