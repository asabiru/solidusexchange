# SOLID matching core (dev-only)

- Status: Proposed
- Production effect: none

Pure deterministic order-book and matching skeleton for the exchange engine.
The package is a library only: it consumes order records and produces event
records — it never posts to a ledger, moves balances, settles, routes, or
talks to anything. Fills carry `posting: "none"`; they are data, not ledger
entries or settlement instructions.

## Boundary

- Runtime boundary: `dev-dry-run`; library code and unit tests only.
- No HTTP, no serving surface, no storage, no I/O: `src/` imports sibling
  modules only. `npm run check` enforces this plus no ambient
  clock/randomness, timers, env/credentials or floating-point money.
- No money movement and no execution authority: nothing here reserves
  funds, posts, settles, signs, or reaches custody or the ledger.
- Instruments reuse the exchange `BASE/QUOTE` pair naming shared with the
  quote simulator and the customer exchange-orders contract: `USDT/RUB`,
  `TON/RUB`, `TON/USDT` (asset scales 6/9, price scale 8).

These limits follow `Documentation/regulated-core/README.md` (stop
condition 4: no money-moving endpoint without idempotency, policy decision,
immutable audit, ledger effect and reconciliation path).

## Model

- Limit and market orders, identified by `order_id` matching
  `ord_[0-9a-f]{24}`. The optional `type` field is `"limit"` or `"market"`
  and defaults to `"limit"`; anything else is rejected `invalid_type`.
- Market orders carry no `price` key — a submission with one is
  `invalid_order`, just like a limit submission without one. A market
  order sweeps the opposite side from the best level outward until it is
  filled or the book is exhausted, then it is done: it never rests and
  never crosses a later order. Whatever remains unfilled — the whole
  quantity on an empty book, or the leftover after a partial sweep — is
  `rejected` with `insufficient_liquidity` and the rejected `quantity`.
- Price/time priority: a better-priced order always matches first; within a
  price level orders match FIFO in acceptance order.
- Partial fills are fully supported; an incoming order sweeps as many price
  levels as its limit allows — a market order sweeps all of them, filling
  each level at its own (maker) price.
- Fill price is always the resting (maker) order's price, so price
  improvement is automatic and a fill can never be worse than the limit.
- Quantities are decimal strings scaled to the instrument's base asset;
  prices to the pair's price scale (8). Inputs with finer precision than
  the scale allows are rejected, never rounded.
- Orders may carry an optional `owner` tag. The self-trade policy is pinned
  to `SELF_TRADE_POLICY = "reject"`: when the resting order at the head of
  the best opposite price level shares the taker's owner, the taker's
  remaining quantity is rejected with `self_trade` instead of matching or
  skipping its own order.
- `amendOrder({ order_id, price?, quantity? })` replaces a resting order's
  price and/or quantity in place — cancel-replace that keeps the
  `order_id`, instrument, side, type and owner. `quantity` is the new
  TOTAL order quantity (the FIX OrderCancelReplace `OrderQty` convention):
  it includes the already-executed part, so a total at or below the filled
  amount is rejected `quantity_below_filled`.
- Time priority follows the dominant venue convention (CME/Eurex-style):
  a price change loses priority and re-queues at the tail of the new
  level's FIFO; a quantity decrease keeps the slot; a quantity INCREASE
  also loses priority and re-queues — pinned so an order can never grow
  into queue head ahead of orders it was behind. An amend that changes
  nothing is rejected `no_change`.
- A priority-losing amend whose new price crosses the book matches inside
  the same call: the stream is `amended` then the usual fill pairs at
  maker prices, then `resting` for the remainder — the order never rests
  at a crossed price, and the self-trade policy applies mid-sweep exactly
  as on submission. Amending an id that is not resting — unknown, filled,
  cancelled, rejected or a market order (markets never rest) — is rejected
  `order_not_resting`.

## Events

`submitOrder` / `cancelOrder` / `amendOrder` return the events they
produced, in order.
Every event is a frozen record `{ seq, at, type, order_id, instrument,
side, posting, ... }` with `posting: "none"`. `seq` is a strictly
increasing engine-scoped integer; `at` comes from the injected clock
(default: a fixed simulated epoch — never the wall clock).

| Type | Meaning | Extra fields |
| --- | --- | --- |
| `accepted` | Order passed validation and entered matching | `order_type`, `quantity`, plus `price` for limit orders only |
| `filled` | This order's remainder reached zero in one execution | `fill_id`, `maker_order_id`, `taker_order_id`, `price`, `quantity`, `remaining_quantity` |
| `partially_filled` | This order still has remainder after one execution | same as `filled` |
| `resting` | Order remainder entered the book | `price`, `quantity` |
| `cancelled` | Resting order removed by id | `price`, `quantity` (removed remainder) |
| `amended` | Resting order replaced in place | `previous_price`, `previous_quantity` (old values), `price`, `quantity` (new totals) |
| `rejected` | Submission, cancel or amend refused | `reason` (see below), plus `quantity` for a `self_trade` or `insufficient_liquidity` remainder |

