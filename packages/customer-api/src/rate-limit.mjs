/** @typedef {{ allowed: true } | { allowed: false, retryAfterSeconds: number }} RateLimitResult */
/**
 * @typedef {object} RateLimitConsumeCommand
 * @property {string} key
 * @property {number} now Epoch milliseconds from the caller's clock.
 * @property {number} windowMs
 * @property {number} limit
 * @property {number} maxKeys
 */
/** @typedef {RateLimitResult | Promise<RateLimitResult>} RateLimitOutcome */
/** @typedef {{ consume(key: string): RateLimitOutcome }} RateLimiter */

/**
 * The shared fixed-window consume: every implementation of the store seam
 * must answer exactly what this function answers against the same bucket map.
 *
 * @param {Map<string, { count: number, resetAt: number }>} buckets
 * @param {RateLimitConsumeCommand} command
 * @returns {RateLimitResult}
 */
export function consumeFixedWindowBucket(buckets, { key, now, windowMs, limit, maxKeys }) {
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (!bucket && buckets.size >= maxKeys) {
      for (const [other, entry] of buckets) {
        if (now >= entry.resetAt) {
          buckets.delete(other);
        }
      }
      if (buckets.size >= maxKeys) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
    }
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }
  return { allowed: true };
}

/**
 * @param {{ limit: number, windowMs?: number, clock?: () => number, maxKeys?: number }} options
 * @returns {RateLimiter}
 */
export function createFixedWindowRateLimiter({
  limit,
  windowMs = 60_000,
  clock = () => Date.now(),
  maxKeys = 10_000
}) {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Rate limit must be a positive integer");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate-limit window must be a positive integer");
  }
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) {
    throw new Error("Rate-limit key bound must be a positive integer");
  }
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map();

  return Object.freeze({
    consume(key) {
      const now = clock();
      // A non-finite clock would leave a bucket with a NaN resetAt that never
      // expires and answers retry-after: NaN; deny the request instead.
      if (!Number.isFinite(now)) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      return consumeFixedWindowBucket(buckets, { key, now, windowMs, limit, maxKeys });
    }
  });
}

/**
 * A rate limiter backed by the store seam: the store answers the same
 * fixed-window decision asynchronously, so a durable backend can replace the
 * in-memory map without changing request handling.
 *
 * @param {{
 *   store: import("./store.mjs").CustomerApiStore,
 *   limit: number,
 *   windowMs?: number,
 *   clock?: () => number,
 *   maxKeys?: number
 * }} options
 * @returns {RateLimiter}
 */
export function createStoredRateLimiter({
  store,
  limit,
  windowMs = 60_000,
  clock = () => Date.now(),
  maxKeys = 10_000
}) {
  if (typeof store?.consumeRateLimit !== "function") {
    throw new Error("A rate-limit store is required");
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Rate limit must be a positive integer");
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate-limit window must be a positive integer");
  }
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) {
    throw new Error("Rate-limit key bound must be a positive integer");
  }
  return Object.freeze({
    async consume(key) {
      const now = clock();
      if (!Number.isFinite(now)) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      return store.consumeRateLimit({ key, now, windowMs, limit, maxKeys });
    }
  });
}
