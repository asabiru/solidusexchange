import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_PAIRS,
  projectExchangeMarketDepth,
  projectExchangeMarkets,
  projectExchangeOrderDetail,
  projectExchangeOrders,
  projectExchangeTrades,
  validExchangeOrderDetailView
} from "../src/exchange-orders.mjs";

// Wave-76 adversarial audit of the exchange-orders module: each case pins a
// fail-closed guarantee the projections and the member-read validator owe
// the served surface. The stub engines below are scenario-drifted doubles —
// the real matching engine emits complete fill records, so a malformed one
// is drift the projections must refuse rather than silently under-report.

const pairDef = ORDER_PAIRS[0];

const validDetail = (overrides = {}) => ({
  order_id: "ord_000000000000000000000000",
  pair: pairDef.pair,
  base_asset: pairDef.base,
  quote_asset: pairDef.quote,
  side: "buy",
  order_type: "market",
  base_amount: "1.000000",
  price: "90.00000000",
  quote_amount: "90.00",
  fee_bps: 15,
  fee_amount: "0.14",
  total_quote_amount: "90.14",
  status: "open",
  created_at: "2026-09-02T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
  fills: [],
  execution: "not_supported",
  posting: "none",
  ...overrides
});

test("the detail validator rejects market orders in non-terminal states", () => {
  // A market order never rests and is never cancelled or expired: the only
  // observations the member read can serve are "rejected" and "filled".
  // Every other field below is contract-coherent — only the status pin
  // tells the drifted row apart from a real one.
  for (const status of ["open", "cancelled", "expired"]) {
    assert.equal(
      validExchangeOrderDetailView(validDetail({ status })),
      false,
      `market + ${status} must fail closed`
    );
  }
});

test("the detail validator still serves terminal market orders", () => {
  assert.equal(
    validExchangeOrderDetailView(validDetail({ status: "rejected" })),
    true,
    "a rejected market order is a servable observation"
  );
  assert.equal(
    validExchangeOrderDetailView(
      validDetail({
        status: "filled",
        fills: [
          {
            fill_id: "trd_000000000000000000000000",
            liquidity: "taker",
            price: "90.00000000",
            quantity: "1.000000",
            executed_at: "2026-09-02T00:00:00.000Z"
          }
        ]
      })
    ),
    true,
    "a filled market order reports its executed legs"
  );
});

const intent = (overrides = {}) => ({
  order_id: "ord_000000000000000000000000",
  pair: pairDef.pair,
  side: "buy",
  order_type: "limit",
  price: "90.00000000",
  quantity: "1.000000",
  fee_bps: 15,
  expires: false,
  ...overrides
});

const acceptedEvent = (orderId, at = "2026-09-02T00:00:00Z") =>
  Object.freeze({
    order_id: orderId,
    instrument: pairDef.pair,
    side: "buy",
    type: "accepted",
    seq: 1,
    at,
    posting: "none"
  });

const restingStatus = (orderId) => () =>
  Object.freeze({
    order_id: orderId,
    instrument: pairDef.pair,
    side: "buy",
    order_type: "limit",
    price: "90.00000000",
    quantity: "1.000000",
    remaining_quantity: "0.500000",
    state: "resting"
  });

test("a drifted fill event fails closed instead of silently dropping the trade", () => {
  const orderId = intent().order_id;
  // A partially_filled event always carries the maker price on this engine;
  // missing it is journal drift, not a leg to skip.
  const driftedFill = Object.freeze({
    order_id: orderId,
    instrument: pairDef.pair,
    type: "partially_filled",
    seq: 2,
    at: "2026-09-03T00:00:00Z",
    fill_id: "fll_000000000000000000000001",
    maker_order_id: "ord_ffffffffffffffffffffffff",
    taker_order_id: orderId,
    quantity: "0.500000",
    posting: "none"
  });
  const engine = {
    journal: () => Object.freeze([acceptedEvent(orderId), driftedFill]),
    orderStatus: restingStatus(orderId),
    bookSnapshot: () => Object.freeze({ bids: Object.freeze([]), asks: Object.freeze([]) })
  };
  assert.throws(() => projectExchangeTrades(engine, [intent()]), TypeError);
});

