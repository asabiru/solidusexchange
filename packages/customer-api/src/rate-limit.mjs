/** @typedef {{ allowed: true } | { allowed: false, retryAfterSeconds: number }} RateLimitResult */
/** @typedef {{ consume(key: string): RateLimitResult }} RateLimiter */

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

  /** @param {number} now */
  function prune(now) {
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) {
        buckets.delete(key);
      }
    }
  }

  return Object.freeze({
    consume(key) {
      const now = clock();
      // A non-finite clock would leave a bucket with a NaN resetAt that never
      // expires and answers retry-after: NaN; deny the request instead.
      if (!Number.isFinite(now)) {
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      }
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        if (!bucket && buckets.size >= maxKeys) {
          prune(now);
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
  });
}
