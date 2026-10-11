import { StoreConfigError, StoreError, StoreUnavailableError } from "./journal-store.mjs";
import { snapshotPlainData } from "./snapshot.mjs";

// PostgreSQL backend for the matching journal seam (`MATCHING_CORE_STORE=
// postgres`, DSN via `MATCHING_CORE_STORE_DSN`). Dev-only groundwork so the
// engine's append-only event journal can survive restarts; the schema it
// requires is `migrations/0001_matching_journal.sql`, applied through the
// package's `verify:migrations`-governed source catalog. The store speaks
// only to the `matching_core` schema and only for its own table.
//
// The `pg` driver loads lazily inside initialize(): consumers that import
// this module but never select the postgres backend never touch the
// driver, so the package stays importable without the dependency
// installed, while a postgres-mode startup without a working driver still
// fails fast.
//
// Every `append` call is ONE statement — `append_matching_journal` takes
// the whole emitted batch in a single advisory-locked step, enforces
// contiguous `seq` continuation in storage, and inserts atomically — so a
// batch either lands whole or not at all. Calls serialize through an
// internal tail so journal order never depends on pool scheduling, and the
// first write failure is latched: every later `append`, `load` or `close`
// rethrows it, because an engine that cannot trust its durable journal
// must fail closed, never silently degrade to in-memory only.
//
// The DSN (user, password, host) is connection material: it is never
// logged, and failure paths surface only StoreUnavailableError.

const schemaVersion = 1;

const APPEND_SQL = "SELECT matching_core.append_matching_journal($1, $2::jsonb) AS next_seq;";

const LOAD_SQL = `
SELECT journal.payload
  FROM matching_core.matching_journal AS journal
 WHERE journal.namespace = $1
 ORDER BY journal.seq ASC;
`;

const SCHEMA_VERSION_SQL = `
SELECT migration.version
  FROM matching_core.schema_migrations AS migration
 ORDER BY migration.version DESC
 LIMIT 1;
`;

/** @param {unknown} error */
function unavailable(error) {
  return error instanceof StoreUnavailableError
    ? error
    : new StoreUnavailableError();
}

const NAMESPACE_PATTERN = /^[a-z0-9_-]{1,64}$/u;

/**
 * @param {{ dsn: unknown, namespace?: unknown }} options
 * @returns {import("./journal-store.mjs").MatchingJournalStore}
 */
export function createPostgresJournalStore({ dsn, namespace = "journal" }) {
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new StoreConfigError("PostgreSQL journal store requires a connection DSN");
  }
  if (typeof namespace !== "string" || !NAMESPACE_PATTERN.test(namespace)) {
    throw new StoreConfigError("PostgreSQL journal store namespace must match ^[a-z0-9_-]{1,64}$");
  }
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new StoreConfigError("PostgreSQL journal store DSN must be a valid connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new StoreConfigError("PostgreSQL journal store DSN must use a postgres:// or postgresql:// URL");
  }
  /** @type {import("pg").Pool | null} */
  let pool = null;
  /** Queued writes, in issue order; resolves after every prior write settles. */
  let tail = Promise.resolve();
  /** First write failure; every later operation rethrows it. */
  /** @type {StoreUnavailableError | null} */
  let failure = null;

  /**
   * @param {readonly import("./events.mjs").MatchingEvent[]} batch
   */
  async function writeBatch(batch) {
    if (pool === null) {
      throw new StoreUnavailableError("matching journal store is not initialized");
    }
    try {
      await pool.query(APPEND_SQL, [namespace, JSON.stringify(batch)]);
    } catch (error) {
      // SQLSTATE classes 22 (data exceptions) and 23 (integrity
      // constraint violations) are deterministic rejections of the batch
      // itself — a caller bug, not a durability failure. The recorded
      // stream was not touched, so the rejection surfaces as StoreError
      // without latching, identical to the memory backend.
      const code =
        error !== null && typeof error === "object"
          ? /** @type {{ code?: unknown }} */ (error).code
          : undefined;
      if (typeof code === "string" && (code.startsWith("22") || code.startsWith("23"))) {
        throw new StoreError("journal append was rejected by storage");
      }
      throw error;
    }
  }

  return Object.freeze({
    kind: "postgresql",
    async initialize() {
      try {
        if (pool === null) {
          const { Pool } = await import("pg");
          pool = new Pool({
            connectionString: dsn,
            max: 4,
            connectionTimeoutMillis: 5_000,
            idleTimeoutMillis: 30_000
          });
        }
        const result = await pool.query(SCHEMA_VERSION_SQL);
        if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
          throw new StoreUnavailableError(
            "matching journal store schema is missing or incompatible"
          );
        }
      } catch (error) {
        throw unavailable(error);
      }
    },
    /**
     * Records one emitted batch atomically. Resolves once the batch is
     * durable; rejects (and latches, so every later operation rethrows)
     * when storage fails or the batch is not the contiguous continuation.
     *
     * @param {readonly import("./events.mjs").MatchingEvent[]} events
     * @returns {Promise<void>}
     */
    append(events) {
      if (!Array.isArray(events)) {
        throw new TypeError("journal append requires an array of events");
      }
      if (failure !== null) {
        return Promise.reject(failure);
      }
      // Plain-data snapshot keeps the batch immutable while it queues:
      // a later mutation of the caller's array cannot rewrite history.
      const batch = /** @type {import("./events.mjs").MatchingEvent[]} */ (
        snapshotPlainData(events)
      );
      // The local half of the continuation rule the memory backend
      // enforces inline: seqs must be positive safe integers contiguous
      // inside the batch. The server-side half — the batch's first seq
      // must continue the recorded tail — stays in storage. A malformed
      // batch is a caller bug: it fails here synchronously as StoreError,
      // never queued, never latched, identical to the memory store.
      for (const [index, event] of batch.entries()) {
        const seq = event === null || typeof event !== "object" ? undefined : event.seq;
        if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
          throw new StoreError("journal append events must carry positive integer seq values");
        }
        const first = /** @type {number} */ (batch[0].seq);
        if (seq !== first + index) {
          throw new StoreError("journal append must continue the recorded stream contiguously");
        }
      }
      const write = tail.then(() => writeBatch(batch));
      tail = write.then(
        () => undefined,
        () => undefined
      );
      return write.catch((error) => {
        // StoreError rejections (caller bugs, deterministic storage-side
        // constraint violations) do not latch: only failures the store
        // cannot attribute to the batch itself poison durability.
        if (error instanceof StoreError) {
          throw error;
        }
        failure = unavailable(error);
        throw failure;
      });
    },
    /**
     * Waits out queued appends, then returns every recorded event in `seq`
     * order — the raw stream restore folds through `replayMatchingEngine`.
     *
     * @returns {Promise<readonly import("./events.mjs").MatchingEvent[]>}
     */
    async load() {
      await tail;
      if (failure !== null) {
        throw failure;
      }
      if (pool === null) {
        throw new StoreUnavailableError("matching journal store is not initialized");
      }
      try {
        const result = await pool.query(LOAD_SQL, [namespace]);
        return Object.freeze(
          result.rows.map((row) =>
            Object.freeze(/** @type {import("./events.mjs").MatchingEvent} */ (row.payload))
          )
        );
      } catch (error) {
        throw unavailable(error);
      }
    },
    async close() {
      await tail;
      const ending = pool;
      pool = null;
      await ending?.end();
      if (failure !== null) {
        throw failure;
      }
    }
  });
}
