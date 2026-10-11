// Postgres journal contract — the real-database arm of the store tests.
// This file is intentionally NOT named `*.test.mjs`: the suite stays
// runnable without docker (`npm test` = `node --test tests/*.test.mjs`),
// while CI/local docker runs invoke it through `tests/postgres-journal.sh`,
// which applies migrations and exports MATCHING_CORE_STORE_DSN. When the
// DSN is absent the contract fails hard rather than skipping — the harness
// is the only supported entry point.

import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import {
  StoreConfigError,
  StoreError,
  StoreUnavailableError,
} from "../src/journal-store.mjs";
import { createPostgresJournalStore } from "../src/postgres-journal-store.mjs";
import { replayMatchingJournalStore } from "../src/replay.mjs";
import { registerJournalStoreContract } from "./journal-store-contract.mjs";
import { order } from "./helpers.mjs";
import { createMatchingEngine } from "../src/engine.mjs";

const dsn = process.env.MATCHING_CORE_STORE_DSN;
assert.ok(dsn, "MATCHING_CORE_STORE_DSN is required (run tests/postgres-journal.sh)");

/** @param {string} namespace */
async function postgresStore(namespace) {
  const store = createPostgresJournalStore({ dsn, namespace });
  await store.initialize();
  return store;
}

/**
 * A second pool over the same namespace — the "process restart" arm of the
 * durability contract.
 *
 * @param {string} namespace
 */
async function reopenPostgresStore(namespace) {
  return postgresStore(namespace);
}

registerJournalStoreContract({
  name: "postgres journal store",
  makeStore: postgresStore,
  reopenStore: reopenPostgresStore,
});

test("postgres store reports kind postgresql", async (t) => {
  const store = await postgresStore("kind_check");
  t.after(() => store.close());
  assert.equal(store.kind, "postgresql");
});

test("a restored engine continues the recorded stream over a fresh pool", async (t) => {
  const namespace = "restore_check";
  const writer = await postgresStore(namespace);
  t.after(() => writer.close());
  const live = await replayMatchingJournalStore(writer);
  live.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
  live.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
  // Write-behind: the engine's sync ops queue appends on the writer's tail;
  // an awaited op on the same store is the durability boundary, and a
  // second store's load() cannot see it — drain before reopening.
  await writer.load();

  const reader = await postgresStore(namespace);
  t.after(() => reader.close());
  const restored = await replayMatchingJournalStore(reader);
  assert.deepEqual(restored.journal(), live.journal());
  assert.deepEqual(restored.bookSnapshot("USDT/RUB"), live.bookSnapshot("USDT/RUB"));
  // Continuation appends keep seq contiguous on the recorded tail.
  restored.cancelOrder("USDT/RUB", order(1).order_id);
  const stream = await reader.load();
  assert.equal(stream.at(-1).seq, stream.length);
});

test("a hostile row passing column checks still fails replay validation", async (t) => {
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  t.after(() => pool.end());
  const namespace = "corrupt_check";
  // Well-formed row, unknown instrument: every CHECK passes, replay rejects.
  await pool.query(
    `SELECT matching_core.append_matching_journal($1, $2::jsonb)`,
    [
      namespace,
      JSON.stringify([
        {
          seq: 1,
          at: "2026-01-01T00:00:00Z",
          type: "accepted",
          posting: "none",
          order_id: "ord_000000000000000000000001",
          instrument: "EVIL/COIN",
          side: "buy",
          order_type: "limit",
          price: "90.00000000",
          quantity: "1.000000",
        },
      ]),
    ],
  );
  const store = await postgresStore(namespace);
  t.after(() => store.close());
  const events = await store.load();
  assert.equal(events.length, 1);
  await assert.rejects(
    () => replayMatchingJournalStore(store),
    (error) => error instanceof TypeError && /invalid event stream/.test(error.message),
  );
});

test("seq gaps are rejected at insert, below the store", async (t) => {
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  t.after(() => pool.end());
  await assert.rejects(
    () =>
      pool.query(
        `INSERT INTO matching_core.matching_journal (namespace, seq, at, type, payload)
         VALUES ('gap_check', 7, '2026-01-01T00:00:00Z', 'cancelled', $1::jsonb)`,
        [
          JSON.stringify({
            seq: 7,
            at: "2026-01-01T00:00:00Z",
            type: "cancelled",
            posting: "none",
            order_id: "ord_000000000000000000000001",
            instrument: "USDT/RUB",
            side: "sell",
            price: "90.00000000",
            quantity: "1.000000",
          }),
        ],
      ),
    /seq|continu|continue/i,
  );
});