Each execution emits at most two events sharing one `fill_id`
(`fll_` + 24 hex): the maker's event first, then the taker's — each is
`filled` or `partially_filled` depending on that order's own remainder.

All events produced by one `submitOrder`, `cancelOrder` or `amendOrder`
share a single timestamp: the injected clock is read once per operation, before any state
is touched, so a backwards or malformed clock fails the whole call atomically
— no order is tracked, removed or partially filled, and no `seq` is consumed,
when the call throws.

Rejection reasons: `invalid_order`, `invalid_order_id`,
`invalid_instrument`, `unknown_instrument`, `invalid_side`,
`invalid_owner`, `invalid_type`, `invalid_price`, `non_positive_price`,
`invalid_quantity`, `non_positive_quantity`, `duplicate_order_id`,
`self_trade`, `insufficient_liquidity`, `order_not_resting`, `no_change`,
`quantity_below_filled`.

Rejected submissions do not consume order ids; a resubmission of the same
id is judged on its own merits. Cancelling an id that is not resting —
unknown, filled, cancelled or rejected — is rejected `order_not_resting`.

`engine.journal()` returns every event emitted so far, in `seq` order, as
a frozen array of the same frozen records — including `rejected` events,
since rejected submissions and cancels consume `seq` too. The journal is
append-only in-memory data, never a ledger.

## API

```js
import { createMatchingEngine, createSimulatedClock } from "@solidchange/matching-core";

const clock = createSimulatedClock();
const engine = createMatchingEngine({ clock });

engine.submitOrder({ order_id: "ord_…", instrument: "USDT/RUB", side: "sell",
                     price: "90.5", quantity: "4", owner: "desk-a" });
engine.submitOrder({ order_id: "ord_…", instrument: "USDT/RUB", side: "buy",
                     price: "91", quantity: "10" });
engine.submitOrder({ order_id: "ord_…", instrument: "USDT/RUB", side: "buy",
                     type: "market", quantity: "6" });   // sweeps asks; leftover rejected
engine.bookSnapshot("USDT/RUB");   // { instrument, bids: [...], asks: [...] }
engine.cancelOrder("USDT/RUB", "ord_…");
engine.amendOrder({ order_id: "ord_…", price: "92" });   // re-queues at 92
engine.amendOrder({ order_id: "ord_…", quantity: "7" }); // new TOTAL qty; increase loses priority
engine.orderStatus("ord_…");       // tracked state or null (price: null on market orders)
```

`createMatchingEngine({ instruments })` accepts a custom instrument list;
each entry must be a well-formed `BASE/QUOTE` definition. Every definition
is copied once at creation and stored frozen — the registry never re-reads
the caller's objects, so getters, Proxies or later edits cannot change what
was validated.

## Persistence groundwork (data-only)

The journal, snapshot and replay layer is the persistence groundwork for
the engine — still library-only and data-only: it captures and rebuilds
state, it never writes storage, does I/O, or posts anything.

- `engine.snapshot()` returns a canonical plain-data snapshot
  `{ kind, version, instruments, orders, resting, next_seq, next_fill,
  last_at }`: every tracked order with its state, the resting ids in
  book-insertion order, and the counters. It deep-freezes and JSON
  round-trips.
