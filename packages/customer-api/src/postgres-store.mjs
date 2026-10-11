import { Pool } from "pg";

import { StoreConfigError, StoreUnavailableError } from "./store.mjs";

// PostgreSQL backend for the customer-api store seam (`CUSTOMER_API_STORE=
// postgres`, DSN via `CUSTOMER_API_STORE_DSN`). Dev-only groundwork so the
// rate-limit control state can survive restarts; the schema it requires is
// `migrations/0001_customer_api_store.sql`, applied through the package's
// `verify:migrations`-governed source catalog. The store speaks only to the
// `customer_api` schema and only for its own tables.
//
// The fixed-window consume runs as one CTE statement so concurrent consumes
// stay atomic without a client-managed transaction:
//   - `prior` sees the key's bucket (live or expired) as of statement start;
//   - `expired` physically prunes OTHER keys' dead buckets (the key's own
//     expired row is kept so the upsert below can reset it — deleting it
//     would hide `prior`, not help it);
//   - `occupancy` counts LIVE buckets, matching the memory backend's
//     prune-then-size bound;
//   - `write` inserts a fresh bucket only when the key has no bucket and the
//     table is not full of live buckets, and otherwise resolves the row
//     through ON CONFLICT: an expired bucket restarts the window, a live one
//     increments.
// Clock semantics never come from the database: `now` is the caller's
// injected clock, exactly like the memory backend.

const schemaVersion = 1;

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
expired AS (
  DELETE FROM customer_api.rate_limit_buckets
   WHERE namespace = $5
     AND reset_at_ms <= $2
     AND bucket_key <> $1
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

/** @param {unknown} error */
function unavailable(error) {
  return error instanceof StoreUnavailableError
    ? error
    : new StoreUnavailableError();
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
  const pool = new Pool({
    connectionString: dsn,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  });

  return Object.freeze({
    kind: "postgresql",
    async initialize() {
      try {
        const result = await pool.query(SCHEMA_VERSION_SQL);
        if (result.rows.length !== 1 || result.rows[0].version !== schemaVersion) {
          throw new StoreUnavailableError(
            "customer-api store schema is missing or incompatible"
          );
        }
      } catch (error) {
        throw unavailable(error);
      }
    },
    /**
     * @param {import("./rate-limit.mjs").RateLimitConsumeCommand} command
     * @returns {Promise<import("./rate-limit.mjs").RateLimitResult>}
     */
    async consumeRateLimit({ key, now, windowMs, limit, maxKeys }) {
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
      await pool.end();
    }
  });
}
