// Dev-only persistence seam for the matching engine's journal. The journal
// is the package's append-only record of emitted events — pure data with
// `posting: "none"`, never ledger postings, balances, settlement or any
// money movement. The seam persists exactly that event stream: nothing
// else in this package is mutable state worth persisting.
//
// A `MatchingJournalStore` is selected once at startup: the memory backend
// reproduces today's in-process behavior exactly (the engine journal is an
// in-memory array), and the `postgres` backend survives restarts through
// `migrations/0001_matching_journal.sql`. Environment selection
// (`MATCHING_CORE_STORE` / `MATCHING_CORE_STORE_DSN`) resolves fail closed
// via `resolveJournalStoreEnv`: unset means memory, an unknown kind or an
// invalid/missing DSN throws at startup rather than silently degrading.
//
// Restore never bypasses the single validation pipeline: `store.load()`
// returns raw recorded events, and the only engine-facing path —
// `replayMatchingJournalStore`, which folds the loaded stream through
// `replayMatchingEngine` — re-validates every event. A corrupted or
// hostile row fails at restore and never reaches an engine.
//
// Dev-only: the seam never holds ledger postings, custody material or
// credentials, and no production path reads it.

/**
 * @typedef {import("./events.mjs").MatchingEvent} MatchingEvent
 */

/**
 * @typedef {object} MatchingJournalStore
 * @property {string} kind Backend identity for observability (`memory` or `postgresql`).
 * @property {() => Promise<void>} [initialize]
 *   Startup probe run before the store serves traffic; a backend that
 *   cannot reach or recognize its schema must reject so startup fails fast.
 * @property {(events: readonly MatchingEvent[]) => void | Promise<void>} append
 *   Atomically record one emitted batch — every event an operation
 *   produced, in order. The batch must continue the recorded stream
 *   contiguously: the first `seq` must be the recorded length plus one and
 *   the rest must follow with no gaps, so a call either lands whole or
 *   fails. The memory backend appends synchronously; durable backends may
 *   return a promise settling once the batch is written — callers that
 *   cannot await treat the store's next awaited operation (`load`, a later
 *   `append`, `close`) as the durability boundary, because a backend
 *   latches its first write failure and every later operation rethrows it.
 * @property {() => Promise<readonly MatchingEvent[]>} load
 *   Every recorded event in `seq` order — the raw stream restore folds
 *   through `replayMatchingEngine` before it reaches an engine.
 * @property {() => Promise<void>} close
 */

/** Base error for journal store failures; never carries the DSN or credentials. */
export class StoreError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "StoreError";
  }
}

/** The configured backend cannot be reached or is missing its schema. */
export class StoreUnavailableError extends StoreError {
  /** @param {string} [message] */
  constructor(message = "matching journal store is unavailable") {
    super(message);
    this.name = "StoreUnavailableError";
  }
}

/** The store configuration itself is malformed. */
export class StoreConfigError extends StoreError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "StoreConfigError";
  }
}

/**
 * Validates a `journalStore` option once at engine assembly: the seam is
 * structural (`kind` plus `append`/`load`/`close`, `initialize` optional),
 * so a malformed backend fails fast at creation rather than mid-operation.
 *
 * @param {unknown} candidate
 * @returns {MatchingJournalStore}
 */
export function validJournalStore(candidate) {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof (/** @type {MatchingJournalStore} */ (candidate).kind) !== "string" ||
    typeof (/** @type {MatchingJournalStore} */ (candidate).append) !== "function" ||
    typeof (/** @type {MatchingJournalStore} */ (candidate).load) !== "function" ||
    typeof (/** @type {MatchingJournalStore} */ (candidate).close) !== "function" ||
    ((/** @type {MatchingJournalStore} */ (candidate).initialize) !== undefined &&
      typeof (/** @type {MatchingJournalStore} */ (candidate).initialize) !== "function")
  ) {
    throw new TypeError("journal store must be an object with kind, append, load and close");
  }
  return /** @type {MatchingJournalStore} */ (candidate);
}

/**
 * The default backend: today's in-process journal behind the seam. Appends
 * are synchronous and enforce the same contiguous-continuation rule the
 * durable backends enforce in storage, so a caller bug fails identically
 * on every backend.
 *
 * @returns {MatchingJournalStore}
 */
export function createMemoryJournalStore() {
  /** @type {MatchingEvent[]} */
  const events = [];
  return Object.freeze({
    kind: "memory",
    async initialize() {},
    /** @param {readonly MatchingEvent[]} batch */
    append(batch) {
      if (!Array.isArray(batch)) {
        throw new TypeError("journal append requires an array of events");
      }
      for (const [index, event] of batch.entries()) {
        const seq = event === null || typeof event !== "object" ? undefined : event.seq;
        if (seq !== events.length + index + 1) {
          throw new StoreError(
            `journal append must continue the recorded stream at seq ${events.length + index + 1}`,
          );
        }
      }
      events.push(...batch);
    },
    async load() {
      return Object.freeze(events.slice());
    },
    async close() {},
  });
}

/**
 * Resolves the environment's store selection, fail closed. Unset or
 * `"memory"` selects the in-process backend; `"postgres"` requires a valid
 * PostgreSQL DSN. An unknown kind, a missing/invalid DSN, or a DSN without
 * postgres mode throws `StoreConfigError` — a misconfigured deployment can
 * never silently fall back to memory.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ mode: "memory" | "postgres", dsn: string | null }}
 */
export function resolveJournalStoreEnv(env) {
  const configured = env.MATCHING_CORE_STORE;
  if (configured !== undefined && typeof configured !== "string") {
    throw new StoreConfigError('MATCHING_CORE_STORE must be unset, "memory" or "postgres"');
  }
  const mode = configured ?? "memory";
  if (mode !== "memory" && mode !== "postgres") {
    throw new StoreConfigError('MATCHING_CORE_STORE must be unset, "memory" or "postgres"');
  }
  const dsn = env.MATCHING_CORE_STORE_DSN;
  if (mode !== "postgres") {
    if (dsn !== undefined) {
      throw new StoreConfigError("MATCHING_CORE_STORE_DSN requires MATCHING_CORE_STORE=postgres");
    }
    return Object.freeze({ mode: "memory", dsn: null });
  }
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new StoreConfigError("MATCHING_CORE_STORE_DSN is required when MATCHING_CORE_STORE=postgres");
  }
  let url;
  try {
    url = new URL(dsn);
  } catch {
    throw new StoreConfigError("MATCHING_CORE_STORE_DSN must be a valid PostgreSQL connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new StoreConfigError("MATCHING_CORE_STORE_DSN must be a valid PostgreSQL connection URL");
  }
  return Object.freeze({ mode: "postgres", dsn });
}
