import assert from "node:assert/strict";
import test from "node:test";

import { createMatchingEngine } from "../src/engine.mjs";
import { StoreError } from "../src/journal-store.mjs";
import { order } from "./helpers.mjs";

// Shared journal-store contract: the same suite runs against the memory and
// PostgreSQL backends so both honor identical append/load semantics. Each
// case builds its store through `makeStore` — a backend bound to an empty
// journal namespace — and closes it through `t.after`, so a backend may hold
// real connections (the PostgreSQL pool) without leaking. `reopenStore`
// stands in for a restart: a new backend over the same namespace must see
// the recorded journal (the memory backend answers with its own store,
// since its durability boundary is this runtime).

/**
 * @param {{
 *   name: string,
 *   makeStore: (namespace: string) => Promise<import("../src/journal-store.mjs").MatchingJournalStore>,
 *   reopenStore?: (namespace: string, store: import("../src/journal-store.mjs").MatchingJournalStore) => Promise<import("../src/journal-store.mjs").MatchingJournalStore>
 * }} options
 */
export function registerJournalStoreContract({ name, makeStore, reopenStore }) {
  const reopen = reopenStore ?? (async (_namespace, store) => store);
  let namespaceCounter = 0;
  const freshNamespace = () => `ns_contract_${++namespaceCounter}`;

  /**
   * A small deterministic stream: three operations, five emitted events.
   *
   * @returns {readonly import("../src/events.mjs").MatchingEvent[][]}
   */
  function emittedBatches() {
    const engine = createMatchingEngine();
    return [
      engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" })),
      engine.submitOrder(order(2, { side: "buy", price: "90", quantity: "1" })),
      engine.cancelOrder("USDT/RUB", order(3).order_id),
    ];
  }

  test(`${name}: appended batches load back in seq order`, async (t) => {
    const store = await makeStore(freshNamespace());
    t.after(() => store.close());
    const batches = emittedBatches();
    for (const batch of batches) {
      await store.append(batch);
    }
    assert.deepEqual(await store.load(), batches.flat());
  });

  test(`${name}: a reopened namespace keeps the recorded journal`, async (t) => {
    const namespace = freshNamespace();
    const first = await makeStore(namespace);
    t.after(() => first.close());
    const batches = emittedBatches();
    for (const batch of batches) {
      await first.append(batch);
    }
    const second = await reopen(namespace, first);
    if (second !== first) {
      t.after(() => second.close());
    }
    assert.deepEqual(await second.load(), batches.flat());
  });

  test(`${name}: append rejects a batch that is not the contiguous continuation`, async (t) => {
    const store = await makeStore(freshNamespace());
    // Durable backends latch the rejected write: close() rethrows it, so
    // teardown must tolerate the failure this case asserts.
    t.after(() => store.close().catch(() => undefined));
    const [first, second] = emittedBatches();
    await store.append(first);
    const gap = second.map((event) => ({ ...event, seq: event.seq + 10 }));
    await assert.rejects(async () => store.append(gap), StoreError);
  });

  test(`${name}: an identical re-append dedupes instead of colliding`, async (t) => {
    const store = await makeStore(freshNamespace());
    t.after(() => store.close().catch(() => undefined));
    const batches = emittedBatches();
    await store.append(batches[0]);
    // A retry after a lost or timed-out response re-delivers the identical
    // batch: it resolves and records nothing twice.
    await store.append(batches[0].map((event) => ({ ...event })));
    assert.deepEqual(await store.load(), batches[0]);
    await store.append(batches[1]);
    assert.deepEqual(await store.load(), [...batches[0], ...batches[1]]);
  });

  test(`${name}: a batch replaying a recorded prefix lands only its tail`, async (t) => {
    const store = await makeStore(freshNamespace());
    t.after(() => store.close().catch(() => undefined));
    const batches = emittedBatches();
    await store.append(batches[0]);
    await store.append([batches[0].at(-1), ...batches[1]]);
    assert.deepEqual(await store.load(), [...batches[0], ...batches[1]]);
  });

  test(`${name}: append rejects a re-delivered seq carrying a conflicting event`, async (t) => {
    const store = await makeStore(freshNamespace());
    t.after(() => store.close().catch(() => undefined));
    const batches = emittedBatches();
    await store.append(batches[0]);
    const conflicting = batches[0].map((event) => ({ ...event, quantity: "999.999" }));
    await assert.rejects(async () => store.append(conflicting), StoreError);
  });

  test(`${name}: namespaces isolate recorded events`, async (t) => {
    const one = await makeStore(freshNamespace());
    const two = await makeStore(freshNamespace());
    t.after(() => one.close());
    t.after(() => two.close());
    const [batch] = emittedBatches();
    await one.append(batch);
    assert.deepEqual(await one.load(), batch);
    assert.deepEqual(await two.load(), []);
  });

  test(`${name}: an empty namespace loads an empty stream`, async (t) => {
    const store = await makeStore(freshNamespace());
    t.after(() => store.close());
    assert.deepEqual(await store.load(), []);
  });
}