test("a fill event whose order id is neither leg fails closed", () => {
  const orderId = intent().order_id;
  // The event claims this order filled but names two other legs: liquidity
  // cannot resolve — a drift the trades read must refuse, not skip.
  const driftedFill = Object.freeze({
    order_id: orderId,
    instrument: pairDef.pair,
    type: "filled",
    seq: 2,
    at: "2026-09-03T00:00:00Z",
    fill_id: "fll_000000000000000000000001",
    maker_order_id: "ord_aaaaaaaaaaaaaaaaaaaaaaaa",
    taker_order_id: "ord_bbbbbbbbbbbbbbbbbbbbbbbb",
    price: "90.00000000",
    quantity: "0.500000",
    posting: "none"
  });
  const engine = {
    journal: () => Object.freeze([acceptedEvent(orderId), driftedFill]),
    orderStatus: restingStatus(orderId),
    bookSnapshot: () => Object.freeze({ bids: Object.freeze([]), asks: Object.freeze([]) })
  };
  assert.throws(() => projectExchangeTrades(engine, [intent()]), TypeError);
  assert.throws(() => projectExchangeOrders(engine, [intent()]), TypeError);
});

test("the detail projection fails closed on a fill leg without leg ids", () => {
  const orderId = intent().order_id;
  const driftedFill = Object.freeze({
    order_id: orderId,
    instrument: pairDef.pair,
    type: "partially_filled",
    seq: 2,
    at: "2026-09-03T00:00:00Z",
    fill_id: "fll_000000000000000000000001",
    price: "90.00000000",
    quantity: "0.500000",
    posting: "none"
  });
  const engine = {
    journal: () => Object.freeze([acceptedEvent(orderId), driftedFill]),
    orderStatus: restingStatus(orderId),
    bookSnapshot: () => Object.freeze({ bids: Object.freeze([]), asks: Object.freeze([]) })
  };
  assert.throws(() => projectExchangeOrderDetail(engine, [intent()], orderId), TypeError);
  assert.throws(() => projectExchangeOrders(engine, [intent()]), TypeError);
});

test("the markets and depth projections fail closed on a drifted last trade", () => {
  // A fill event always carries its instrument on this engine; dropping it
  // would silently erase the subject's real last trade from market data.
  const driftedFill = Object.freeze({
    order_id: "ord_cccccccccccccccccccccccc",
    type: "filled",
    seq: 1,
    at: "2026-09-03T00:00:00Z",
    fill_id: "fll_000000000000000000000001",
    maker_order_id: "ord_cccccccccccccccccccccccc",
    taker_order_id: "ord_dddddddddddddddddddddddd",
    price: "90.00000000",
    quantity: "0.500000",
    posting: "none"
  });
  const engine = {
    journal: () => Object.freeze([driftedFill]),
    orderStatus: () => null,
    bookSnapshot: () => Object.freeze({ bids: Object.freeze([]), asks: Object.freeze([]) })
  };
  const scenario = Object.freeze({
    start_seconds: 1_785_139_200,
    steps: Object.freeze([]),
    intents: Object.freeze([])
  });
  assert.throws(() => projectExchangeMarkets(engine, scenario), TypeError);
  assert.throws(
    () => projectExchangeMarketDepth(engine, scenario, pairDef.pair),
    TypeError
  );
});

test("counterparty fill legs outside the subject's intents stay excluded", () => {
  // A fill between two market makers is honest book data for last_trade but
  // is never one of the subject's trades — the projection keeps skipping
  // only the legs that do not belong to the subject.
  const counterpartyFill = Object.freeze({
    order_id: "ord_eeeeeeeeeeeeeeeeeeeeeeee",
    instrument: pairDef.pair,
    type: "filled",
    seq: 1,
    at: "2026-09-03T00:00:00Z",
    fill_id: "fll_000000000000000000000001",
    maker_order_id: "ord_eeeeeeeeeeeeeeeeeeeeeeee",
    taker_order_id: "ord_dddddddddddddddddddddddd",
    price: "90.00000000",
    quantity: "0.500000",
    posting: "none"
  });
  const engine = {
    journal: () => Object.freeze([counterpartyFill]),
    orderStatus: () => null,
    bookSnapshot: () => Object.freeze({ bids: Object.freeze([]), asks: Object.freeze([]) })
  };
  assert.deepEqual(projectExchangeTrades(engine, [intent()]), []);
});
