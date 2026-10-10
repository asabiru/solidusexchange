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

- Limit orders only, identified by `order_id` matching `ord_[0-9a-f]{24}`.
- Price/time priority: a better-priced order always matches first; within a
  price level orders match FIFO in acceptance order.
- Partial fills are fully supported; an incoming order sweeps as many price
  levels as its limit allows.
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

## Events

`submitOrder` / `cancelOrder` return the events they produced, in order.
Every event is a frozen record `{ seq, at, type, order_id, instrument,
side, posting, ... }` with `posting: "none"`. `seq` is a strictly
increasing engine-scoped integer; `at` comes from the injected clock
(default: a fixed simulated epoch — never the wall clock).

| Type | Meaning | Extra fields |
| --- | --- | --- |
| `accepted` | Order passed validation and entered matching | `price`, `quantity` |
| `filled` | This order's remainder reached zero in one execution | `fill_id`, `maker_order_id`, `taker_order_id`, `price`, `quantity`, `remaining_quantity` |
| `partially_filled` | This order still has remainder after one execution | same as `filled` |
| `resting` | Order remainder entered the book | `price`, `quantity` |
| `cancelled` | Resting order removed by id | `price`, `quantity` (removed remainder) |
| `rejected` | Submission or cancel refused | `reason` (see below), plus `quantity` for a self-trade remainder |

Each execution emits at most two events sharing one `fill_id`
(`fll_` + 24 hex): the maker's event first, then the taker's — each is
`filled` or `partially_filled` depending on that order's own remainder.

Rejection reasons: `invalid_order`, `invalid_order_id`,
`invalid_instrument`, `unknown_instrument`, `invalid_side`,
`invalid_owner`, `invalid_price`, `non_positive_price`,
`invalid_quantity`, `non_positive_quantity`, `duplicate_order_id`,
`self_trade`, `order_not_resting`.

Rejected submissions do not consume order ids; a resubmission of the same
id is judged on its own merits. Cancelling an id that is not resting —
unknown, filled, cancelled or rejected — is rejected `order_not_resting`.

## API

```js
import { createMatchingEngine, createSimulatedClock } from "@solidchange/matching-core";

const clock = createSimulatedClock();
const engine = createMatchingEngine({ clock });

engine.submitOrder({ order_id: "ord_…", instrument: "USDT/RUB", side: "sell",
                     price: "90.5", quantity: "4", owner: "desk-a" });
engine.submitOrder({ order_id: "ord_…", instrument: "USDT/RUB", side: "buy",
                     price: "91", quantity: "10" });
engine.bookSnapshot("USDT/RUB");   // { instrument, bids: [...], asks: [...] }
engine.cancelOrder("USDT/RUB", "ord_…");
engine.orderStatus("ord_…");       // tracked state or null
```

`createMatchingEngine({ instruments })` accepts a custom instrument list;
each entry must be a well-formed `BASE/QUOTE` definition.

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
`npm test`, `npm run build` (emits `.d.mts` declarations to `dist/`).
