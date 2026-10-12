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
 *   contiguously — or re-deliver an already-recorded identical prefix:
 *   idempotent redelivery makes a retry after a lost or timed-out response
 *   safe, while a re-delivered `seq` carrying a conflicting event rejects.
 *   The memory backend appends synchronously and throws contract
 *   violations inline; durable backends may return a promise settling once
 *   the batch is written — callers that cannot await treat the store's
 *   next awaited operation (`load`, a later `append`, `close`) as the
 *   durability boundary, because a backend latches its first settled write
 *   failure and every later operation rethrows it. On the postgres backend
 *   the latched failure also throws synchronously from the next `append`,
 *   so an engine operation surfaces it loudly instead of continuing in
 *   memory-only silence.
 * @property {() => Promise<readonly MatchingEvent[]>} load
 *   Every recorded event in `seq` order — the raw stream restore folds
 *   through `replayMatchingEngine` before it reaches an engine.
 * @property {(seq: number) => Promise<readonly MatchingEvent[]>} [loadAfter]
 *   The recorded events with `seq` strictly greater than the argument, in
 *   `seq` order — the bounded tail read a snapshot+tail restore issues:
 *   `loadAfter(N)` serves `journal[N+1..M]` without reading the prefix.
 *   Optional like `initialize`: a backend that cannot slice omits it and
 *   `replayMatchingJournalStore` falls back to a `load()` filtered to the
 *   same tail — the fold re-validates either way.
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
      typeof (/** @type {MatchingJournalStore} */ (candidate).initialize) !== "function") ||
    ((/** @type {MatchingJournalStore} */ (candidate).loadAfter) !== undefined &&
      typeof (/** @type {MatchingJournalStore} */ (candidate).loadAfter) !== "function")
  ) {
    throw new TypeError("journal store must be an object with kind, append, load and close");
  }
  return /** @type {MatchingJournalStore} */ (candidate);
}

/**
 * Canonical-JSON comparison for the redelivery rule: two events are the
 * same recorded fact when their serialized documents are equal once key
 * order and `undefined`-valued keys are normalized — the same equality
 * jsonb applies to stored payloads on the postgres backend.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const candidate = /** @type {Record<string, unknown>} */ (value);
  const members = Object.keys(candidate)
    .filter((key) => candidate[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`);
  return `{${members.join(",")}}`;
}

/**
 * The default backend: today's in-process journal behind the seam. Appends
 * are synchronous and enforce the same continuation/redelivery rules the
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
      let first = 0;
      for (const [index, event] of batch.entries()) {
        const seq = event === null || typeof event !== "object" ? undefined : event.seq;
        if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
          throw new StoreError("journal append events must carry positive integer seq values");
        }
        if (index === 0) {
          first = seq;
        } else if (seq !== first + index) {
          throw new StoreError("journal append must continue the recorded stream contiguously");
        }
      }
      // Overlap with the recorded stream is a redelivery: every overlapping
      // event must equal the recorded one — identical replays land nothing,
      // conflicting ones are rejected.
      const overlap = Math.min(batch.length, Math.max(0, events.length - first + 1));
      for (let index = 0; index < overlap; index += 1) {
        if (canonicalJson(events[first + index - 1]) !== canonicalJson(batch[index])) {
          throw new StoreError(
            `journal append conflicts with the recorded stream at seq ${first + index}`,
          );
        }
      }
      if (first > events.length + 1) {
        throw new StoreError(
          `journal append must continue the recorded stream at seq ${events.length + 1}`,
        );
      }
      events.push(...batch.slice(overlap));
    },
    async load() {
      return Object.freeze(events.slice());
    },
    /**
     * Recorded events with `seq` strictly above the argument — the tail a
     * snapshot+tail restore folds onto the snapshot.
     *
     * @param {number} seq
     */
    async loadAfter(seq) {
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
        throw new StoreError("journal loadAfter requires a non-negative integer seq");
      }
      return Object.freeze(events.filter((event) => event.seq > seq));
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