- `restoreMatchingEngine(snapshot, { clock? })` validates the snapshot
  fail-closed (`TypeError` with an `invalid engine snapshot:` reason —
  wrong types, unknown keys, duplicate ids, a resting order missing from
  the tracked set, the resting list out of book order, counters below
  what the recorded orders require, a market order carrying a price or
  resting/cancelled, and order decimals that are not in exact-scale form —
  a stored `price`, `quantity` or `remaining` must read exactly the way
  the engine's own formatter would write it) and rebuilds an engine whose
  `bookSnapshot`/`orderStatus` are byte-identical to the source's.
  `seq`/`fill_id` continue where the snapshot left them; the restored
  `journal()` starts empty — a snapshot carries state, not history.
- `replayMatchingEngine({ instruments?, events, clock? })` folds a
  recorded event stream — typically another engine's `journal()` — into
  an engine-equivalent state. The stream must be a prefix the real
  engine could have emitted: contiguous `seq` from 1, non-decreasing
  canonical timestamps, known types and fields only, fill pairs
  consecutive maker-then-taker sharing sequential `fill_id`s, every
  referenced order accepted by the stream, fill/cancel arithmetic
  matching the tracked remainder, `amended` events only on resting
  orders whose `previous_*` fields match the tracked state (with the
  same priority rule the live engine applies: keep the slot on a
  decrease at an unchanged price, re-queue on a price change or an
  increase, and the follow-up `resting` / fill / `rejected` events the
  re-queue produces), a limit taker never filling at a price
  outside its own limit, and the market-order rules — no `price`
  on a market `accepted`, never a `resting` for one, and
  `insufficient_liquidity` rejections only on market orders with the exact
  leftover quantity. Anything else throws `TypeError` with
  an `invalid event stream:` reason. The replayed engine's `journal()`
  returns the folded stream.

## Journal persistence seam (dev-only)

The engine can mirror every emitted event batch into a `MatchingJournalStore`
— the dev-only durability seam, same shape as `customer-api`'s store:
`{ kind, initialize?(), append(events), load(), close() }`. `posting: "none"`
is untouched: this is data durability only, never ledger posting.

- `createMatchingEngine({ instruments?, clock?, journalStore? })` attaches a
  store; each operation mirrors its emitted batch via `append(events)`
  before returning. The engine's in-memory `journal()` stays the live
  record, unchanged.
- `createMemoryJournalStore()` is the default backend: in-process only,
  synchronous appends, contiguous-`seq` enforced per batch.
- `createPostgresJournalStore({ dsn, namespace })` is the durable backend:
  `MATCHING_CORE_STORE=postgres` + `MATCHING_CORE_STORE_DSN=postgres://…`
  select it, resolved fail-closed by `resolveJournalStoreEnv` (unset →
  memory; unknown kind or missing/invalid DSN → `StoreConfigError` at
  startup, never silently degraded). The `pg` driver is lazy-loaded inside
  `initialize()` — importing this module without the dependency installed
  still works. Every `append` is ONE statement —
  `matching_core.append_matching_journal` advisory-locks the namespace,
  checks contiguous-`seq` continuation, and inserts atomically — and a
  caller that cannot await treats the store's next awaited operation as
  the durability boundary: the first write failure is latched and every
  later `append`/`load`/`close` rethrows it.
- `replayMatchingJournalStore(store, { instruments?, clock? })` is the only
  engine-facing restore path: `store.load()` returns the raw recorded
  stream and it is folded through `replayMatchingEngine`'s fail-closed
  validation — a corrupted or hostile row fails at restore and never
  reaches an engine. The replayed engine keeps appending to the same
  store, continuing `seq` contiguously.
- `migrations/0001_matching_journal.sql` creates the `matching_core`
  schema: append-only `schema_migrations` history, the
  `matching_journal` table (`namespace,seq` PK; `at`, `type`, `payload`
  jsonb self-consistent via CHECKs), append-only row triggers, contiguous
  `seq` per namespace enforced at insert, and the
  `append_matching_journal` function. `0002_journal_event_grammar.sql`
  pins the payload's per-type event grammar and idempotent redelivery;
  `0003_journal_event_timestamp.sql` closes the `'T24:00:00Z'`
  end-of-day spelling the timestamptz cast normalizes instead of
  rejecting. `npm run verify:migrations` runs the
  source catalog and policy verifiers; `tests/postgres-journal.sh` is the
  pg arm (mirrors `customer-api/tests/postgres-store.sh`: applies
  migrations via host `psql` or `PSQL_DOCKER_IMAGE`, exports
  `MATCHING_CORE_STORE_DSN`, runs `tests/postgres-journal-contract.mjs` —
  deliberately not a `*.test.mjs` so `npm test` stays docker-free, and it
  fails hard without the DSN).

Replayed and restored engines agree byte-identically with the live
engine on `bookSnapshot` and `orderStatus` — `tests/replay.test.mjs`
pins all three paths on one mixed limit+market scenario. `accepted`
events carry `owner`, so a replayed engine keeps owner tags and its
self-trade policy still applies; snapshots preserve owners too.

## Determinism

No `Date.now`, no `Math.random`, no ambient state. Time comes from the
injected `clock.now()` (integer epoch seconds, monotonic — a clock that
moves backwards throws). `seq` and `fill_id` come from engine counters.
Replaying the same input sequence on a fresh engine yields the same event
sequence byte-identical, which `tests/determinism.test.mjs` pins.

## Run

```bash
npm ci
npm run verify   # check + lint + typecheck + test + build
```

Individual scripts: `npm run check`, `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build` (emits `.d.mts` declarations to `dist/`),
`npm run verify:migrations`, and `bash tests/postgres-journal.sh` for the
docker-backed PostgreSQL contract.
