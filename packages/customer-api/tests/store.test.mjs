import assert from "node:assert/strict";
import test from "node:test";

import { createStoredRateLimiter } from "../src/rate-limit.mjs";
import { createMemoryStore } from "../src/store.mjs";
import { registerStoreContract } from "./store-contract.mjs";

registerStoreContract({
  name: "memory store",
  makeStore: async () => {
    const store = createMemoryStore();
    await store.initialize?.();
    return store;
  }
});

test("the memory store identifies itself and lifecycle-hooks cleanly", async () => {
  const store = createMemoryStore();
  assert.equal(store.kind, "memory");
  await store.initialize?.();
  await store.close();
});

test("a stored rate limiter delegates the consume to the backend", async () => {
  const store = createMemoryStore();
  const calls = [];
  const recorder = {
    kind: "memory",
    consumeRateLimit(command) {
      calls.push(command);
      return store.consumeRateLimit(command);
    },
    async close() {}
  };
  const limiter = createStoredRateLimiter({ store: recorder, limit: 2, clock: () => 5_000 });
  assert.deepEqual(await limiter.consume("k"), { allowed: true });
  assert.deepEqual(await limiter.consume("k"), { allowed: true });
  assert.deepEqual(await limiter.consume("k"), { allowed: false, retryAfterSeconds: 60 });
  assert.deepEqual(calls.map(({ key, now, limit, windowMs, maxKeys }) => [key, now, limit, windowMs, maxKeys]), [
    ["k", 5_000, 2, 60_000, 10_000],
    ["k", 5_000, 2, 60_000, 10_000],
    ["k", 5_000, 2, 60_000, 10_000]
  ]);
});

test("a stored rate limiter denies on a non-finite clock without touching the backend", async () => {
  let calls = 0;
  const limiter = createStoredRateLimiter({
    store: {
      kind: "memory",
      consumeRateLimit() {
        calls += 1;
        return { allowed: true };
      },
      async close() {}
    },
    limit: 1,
    clock: () => Number.NaN
  });
  assert.deepEqual(await limiter.consume("k"), { allowed: false, retryAfterSeconds: 60 });
  assert.equal(calls, 0);
});

test("a stored rate limiter requires a backend and valid bounds", async () => {
  assert.throws(() => createStoredRateLimiter({ limit: 1 }), /store/u);
  assert.throws(() => createStoredRateLimiter({ store: {}, limit: 1 }), /store/u);
  const store = createMemoryStore();
  assert.throws(() => createStoredRateLimiter({ store, limit: 0 }), /limit/u);
  assert.throws(() => createStoredRateLimiter({ store, limit: 1, windowMs: 0 }), /window/u);
  assert.throws(() => createStoredRateLimiter({ store, limit: 1, maxKeys: 0 }), /key/u);
  await store.close();
});
