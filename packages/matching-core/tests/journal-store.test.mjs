import assert from "node:assert/strict";
import test from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import {
  createMemoryJournalStore,
  StoreError,
  StoreUnavailableError,
  validJournalStore,
} from "../src/journal-store.mjs";
import { replayMatchingJournalStore } from "../src/replay.mjs";
import { snapshotPlainData } from "../src/snapshot.mjs";
import { registerJournalStoreContract } from "./journal-store-contract.mjs";
import { mixedScenario, order } from "./helpers.mjs";

/**
 * The memory store is a per-process record: one namespace per store
 * instance, so the contract's namespace isolation case is two independent
 * instances.
 *
 * @param {string} [_namespace]
 */
async function memoryStore(_namespace) {
  return createMemoryJournalStore();
}

registerJournalStoreContract({
  name: "memory store",
  makeStore: memoryStore,
});

test("an engine with a memory journal store mirrors the live journal byte-identically", async () => {
  const plain = createMatchingEngine();
  const stored = createMemoryJournalStore();
  const mirrored = createMatchingEngine({ journalStore: stored });
  mixedScenario(plain);
  mixedScenario(mirrored);
  assert.deepEqual(plain.journal(), mirrored.journal());
  assert.equal(stored.kind, "memory");
  assert.deepEqual(await stored.load(), plain.journal());
  assert.equal(
    JSON.stringify(await stored.load()),
    JSON.stringify(plain.journal()),
  );
});

test("the mirrored journal stays deterministic: identical scenario yields identical store stream", async () => {
  const first = createMemoryJournalStore();
  const second = createMemoryJournalStore();
  const engineA = createMatchingEngine({ journalStore: first });
  const engineB = createMatchingEngine({ journalStore: second });
  mixedScenario(engineA);
  mixedScenario(engineB);
  assert.deepEqual(
    JSON.stringify(await first.load()),
    JSON.stringify(await second.load()),
  );
});

test("memory store append is synchronous and enforces contiguity inline", () => {
  const store = createMemoryJournalStore();
  const engine = createMatchingEngine({ journalStore: store });
  engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
  assert.throws(
    () => store.append([{ seq: 9, at: "2026-01-01T00:00:00Z", type: "cancelled" }]),
    (error) => error instanceof StoreError && /seq/.test(error.message),
  );
});

test("memory store rejects non-array and non-integer-seq appends", async () => {
  const store = createMemoryJournalStore();
  assert.throws(() => store.append(/** @type {never} */ ("x")), TypeError);
  assert.throws(() => store.append(/** @type {never} */ (null)), TypeError);
  assert.throws(
    () => store.append([{ seq: "1", at: "2026-01-01T00:00:00Z", type: "accepted" }]),
    StoreError,
  );
});

test("validJournalStore accepts the store shape and rejects anything else", () => {
  const store = createMemoryJournalStore();
  assert.equal(validJournalStore(store), store);
  assert.throws(() => validJournalStore(null), TypeError);
  assert.throws(() => validJournalStore({ kind: "memory" }), TypeError);
  assert.throws(
    () =>
      validJournalStore({
        kind: "memory",
        append() {},
        load() {},
        close: "nope",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      createMatchingEngine({
        journalStore: { kind: "memory", append() {} },
      }),
    TypeError,
  );
});

test("an async append result is awaited on the store's own queue (write-behind)", async () => {
  /** @type {import("../src/events.mjs").MatchingEvent[][]} */
  const seen = [];
  const store = {
    kind: "stub",
    async append(events) {
      seen.push([...events]);
    },
    async load() {
      return Object.freeze(seen.flat());
    },
    async close() {},
  };
  const engine = createMatchingEngine({ journalStore: store });
  engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
  engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" }));
  // The engine's synchronous contract is unchanged: events are already in
  // the engine journal; the store sees the same batches after microtasks.
  await store.load();
  assert.deepEqual(seen.flat(), engine.journal());
});

test("replayMatchingJournalStore restores an equivalent engine and continues appending", async () => {
  const recorded = createMemoryJournalStore();
  const live = createMatchingEngine({ journalStore: recorded });
  mixedScenario(live);
  const restored = await replayMatchingJournalStore(recorded);
  assert.deepEqual(restored.journal(), live.journal());
  assert.deepEqual(restored.bookSnapshot("USDT/RUB"), live.bookSnapshot("USDT/RUB"));
  restored.submitOrder(order(77, { side: "sell", price: "95", quantity: "1" }));
  const stream = await recorded.load();
  assert.equal(stream.length, restored.journal().length);
  assert.equal(stream[stream.length - 1].seq, stream.length);
});

test("replayMatchingJournalStore runs every loaded row through stream validation", async () => {
  // A hostile stream: valid shape, gap in seq — the store serves bytes, the
  // replay validation is the only gate before any engine exists.
  const engine = createMatchingEngine();
  const real = engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "1" }));
  const hostile = {
    kind: "hostile",
    async append() {},
    async load() {
      return Object.freeze([
        ...real.map((event) => snapshotPlainData(event)),
        { seq: 7, at: "2026-01-01T00:00:00Z", type: "cancelled", posting: "none", order_id: order(1).order_id, instrument: "USDT/RUB", side: "sell", price: "90.00000000", quantity: "1.000000" },
      ]);
    },
    async close() {},
  };
  await assert.rejects(
    () => replayMatchingJournalStore(hostile),
    (error) => error instanceof TypeError && /invalid event stream/.test(error.message),
  );
  // And a corrupted single field fails the same gate.
  const corrupted = {
    kind: "corrupt",
    async append() {},
    async load() {
      return Object.freeze([
        { ...snapshotPlainData(real[0]), instrument: "EVIL/COIN" },
      ]);
    },
    async close() {},
  };
  await assert.rejects(
    () => replayMatchingJournalStore(corrupted),
    (error) => error instanceof TypeError && /invalid event stream/.test(error.message),
  );
});

test("replayMatchingJournalStore validates its arguments", async () => {
  const store = createMemoryJournalStore();
  await assert.rejects(() => replayMatchingJournalStore(/** @type {never} */ (null)), TypeError);
  await assert.rejects(
    () => replayMatchingJournalStore(store, { bogus: true }),
    (error) => error instanceof TypeError && /unknown option/.test(error.message),
  );
});

test("StoreUnavailableError is a StoreError subtype", () => {
  const error = new StoreUnavailableError("down");
  assert.equal(error instanceof StoreError, true);
  assert.equal(error instanceof StoreUnavailableError, true);
  assert.equal(error.name, "StoreUnavailableError");
});

test("the engine journal() view is unaffected by the store seam", () => {
  const engine = createMatchingEngine({ journalStore: createMemoryJournalStore() });
  mixedScenario(engine);
  const journal = engine.journal();
  assert.equal(Object.isFrozen(journal), true);
  assert.equal(journal.length > 0, true);
});
