// One-shot helper process for the e2e postgres arm. The matching engine
// has no long-lived host process inside the dev stack — it runs embedded in
// customer-api request handlers — so journal durability is asserted at
// the store contract: "record" replays an empty store into a live engine,
// submits a deterministic scenario, and drains the write-behind appends;
// "verify" opens a second store over the same namespace, folds the
// recorded stream through replayMatchingJournalStore, asserts it matches
// a freshly computed engine, and appends a continuation batch. Exits 0
// only when every assertion holds; any failure is a non-zero exit.

import assert from "node:assert/strict";

import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import { resolveJournalStoreEnv } from "../../matching-core/src/journal-store.mjs";
import { createPostgresJournalStore } from "../../matching-core/src/postgres-journal-store.mjs";
import { replayMatchingJournalStore } from "../../matching-core/src/replay.mjs";
import { order } from "../../matching-core/tests/helpers.mjs";

const mode = process.env.JOURNAL_HELPER_MODE;
const resolved = resolveJournalStoreEnv(process.env);
assert.equal(
  resolved.mode,
  "postgres",
  "MATCHING_CORE_STORE=postgres is required (run tests/postgres-stack.sh)"
);

const namespace = process.env.MATCHING_CORE_JOURNAL_NAMESPACE ?? "e2e_stack";
const store = createPostgresJournalStore({ dsn: resolved.dsn, namespace });
await store.initialize();

// Deterministic: same order ids, prices and quantities in every helper run,
// and the simulated clock emits identical timestamps for identical folds.
function scenario(engine) {
  engine.submitOrder(order(1, { side: "sell", price: "90", quantity: "2" }));
  engine.submitOrder(order(2, { side: "sell", price: "91", quantity: "3" }));
  engine.submitOrder(order(3, { side: "buy", price: "90", quantity: "1" }));
}

if (mode === "record") {
  const live = await replayMatchingJournalStore(store);
  scenario(live);
  // Write-behind: the durability boundary is the next awaited op on the
  // same store — drain before the process exits.
  const recorded = await store.load();
  assert.equal(recorded.length, live.journal().length);
  assert.equal(recorded.at(-1).seq, recorded.length);
  await store.close();
  console.log(`journal-helper-record-ok events=${recorded.length}`);
} else if (mode === "verify") {
  const restored = await replayMatchingJournalStore(store);
  const expected = createMatchingEngine();
  scenario(expected);
  assert.deepEqual(restored.journal(), expected.journal());
  assert.deepEqual(restored.bookSnapshot("USDT/RUB"), expected.bookSnapshot("USDT/RUB"));

  // The replayed engine keeps appending on the same store: a new order
  // continues the recorded stream with contiguous seq.
  const before = restored.journal().length;
  restored.submitOrder(order(4, { side: "buy", price: "91", quantity: "1" }));
  const stream = await store.load();
  assert.equal(stream.length, restored.journal().length);
  assert.ok(stream.length > before);
  assert.equal(stream.at(-1).seq, stream.length);
  // Content parity, not just count+tail: a store that rewrote an earlier
  // row's payload on this append still satisfies length and seq ordering.
  assert.deepEqual(stream, restored.journal());
  await store.close();
  console.log(`journal-helper-verify-ok events=${stream.length}`);
} else {
  throw new Error(`unknown JOURNAL_HELPER_MODE: ${mode ?? "<unset>"}`);
}
