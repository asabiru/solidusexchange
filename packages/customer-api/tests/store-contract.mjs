import assert from "node:assert/strict";
import test from "node:test";

// Shared store-backend contract: the same suite runs against the memory and
// PostgreSQL backends so both honor identical consume semantics. Each case
// builds its store through `makeStore` and closes it through `t.after`, so a
// backend may hold real connections (the PostgreSQL pool) without leaking.

/**
 * @param {{
 *   name: string,
 *   makeStore: () => Promise<import("../src/store.mjs").CustomerApiStore>,
 *   freshKey?: () => string
 * }} options
 */
export function registerStoreContract({ name, makeStore, freshKey = () => `key_${counter++}` }) {
  const command = (overrides = {}) => ({
    key: freshKey(),
    now: 1_000,
    windowMs: 60_000,
    limit: 3,
    maxKeys: 10,
    ...overrides
  });

  test(`${name}: a fresh key consumes within the limit`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    assert.deepEqual(await store.consumeRateLimit(command()), { allowed: true });
  });

  test(`${name}: consuming past the limit denies with a retry hint`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const key = freshKey();
    for (const expected of [{ allowed: true }, { allowed: true }, { allowed: true }]) {
      assert.deepEqual(
        await store.consumeRateLimit(command({ key, limit: 3 })),
        expected
      );
    }
    assert.deepEqual(await store.consumeRateLimit(command({ key, limit: 3 })), {
      allowed: false,
      retryAfterSeconds: 60
    });
  });

  test(`${name}: an expired bucket restarts the window`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const key = freshKey();
    for (let index = 0; index < 4; index += 1) {
      await store.consumeRateLimit(command({ key, limit: 2 }));
    }
    assert.deepEqual(await store.consumeRateLimit(command({ key, now: 61_000, limit: 2 })), {
      allowed: true
    });
  });

  test(`${name}: the retry hint shrinks with the remaining window`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    const key = freshKey();
    for (let index = 0; index < 4; index += 1) {
      await store.consumeRateLimit(command({ key, now: 30_000, limit: 3 }));
    }
    assert.deepEqual(
      await store.consumeRateLimit(command({ key, now: 40_000, limit: 3 })),
      { allowed: false, retryAfterSeconds: 50 }
    );
  });

  test(`${name}: a table full of live buckets denies a new key`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    for (const key of ["full_a", "full_b"]) {
      assert.deepEqual(
        await store.consumeRateLimit(command({ key, maxKeys: 2 })),
        { allowed: true }
      );
    }
    assert.deepEqual(
      await store.consumeRateLimit(command({ key: "full_c", maxKeys: 2 })),
      { allowed: false, retryAfterSeconds: 60 }
    );
  });

  test(`${name}: expired buckets do not count toward the key bound`, async (t) => {
    const store = await makeStore();
    t.after(() => store.close());
    for (const key of ["aged_a", "aged_b"]) {
      await store.consumeRateLimit(command({ key, now: 1_000, maxKeys: 2 }));
    }
    // Both prior buckets expired before this consume: the bound must be
    // evaluated against live buckets only, so the new key fits again.
    assert.deepEqual(
      await store.consumeRateLimit(command({ key: "aged_c", now: 61_000, maxKeys: 2 })),
      { allowed: true }
    );
  });
}

let counter = 0;