test("the append function rejects a non-continuing batch atomically", async (t) => {
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  t.after(() => pool.end());
  const namespace = "atomic_check";
  const events = [
    {
      seq: 1,
      at: "2026-01-01T00:00:00Z",
      type: "accepted",
      posting: "none",
      order_id: "ord_000000000000000000000001",
      instrument: "USDT/RUB",
      side: "buy",
      order_type: "limit",
      price: "90.00000000",
      quantity: "1.000000",
    },
    {
      seq: 5,
      at: "2026-01-01T00:00:00Z",
      type: "cancelled",
      posting: "none",
      order_id: "ord_000000000000000000000001",
      instrument: "USDT/RUB",
      side: "buy",
      price: "90.00000000",
      quantity: "1.000000",
    },
  ];
  await assert.rejects(
    () =>
      pool.query(`SELECT matching_core.append_matching_journal($1, $2::jsonb)`, [
        namespace,
        JSON.stringify(events),
      ]),
    /continu/i,
  );
  // Nothing landed: the batch either commits whole or not at all.
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM matching_core.matching_journal WHERE namespace = $1`,
    [namespace],
  );
  assert.equal(rows[0].n, 0);
});

test("recorded journals are append-only at the table", async (t) => {
  const namespace = "append_only_check";
  const store = await postgresStore(namespace);
  t.after(() => store.close());
  const engine = createMatchingEngine();
  const [batch] = [engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }))];
  await store.append(batch);
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  t.after(() => pool.end());
  await assert.rejects(
    () =>
      pool.query(
        `UPDATE matching_core.matching_journal SET payload = '{}'::jsonb WHERE namespace = $1`,
        [namespace],
      ),
    /append-only/i,
  );
  await assert.rejects(
    () => pool.query(`DELETE FROM matching_core.matching_journal WHERE namespace = $1`, [namespace]),
    /append-only/i,
  );
});

test("invalid constructor arguments are configuration errors", () => {
  assert.throws(() => createPostgresJournalStore({}), StoreConfigError);
  assert.throws(() => createPostgresJournalStore({ dsn: "mysql://x/db" }), StoreConfigError);
  assert.throws(
    () => createPostgresJournalStore({ dsn: "postgres://u:p@h/db", namespace: "BAD NS" }),
    StoreConfigError,
  );
});

test("an unreachable database surfaces as unavailable, not a hang", async () => {
  const store = createPostgresJournalStore({
    dsn: "postgres://u:p@127.0.0.1:1/unreachable",
    namespace: "unreachable_check",
  });
  await assert.rejects(() => store.initialize(), StoreUnavailableError);
});

test("operations before initialize fail closed", async () => {
  const store = createPostgresJournalStore({ dsn, namespace: "uninitialized_check" });
  await assert.rejects(() => store.load(), StoreUnavailableError);
});

// Continuation parity with the memory backend: seq shape and batch-internal
// contiguity are enforced identically before storage is touched, and
// storage-side rejections of the batch surface as non-latching StoreError.
// A caller bug must never poison the durable stream or the store.

test("a batch with a string seq is rejected identically to the memory backend", async (t) => {
  const store = await postgresStore("parity_string_seq");
  t.after(() => store.close());
  const engine = createMatchingEngine();
  const batch = engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
  // Client-side rejections throw synchronously, identical to memory.
  assert.throws(
    () => store.append(batch.map((e) => ({ ...e, seq: String(e.seq) }))),
    StoreError,
  );
  assert.throws(
    () => store.append(batch.map((e) => ({ ...e, seq: e.seq + 0.5 }))),
    StoreError,
  );
  // Caller bugs do not latch: the store keeps working.
  await store.append(batch);
  assert.equal((await store.load()).length, batch.length);
});

test("a batch with an internal seq gap is rejected and lands nothing", async (t) => {
  const store = await postgresStore("parity_internal_gap");
  t.after(() => store.close());
  const engine = createMatchingEngine();
  const batch = engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
  const gapped = batch.map((e, i) => ({ ...e, seq: e.seq + (i === 0 ? 0 : 9) }));
  assert.throws(() => store.append(gapped), StoreError);
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  t.after(() => pool.end());
  const { rows } = await pool.query(
    `SELECT count(*) AS n FROM matching_core.matching_journal WHERE namespace = $1`,
    ["parity_internal_gap"],
  );
  assert.equal(rows[0].n, "0");
});

test("a mid-stream batch rejection does not latch the store", async (t) => {
  const store = await postgresStore("parity_mid_stream");
  t.after(() => store.close());
  const engine = createMatchingEngine();
  const batch = engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
  await store.append(batch);
  // Internally contiguous but continuing from a consumed seq: the
  // storage-side check rejects it as a caller bug, not a write failure.
  await assert.rejects(() => store.append(batch), StoreError);
  const next = engine.submitOrder(order(2, { side: "buy", price: "91", quantity: "1" }));
  await store.append(next);
  assert.equal((await store.load()).length, batch.length + next.length);
});

test("the failure latch locks every later operation while close stays usable", async (t) => {
  const namespace = "latch_probe";
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  // Cleanup runs in registration order: drop first, then end the pool.
  t.after(async () => {
    await pool.query(`
      DROP TRIGGER IF EXISTS audit_latch_probe ON matching_core.matching_journal;
      DROP FUNCTION IF EXISTS matching_core.audit_latch_probe();
    `);
    await pool.end();
  });
  await pool.query(`
    CREATE OR REPLACE FUNCTION matching_core.audit_latch_probe() RETURNS trigger
      LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'latch probe failure'; END; $f$;
    CREATE TRIGGER audit_latch_probe BEFORE INSERT ON matching_core.matching_journal
      FOR EACH ROW WHEN (NEW.namespace = '${namespace}')
      EXECUTE FUNCTION matching_core.audit_latch_probe();
  `);
  const store = await postgresStore(namespace);
  t.after(() => store.close().catch(() => undefined));
  const engine = createMatchingEngine();
  const batch = engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
  const first = await store.append(batch).then(() => null, (e) => e);
  assert.ok(first instanceof StoreUnavailableError);
  // First failure latches: append and load rethrow it.
  const second = await store.append(batch).then(() => null, (e) => e);
  assert.ok(second === first);
  const loadFailure = await store.load().then(() => null, (e) => e);
  assert.ok(loadFailure === first);
});

test("a replayed engine snapshots byte-identically through the durable rows", async (t) => {
  const namespace = "snapshot_parity";
  const store = await postgresStore(namespace);
  t.after(() => store.close());
  const engine = createMatchingEngine({ journalStore: store });
  engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2", owner: "desk-a" }));
  engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1", owner: "desk-b" }));
  await store.load();
  const replayed = await replayMatchingJournalStore(await postgresStore(namespace));
  assert.equal(
    JSON.stringify(replayed.snapshot()),
    JSON.stringify(engine.snapshot()),
  );
});
