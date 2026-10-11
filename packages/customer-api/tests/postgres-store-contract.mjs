import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import { createPostgresStore } from "../src/postgres-store.mjs";
import { StoreConfigError, StoreUnavailableError } from "../src/store.mjs";
import { registerStoreContract } from "./store-contract.mjs";

// PostgreSQL arm of the shared store contract. Deliberately NOT named
// `*.test.mjs`: it runs only where a dev database is reachable (via
// `tests/postgres-store.sh`), while `node --test tests/*.test.mjs` stays
// self-contained for environments without one. `CUSTOMER_API_STORE_DSN` is
// required — this arm fails hard, never skips.

const dsn = process.env.CUSTOMER_API_STORE_DSN;

const freshNamespace = () => `t_${crypto.randomUUID().replaceAll("-", "_")}`;

const consumeCommand = (overrides = {}) => ({
  key: `test_${crypto.randomUUID()}`,
  now: 1_000,
  windowMs: 60_000,
  limit: 1,
  maxKeys: 10,
  ...overrides
});

const connectAdmin = async () => {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  return client;
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      namespace: freshNamespace()
    });
    await store.initialize?.();
    return store;
  },
  makeRawStore: async () => {
    if (typeof dsn !== "string" || dsn.length === 0) {
      throw new Error("CUSTOMER_API_STORE_DSN is required for the postgres store contract");
    }
    return createPostgresStore({ dsn, namespace: freshNamespace() });
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

test("concurrent consumes of one key serialize on the bucket row", async (t) => {
  const store = createPostgresStore({ dsn, namespace: freshNamespace() });
  await store.initialize?.();
  t.after(() => store.close());
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      store.consumeRateLimit(consumeCommand({ key: "hot_key", limit: 3 }))
    )
  );
  assert.equal(results.filter(({ allowed }) => allowed).length, 3);
  assert.equal(results.filter(({ allowed }) => !allowed).length, 9);
});

test("consumes for distinct keys stay bounded under concurrency", async (t) => {
  const store = createPostgresStore({ dsn, namespace: freshNamespace() });
  await store.initialize?.();
  t.after(() => store.close());
  const maxKeys = 5;
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      store.consumeRateLimit(consumeCommand({ key: `burst_${index}`, maxKeys }))
    )
  );
  const allowed = results.filter(({ allowed }) => allowed).length;
  // A consume can only be denied once maxKeys live buckets have committed,
  // so at least that many races win; at most the pool's few clients can hold
  // a pre-bound snapshot in flight, so the overshoot stays small.
  assert.ok(allowed >= maxKeys, `expected at least ${maxKeys} allows, got ${allowed}`);
  assert.ok(allowed <= maxKeys + 4, `expected bounded overshoot, got ${allowed}`);
});

test("namespaces isolate buckets and the key bound from each other", async (t) => {
  const first = createPostgresStore({ dsn, namespace: freshNamespace() });
  const second = createPostgresStore({ dsn, namespace: freshNamespace() });
  await first.initialize?.();
  await second.initialize?.();
  t.after(() => first.close());
  t.after(() => second.close());
  // The first namespace fills its single-key bound; the second must not see
  // its rows, its counts or its fullness.
  assert.deepEqual(
    await first.consumeRateLimit(consumeCommand({ key: "shared_key", maxKeys: 1 })),
    { allowed: true }
  );
  assert.deepEqual(
    await first.consumeRateLimit(consumeCommand({ key: "other_key", maxKeys: 1 })),
    { allowed: false, retryAfterSeconds: 60 }
  );
  assert.deepEqual(
    await second.consumeRateLimit(consumeCommand({ key: "other_key", maxKeys: 1 })),
    { allowed: true }
  );
  // Same key as the first namespace consumed, same limit: if the second
  // namespace could see the first's count-1 bucket this consume would deny —
  // the fresh allowed proves the count stays per-namespace.
  assert.deepEqual(
    await second.consumeRateLimit(consumeCommand({ key: "shared_key", limit: 1, maxKeys: 10 })),
    { allowed: true }
  );
});

test("the store survives an idle pooled client being killed", async (t) => {
  const store = createPostgresStore({ dsn, namespace: freshNamespace() });
  await store.initialize?.();
  t.after(() => store.close());
  assert.deepEqual(await store.consumeRateLimit(consumeCommand()), { allowed: true });
  const admin = await connectAdmin();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity" +
        " WHERE datname = current_database() AND pid <> pg_backend_pid()"
    );
  } finally {
    await admin.end();
  }
  // A dead idle client surfaces as a pool 'error' event: with no listener
  // that is an uncaught EventEmitter error and takes the process down — the
  // kill above would already have ended this run. After it, a consume may
  // briefly meet the dead client, but the pool must heal itself.
  let healed;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      healed = await store.consumeRateLimit(consumeCommand({ key: "after_kill" }));
      if (healed.allowed === true) {
        break;
      }
    } catch (error) {
      assert.ok(error instanceof StoreUnavailableError);
    }
    await settle(100);
  }
  assert.deepEqual(healed, { allowed: true });
});

