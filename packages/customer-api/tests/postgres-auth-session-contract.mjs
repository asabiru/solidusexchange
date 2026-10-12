import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import { createPostgresAuthSessionStore } from "../src/postgres-store.mjs";
import { StoreConfigError, StoreUnavailableError } from "../src/store.mjs";
import { registerAuthSessionStoreContract } from "./auth-session-store-contract.mjs";

// PostgreSQL arm of the shared auth-session-store contract. Deliberately
// NOT named `*.test.mjs`: it runs only where a dev database is reachable
// (via `tests/postgres-store.sh`), while `node --test tests/*.test.mjs`
// stays self-contained for environments without one.
// `CUSTOMER_API_STORE_DSN` is required — this arm fails hard, never skips.

const dsn = process.env.CUSTOMER_API_STORE_DSN;

const requireDsn = () => {
  if (typeof dsn !== "string" || dsn.length === 0) {
    throw new Error("CUSTOMER_API_STORE_DSN is required for the postgres auth session contract");
  }
};

// A unique subject per test gives each case the empty table slice the
// contract assumes, exactly like a fresh memory map — and survives reruns
// on a persistent dev database.
const freshSubject = () => `syn_cust_${crypto.randomUUID().replaceAll("-", "")}`;

const freshSessionId = () => `sess_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
const freshDigest = () => crypto.randomUUID().replaceAll("-", "").repeat(2);

const issueCommand = (overrides = {}) => ({
  session_id: freshSessionId(),
  subject: freshSubject(),
  token_digest: freshDigest(),
  device_digest: null,
  issued_at_ms: 1_000,
  expires_at_ms: 61_000,
  last_used_at_ms: 1_000,
  maxPerSubject: 4,
  ...overrides
});

const connectAdmin = async () => {
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  return client;
};

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

registerAuthSessionStoreContract({
  name: "postgres auth session store",
  makeStore: async () => {
    requireDsn();
    const store = createPostgresAuthSessionStore({ dsn });
    await store.initialize?.();
    return store;
  },
  makeRawStore: async () => {
    requireDsn();
    return createPostgresAuthSessionStore({ dsn });
  },
  freshSubject
});

test("the postgres auth session store rejects malformed DSNs at construction", () => {
  for (const value of [undefined, null, "", "not a url", "mysql://127.0.0.1/db", "http://127.0.0.1/db"]) {
    assert.throws(() => createPostgresAuthSessionStore({ dsn: value }), StoreConfigError, String(value));
  }
});

test("a fresh store instance sees the sessions a restart dropped", async () => {
  requireDsn();
  const subject = freshSubject();
  const first = createPostgresAuthSessionStore({ dsn });
  await first.initialize?.();
  const command = issueCommand({ subject });
  const issued = await first.issueSession(command);
  const rotated = await first.refreshSession({
    session_id: command.session_id,
    token_digest: freshDigest(),
    now: 2_000,
    expires_at_ms: 62_000
  });
  await first.revokeSession({ session_id: command.session_id, now: 3_000, maxRevokedPerSubject: 4 });
  await first.close();
  // A new backend instance over the same table is what a server restart
  // looks like: the revoked record and its rotated digest must survive it.
  const second = createPostgresAuthSessionStore({ dsn });
  await second.initialize?.();
  assert.deepEqual(await second.getSession({ session_id: issued.session_id, now: 4_000 }), {
    ...rotated,
    revoked: true,
    revoked_at_ms: 3_000
  });
  assert.deepEqual(
    await second.getSessionByTokenDigest({ token_digest: rotated.token_digest, now: 4_000 }),
    { ...rotated, revoked: true, revoked_at_ms: 3_000 }
  );
  await second.close();
});

test("the postgres auth session store fails closed when the database is unreachable", async () => {
  requireDsn();
  const store = createPostgresAuthSessionStore({
    dsn: "postgres://customer_api:customer_api_dev@127.0.0.1:1/postgres"
  });
  await assert.rejects(() => store.initialize?.(), StoreUnavailableError);
  await assert.rejects(() => store.issueSession(issueCommand()), StoreUnavailableError);
  await store.close();
});

test("concurrent issues of one subject serialize to the subject bound", async (t) => {
  requireDsn();
  const store = createPostgresAuthSessionStore({ dsn });
  await store.initialize?.();
  t.after(() => store.close());
  const subject = freshSubject();
  await Promise.all(
    Array.from({ length: 12 }, () =>
      store.issueSession(issueCommand({ subject, maxPerSubject: 3 }))
    )
  );
  const listed = await store.listSessions({ subject, now: 1_500, limit: 16 });
  assert.equal(listed.length, 3);
});

test("a failed write latches the store: every later operation rethrows it", async (t) => {
  requireDsn();
  const store = createPostgresAuthSessionStore({ dsn });
  await store.initialize?.();
  t.after(() => store.close().catch(() => undefined));
  const admin = await connectAdmin();
  try {
    await admin.query(
      "ALTER TABLE customer_api.auth_sessions RENAME TO auth_sessions_drifted"
    );
    await assert.rejects(() => store.issueSession(issueCommand()), StoreUnavailableError);
    // The failure latch pins every later call — reads included — to the
    // same unavailable error the write took.
    for (const operation of [
      () => store.issueSession(issueCommand()),
      () => store.getSession({ session_id: freshSessionId(), now: 1_000 }),
      () => store.sweepExpiredSessions({ now: 1_000 }),
      () => store.listSessions({ subject: freshSubject(), now: 1_000, limit: 4 })
    ]) {
      await assert.rejects(operation, StoreUnavailableError);
    }
  } finally {
    await admin
      .query("ALTER TABLE customer_api.auth_sessions_drifted RENAME TO auth_sessions")
      .catch(() => undefined);
    await admin.end();
  }
});

test("the store survives an idle pooled client being killed", async (t) => {
  requireDsn();
  const store = createPostgresAuthSessionStore({ dsn });
  await store.initialize?.();
  t.after(() => store.close().catch(() => undefined));
  const subject = freshSubject();
  await store.issueSession(issueCommand({ subject }));
  const admin = await connectAdmin();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity" +
        " WHERE datname = current_database() AND pid <> pg_backend_pid()" +
        " AND application_name = 'customer-api-auth-session-store'"
    );
  } finally {
    await admin.end();
  }
  // A dead idle client surfaces as a pool 'error' event: with no listener
  // that is an uncaught EventEmitter error and takes the process down —
  // the kill above would already have ended this run. The next write may
  // meet a client mid-teardown and latch, or ride a healthy one; both are
  // the same deterministic contract — after it, behavior is fixed.
  let first = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      first = await store.issueSession(issueCommand({ subject }));
      break;
    } catch (error) {
      assert.ok(error instanceof StoreUnavailableError);
      first = error;
      break;
    }
  }
  assert.ok(first !== null);
  if (first instanceof StoreUnavailableError) {
    await assert.rejects(
      () => store.getSession({ session_id: freshSessionId(), now: 1_000 }),
      (error) => error === first
    );
  } else {
    assert.deepEqual(await store.getSession({ session_id: first.session_id, now: 1_500 }), first);
  }
});

test("concurrent initialize calls share one pool and close releases every client", async (t) => {
  requireDsn();
  const store = createPostgresAuthSessionStore({ dsn });
  t.after(() => store.close().catch(() => undefined));
  await Promise.all([store.initialize?.(), store.initialize?.(), store.initialize?.()]);
  const admin = await connectAdmin();
  const connections = async () => {
    const result = await admin.query(
      "SELECT count(*) AS n FROM pg_stat_activity" +
        " WHERE datname = current_database() AND pid <> pg_backend_pid()" +
        " AND application_name = 'customer-api-auth-session-store'"
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

test("initialize rejects when the session table drifted away", async (t) => {
  requireDsn();
  const admin = await connectAdmin();
  try {
    await admin.query(
      "ALTER TABLE customer_api.auth_sessions RENAME TO auth_sessions_drifted"
    );
    const store = createPostgresAuthSessionStore({ dsn });
    t.after(() => store.close().catch(() => undefined));
    await assert.rejects(async () => store.initialize?.(), StoreUnavailableError);
    await assert.rejects(async () => store.issueSession(issueCommand()), StoreUnavailableError);
  } finally {
    await admin
      .query("ALTER TABLE customer_api.auth_sessions_drifted RENAME TO auth_sessions")
      .catch(() => undefined);
    await admin.end();
  }
});

test("initialize rejects when a session column drifted away", async (t) => {
  requireDsn();
  const admin = await connectAdmin();
  try {
    // Without token_digest the refresh rotation and digest index lose
    // their meaning; startup must notice instead of the first rotate
    // finding out. The rename round-trip keeps the column's CHECK and the
    // unique index attached, so the restore is exact.
    await admin.query(
      "ALTER TABLE customer_api.auth_sessions" +
        " RENAME COLUMN token_digest TO token_digest_drifted"
    );
    const store = createPostgresAuthSessionStore({ dsn });
    t.after(() => store.close().catch(() => undefined));
    await assert.rejects(async () => store.initialize?.(), StoreUnavailableError);
  } finally {
    await admin
      .query(
        "ALTER TABLE customer_api.auth_sessions" +
          " RENAME COLUMN token_digest_drifted TO token_digest"
      )
      .catch(() => undefined);
    await admin.end();
  }
});
