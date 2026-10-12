import { StoreConfigError, StoreError, StoreUnavailableError } from "./journal-store.mjs";
import { snapshotPlainData } from "./snapshot.mjs";

// PostgreSQL backend for the matching journal seam (`MATCHING_CORE_STORE=
// postgres`, DSN via `MATCHING_CORE_STORE_DSN`). Dev-only groundwork so the
// engine's append-only event journal can survive restarts; the schema it
// requires is `migrations/0001_matching_journal.sql` plus
// `migrations/0002_journal_event_grammar.sql`, applied through the
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
// the whole emitted batch in a single advisory-locked step, deduplicates
// an identical redelivery, enforces contiguous `seq` continuation in
// storage, and inserts atomically — so a batch either lands whole or not
// at all. Calls serialize through an internal tail so journal order never
// depends on pool scheduling.
//
// Failure semantics: ANY settled rejection of a queued write latches the
// store — a storage-side seq conflict means the recorded stream and the
// caller's stream have already diverged, and the engine's fire-and-forget
// append cannot hear a rejection, so every later `append`, `load` and
// `close` rethrows the failure (fail closed, never silently degrade to
// in-memory only). The latched failure also throws SYNCHRONOUSLY from
// `append`: an engine's `finish` propagates it to the operation's caller,
// which is the loudest surface a swallowed promise cannot provide.
//
// No write may hang: `connectionTimeoutMillis` bounds pool-acquire waits,
// `lock_timeout` bounds a blocked statement (e.g. another session holding
// the namespace advisory lock), and `query_timeout` bounds the client-side
// wait for a dead or blackholed server.
//
// The DSN (user, password, host) is connection material: it is never
// logged, and failure paths surface only StoreUnavailableError.

const schemaVersion = 2;

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
  const connectionString = /** @type {string} */ (dsn);
  /** @type {import("pg").Pool | null} */
  let pool = null;
  /** Queued writes, in issue order; resolves after every prior write settles. */
  let tail = Promise.resolve();
  /** First settled write failure; every later operation rethrows it. */
  /** @type {StoreUnavailableError | null} */
  let failure = null;
  /** Set once initialize() has verified the schema; cleared by close(). */
  let ready = false;
  /** Set by close() so an in-flight initialize() cannot revive the store. */
  let closed = false;
  /** @type {Promise<void> | null} */
  let initializing = null;

  /**
   * @param {readonly import("./events.mjs").MatchingEvent[]} batch
   */
  async function writeBatch(batch) {
    if (pool === null) {
      throw new StoreUnavailableError("matching journal store is not initialized");
    }
    await pool.query(APPEND_SQL, [namespace, JSON.stringify(batch)]);
  }

  async function initializeOnce() {
    try {
      const { Pool } = await import("pg");
      const created = new Pool({
        connectionString,
        max: 4,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // A statement blocked on a lock (the per-namespace advisory lock
        // inside append_matching_journal) fails after 5s instead of
        // hanging the serialized tail — every later op waits on that tail.
        lock_timeout: 5_000,
        // Client-side bound covering a dead or blackholed server mid-query;
        // server-side lock_timeout produces the cleaner lock error first.
        query_timeout: 15_000,
      });
      pool = created;
      const result = await created.query(SCHEMA_VERSION_SQL);
      if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
        throw new StoreUnavailableError(
          "matching journal store schema is missing or incompatible"
        );
      }
      if (closed) {
        await created.end().catch(() => undefined);
        pool = null;
        throw new StoreUnavailableError(
          "matching journal store was closed during initialize"
        );
      }
      ready = true;
    } catch (error) {
      throw unavailable(error);
    }
  }

  return Object.freeze({
    kind: "postgresql",
    /**
     * Single-flight startup probe: concurrent callers share one pool and
     * one schema check — a second pool would leak if both raced.
     *
     * @returns {Promise<void>}
     */
    initialize() {
      if (initializing === null) {
        initializing = initializeOnce();
      }
      return initializing;
    },
    /**
     * Records one emitted batch atomically. Resolves once the batch is
     * durable; rejects — and latches, so every later operation surfaces the
     * same failure — when storage fails or the batch is not the contiguous
     * continuation or an identical redelivery. Throws synchronously when
     * the store is already latched or not initialized, so a caller that
     * cannot await still hears durability loss at the call site.
     *
     * @param {readonly import("./events.mjs").MatchingEvent[]} events
     * @returns {Promise<void>}
     */
    append(events) {
      if (!Array.isArray(events)) {
        throw new TypeError("journal append requires an array of events");
      }
      if (failure !== null) {
        throw failure;
      }
      if (!ready) {
        throw new StoreUnavailableError(
          "matching journal store is not initialized or is already closed"
        );
      }
      // Plain-data snapshot keeps the batch immutable while it queues:
      // a later mutation of the caller's array cannot rewrite history.
      const batch = /** @type {import("./events.mjs").MatchingEvent[]} */ (
        snapshotPlainData(events)
      );
      // The local half of the continuation rule the memory backend
      // enforces inline: seqs must be positive safe integers contiguous
      // inside the batch. The durable half — the batch's first seq must
      // continue the recorded tail or identically replay it — stays in
      // storage. A malformed batch is a caller bug: it fails here
      // synchronously as StoreError, never queued, never latched,
      // identical to the memory store.
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
        // Every settled rejection latches: a storage-side constraint
        // rejection means the recorded stream and this writer already
        // disagree about history — a divergence the engine's
        // fire-and-forget append cannot observe — and any other failure
        // means durability is lost outright.
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
      if (pool === null || !ready) {
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
      closed = true;
      await tail;
      const ending = pool;
      pool = null;
      ready = false;
      await ending?.end();
      if (failure !== null) {
        throw failure;
      }
    }
  });
}