test("concurrent initialize calls share one pool and close releases every client", async (t) => {
  const store = createPostgresStore({ dsn, namespace: freshNamespace() });
  t.after(() => store.close().catch(() => undefined));
  await Promise.all([store.initialize?.(), store.initialize?.(), store.initialize?.()]);
  const admin = await connectAdmin();
  const connections = async () => {
    const result = await admin.query(
      "SELECT count(*) AS n FROM pg_stat_activity" +
        " WHERE datname = current_database() AND pid <> pg_backend_pid()"
    );
    return Number(result.rows[0].n);
  };
  try {
    assert.ok((await connections()) <= 4, "the pool cap must bound the store's clients");
    await store.close();
    // A second pool leaked by a racing initialize would linger here: after
    // close, every client the store ever opened must be gone.
    let remaining = -1;
    for (let attempt = 0; attempt < 30 && remaining !== 0; attempt += 1) {
      remaining = await connections();
      if (remaining !== 0) {
        await settle(100);
      }
    }
    assert.equal(remaining, 0);
  } finally {
    await admin.end();
  }
});

test("initialize rejects when the bucket table drifted away", async (t) => {
  const admin = await connectAdmin();
  try {
    await admin.query(
      "ALTER TABLE customer_api.rate_limit_buckets RENAME TO rate_limit_buckets_drifted"
    );
    const store = createPostgresStore({ dsn, namespace: freshNamespace() });
    t.after(() => store.close().catch(() => undefined));
    await assert.rejects(async () => store.initialize?.(), StoreUnavailableError);
    await assert.rejects(
      async () => store.consumeRateLimit(consumeCommand()),
      StoreUnavailableError
    );
  } finally {
    await admin
      .query(
        "ALTER TABLE customer_api.rate_limit_buckets_drifted RENAME TO rate_limit_buckets"
      )
      .catch(() => undefined);
    await admin.end();
  }
});

test("initialize rejects when the bucket primary key is dropped", async (t) => {
  const admin = await connectAdmin();
  try {
    // Without the (namespace, bucket_key) arbiter the consume's ON CONFLICT
    // loses its upsert semantics; startup must notice instead of the first
    // request finding out.
    await admin.query(
      "ALTER TABLE customer_api.rate_limit_buckets DROP CONSTRAINT rate_limit_buckets_pkey"
    );
    const store = createPostgresStore({ dsn, namespace: freshNamespace() });
    t.after(() => store.close().catch(() => undefined));
    await assert.rejects(async () => store.initialize?.(), StoreUnavailableError);
  } finally {
    await admin
      .query(
        "ALTER TABLE customer_api.rate_limit_buckets ADD PRIMARY KEY (namespace, bucket_key)"
      )
      .catch(() => undefined);
    await admin.end();
  }
});

test("initialize rejects a drifted migration history row", async (t) => {
  const admin = await connectAdmin();
  try {
    await admin.query(
      "ALTER TABLE customer_api.schema_migrations" +
        " DISABLE TRIGGER schema_migrations_validate_sequence"
    );
    await admin.query(
      "ALTER TABLE customer_api.schema_migrations" +
        " DISABLE TRIGGER schema_migrations_append_only"
    );
    await admin.query(
      "INSERT INTO customer_api.schema_migrations (version, migration_name)" +
        " VALUES (2, '0002_drifted_probe')"
    );
    const store = createPostgresStore({ dsn, namespace: freshNamespace() });
    t.after(() => store.close().catch(() => undefined));
    await assert.rejects(async () => store.initialize?.(), StoreUnavailableError);
  } finally {
    await admin
      .query("DELETE FROM customer_api.schema_migrations WHERE version = 2")
      .catch(() => undefined);
    await admin
      .query(
        "ALTER TABLE customer_api.schema_migrations" +
          " ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence"
      )
      .catch(() => undefined);
    await admin
      .query(
        "ALTER TABLE customer_api.schema_migrations" +
          " ENABLE ALWAYS TRIGGER schema_migrations_append_only"
      )
      .catch(() => undefined);
    await admin.end();
  }
});
