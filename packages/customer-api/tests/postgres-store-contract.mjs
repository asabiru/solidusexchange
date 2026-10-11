import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresStore } from "../src/postgres-store.mjs";
import { StoreConfigError, StoreUnavailableError } from "../src/store.mjs";
import { registerStoreContract } from "./store-contract.mjs";

// PostgreSQL arm of the shared store contract. Deliberately NOT named
// `*.test.mjs`: it runs only where a dev database is reachable (via
// `tests/postgres-store.sh`), while `node --test tests/*.test.mjs` stays
// self-contained for environments without one. `CUSTOMER_API_STORE_DSN` is
// required — this arm fails hard, never skips.

const dsn = process.env.CUSTOMER_API_STORE_DSN;

registerStoreContract({
  name: "postgres store",
  makeStore: async () => {
    if (typeof dsn !== "string" || dsn.length === 0) {
      throw new Error("CUSTOMER_API_STORE_DSN is required for the postgres store contract");
    }
    // A per-test namespace gives each case the empty bucket table the
    // contract assumes, exactly like a fresh memory map.
    const store = createPostgresStore({
      dsn,
      namespace: `t_${crypto.randomUUID().replaceAll("-", "_")}`
    });
    await store.initialize?.();
    return store;
  },
  freshKey: () => `test_${crypto.randomUUID()}`
});

test("the postgres store rejects malformed DSNs at construction", () => {
  for (const value of [undefined, null, "", "not a url", "mysql://127.0.0.1/db", "http://127.0.0.1/db"]) {
    assert.throws(() => createPostgresStore({ dsn: value }), StoreConfigError, String(value));
  }
});

test("a fresh store instance sees the buckets its namespace accumulated", async () => {
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new Error("CUSTOMER_API_STORE_DSN is required for the postgres store contract");
  }
  const namespace = `t_${crypto.randomUUID().replaceAll("-", "_")}`;
  const first = createPostgresStore({ dsn, namespace });
  await first.initialize?.();
  const key = `test_${crypto.randomUUID()}`;
  const consume = { key, now: 1_000, windowMs: 60_000, limit: 1, maxKeys: 10 };
  assert.deepEqual(await first.consumeRateLimit(consume), { allowed: true });
  await first.close();
  // A new backend instance over the same namespace is what a server restart
  // looks like: the deny decision must survive it.
  const second = createPostgresStore({ dsn, namespace });
  await second.initialize?.();
  assert.deepEqual(await second.consumeRateLimit(consume), {
    allowed: false,
    retryAfterSeconds: 60
  });
  await second.close();
});

test("the postgres store validates its namespace", () => {
  for (const namespace of ["", "UPPER", "has space", "x".repeat(65)]) {
    assert.throws(
      () => createPostgresStore({ dsn, namespace }),
      StoreConfigError,
      String(namespace)
    );
  }
});

test("the postgres store fails closed when the database is unreachable", async () => {
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new Error("CUSTOMER_API_STORE_DSN is required for the postgres store contract");
  }
  const store = createPostgresStore({
    dsn: "postgres://customer_api:customer_api_dev@127.0.0.1:1/postgres"
  });
  await assert.rejects(() => store.initialize?.(), StoreUnavailableError);
  await assert.rejects(
    () =>
      store.consumeRateLimit({
        key: "unreachable",
        now: 1_000,
        windowMs: 60_000,
        limit: 1,
        maxKeys: 10
      }),
    StoreUnavailableError
  );
  await store.close();
});
