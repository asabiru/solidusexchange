import { consumeFixedWindowBucket } from "./rate-limit.mjs";

// Dev-only persistence seam for the customer-api's mutable control state.
// The only state worth persisting today is the fixed-window rate-limit
// buckets: a restart currently resets every per-peer counter and weakens the
// throttle. Everything else in this package is deliberately out of scope —
// the synthetic directories are deterministic `viewFor`/`listFor`/`statusFor`
// derivations that regenerate identically (their Map members are memoization
// caches, not state), the token verifier is stateless HMAC, and the metrics
// counters are observability data that Prometheus semantics expect to reset
// on restart. The seam stays narrow on purpose: it persists exactly what was
// already mutable, nothing the contract promises to be reproducible.
//
// A `CustomerApiStore` is selected once at startup via `loadConfig`
// (`CUSTOMER_API_STORE`): the memory backend reproduces today's behavior and
// the `postgres` backend survives restarts. `consumeRateLimit` is the atomic
// read-modify-write of one fixed-window bucket — backends implement it as a
// single unit because splitting it into get/set would race under concurrent
// consumes.
//
// Dev-only: the seam never holds money movement, ledger postings, custody
// material or credentials, and no production path reads it.

/**
 * @typedef {import("./rate-limit.mjs").RateLimitResult} RateLimitResult
 * @typedef {import("./rate-limit.mjs").RateLimitConsumeCommand} RateLimitConsumeCommand
 * @typedef {import("./rate-limit.mjs").RateLimitOutcome} RateLimitOutcome
 */

/**
 * @typedef {object} CustomerApiStore
 * @property {string} kind Backend identity for observability (`memory` or `postgresql`).
 * @property {() => Promise<void>} [initialize]
 *   Startup probe run before the server listens; a backend that cannot reach
 *   or recognize its schema must reject so startup fails fast.
 * @property {(command: RateLimitConsumeCommand) => RateLimitOutcome} consumeRateLimit
 *   Atomically consume one request against the key's fixed-window bucket:
 *   create or reset the bucket when `now` is at or past `resetAt`, increment
 *   the count otherwise, deny when the count exceeds `limit` (or when a new
 *   bucket would exceed `maxKeys` live buckets). `now` always comes from the
 *   caller's clock — never the backend's wall clock.
 * @property {() => Promise<void>} close
 */

/** Base error for store failures; never carries the DSN or credentials. */
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
  constructor(message = "customer-api store is unavailable") {
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
 * The default backend: today's in-process bucket map behind the seam. The
 * consume is synchronous and identical to `createFixedWindowRateLimiter`.
 *
 * @returns {CustomerApiStore}
 */
export function createMemoryStore() {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();
  return Object.freeze({
    kind: "memory",
    async initialize() {},
    consumeRateLimit(command) {
      return consumeFixedWindowBucket(buckets, command);
    },
    async close() {}
  });
}
