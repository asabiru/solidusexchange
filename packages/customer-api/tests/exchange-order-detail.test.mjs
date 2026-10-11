import assert from "node:assert/strict";
import test from "node:test";

import { createSimulatedClock } from "../../matching-core/src/deterministic.mjs";
import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import {
  createSyntheticExchangeOrderDirectory,
  createSyntheticTradeDirectory,
  exchangeOrderScenario,
  ORDER_DETAIL_STATUSES,
  projectExchangeOrderDetail,
  projectExchangeTrades,
  replayExchangeOrderScenario,
  validExchangeOrderDetailView
} from "../src/exchange-orders.mjs";
import {
  checkedRequest,
  customerHeaders,
  header,
  orderIdFor,
  REQUEST_ID,
  startTestServer,
  stopServer,
  SUBJECT,
  token,
  validator,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const EXCHANGE_ORDERS = "/api/v1/customer/exchange-orders";
const ORDER_ID = /^ord_[0-9a-f]{24}$/u;
const TRADE_ID = /^trd_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const ORDER_DETAIL = `${EXCHANGE_ORDERS}/${await orderIdFor()}`;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

/** @param {Record<string, unknown>} overrides */
function engineLimit(overrides = {}) {
  return {
    order_id: "ord_000000000000000000000001",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "cust_pin",
    ...overrides
  };
}

/** @param {Record<string, unknown>} overrides */
function limitIntent(overrides = {}) {
  return {
    order_id: "ord_000000000000000000000001",
    pair: "USDT/RUB",
    side: "sell",
    order_type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    fee_bps: 25,
    expires: false,
    ...overrides
  };
}

test("the member read projects every intent's detail deterministically and frozen", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const scenario = exchangeOrderScenario(VERIFIED_SUBJECT);
  const engine = replayExchangeOrderScenario(scenario);
  let filled = 0;
  for (const intent of scenario.intents) {
    const detail = await directory.orderFor(VERIFIED_SUBJECT, intent.order_id);
    assert.ok(detail !== null, intent.order_id);
    // The read is the same request-scoped replay: the projection off an
    // independent engine instance must answer the identical row.
    assert.deepEqual(detail, projectExchangeOrderDetail(engine, scenario.intents, intent.order_id));
    assert.ok(Object.isFrozen(detail) && Object.isFrozen(detail.fills));
    for (const fill of detail.fills) {
      assert.ok(Object.isFrozen(fill));
    }
    assert.equal(validExchangeOrderDetailView(detail), true, intent.order_id);
    assert.equal(
      validator.validate({ $ref: "#/components/schemas/ExchangeOrderDetailView" }, { ...detail, fills: [...detail.fills] }).length,
      0,
      intent.order_id
    );
    if (detail.status === "filled") {
      filled += 1;
    }
  }
  // The scenario's opening trade acts and closing ghost acts always fill
  // completely, so every subject serves filled details alongside the
  // never-executed states.
  assert.ok(filled >= 2, "every subject serves filled order details");
});

test("orderFor fails closed for ids the subject does not own", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const scenario = exchangeOrderScenario(VERIFIED_SUBJECT);
  for (const intent of scenario.intents) {
    assert.ok((await directory.orderFor(VERIFIED_SUBJECT, intent.order_id)) !== null);
  }
  // A well-formed but never-minted id, another subject's id and a malformed
  // id all fail closed to null (the router maps null to the pinned 404).
  assert.equal(await directory.orderFor(VERIFIED_SUBJECT, "ord_000000000000000000000000"), null);
  for (const intent of exchangeOrderScenario(SUBJECT).intents) {
    assert.equal(await directory.orderFor(VERIFIED_SUBJECT, intent.order_id), null, intent.order_id);
  }
  assert.equal(await directory.orderFor(VERIFIED_SUBJECT, "not-an-order"), null);
});

test("a detail's shared fields equal its list row's exactly", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const view = await directory.listFor(VERIFIED_SUBJECT);
  for (const row of view.orders) {
    const detail = await directory.orderFor(VERIFIED_SUBJECT, row.order_id);
    assert.ok(detail !== null, row.order_id);
    for (const key of Object.keys(row)) {
      assert.deepEqual(detail[key], row[key], `${row.order_id} ${key}`);
    }
  }
});

test("a resting limit order details open with no fills", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder(engineLimit());
  const detail = projectExchangeOrderDetail(engine, [limitIntent()], "ord_000000000000000000000001");
  assert.ok(detail !== null);
  assert.equal(detail.status, "open");
  assert.equal(detail.base_amount, "10.000000");
  assert.deepEqual(detail.fills, []);
  assert.equal(detail.updated_at, detail.created_at);
  assert.equal(validExchangeOrderDetailView(detail), true);
});

test("a partially filled resting order details its remainder and executed legs", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder(engineLimit());
  clock.advance(60);
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "mm_pin"
  });
  const detail = projectExchangeOrderDetail(engine, [limitIntent()], "ord_000000000000000000000001");
  assert.ok(detail !== null);
  assert.equal(detail.status, "open");
  // 10 placed, 4 executed: the row reports the 6 still resting — the list
  // semantics — while fills shows what already executed.
  assert.equal(detail.base_amount, "6.000000");
  assert.equal(detail.fills.length, 1);
  assert.equal(detail.fills[0].liquidity, "maker");
  assert.equal(detail.fills[0].quantity, "4.000000");
  assert.equal(detail.fills[0].price, "90.00000000");
  assert.match(detail.fills[0].fill_id, TRADE_ID);
  // The resting order still stamps its acceptance while its leg lands
  // after it.
  assert.equal(detail.updated_at, detail.created_at);
  assert.ok(Date.parse(detail.fills[0].executed_at) > Date.parse(detail.created_at));
  assert.equal(validExchangeOrderDetailView(detail), true);
});

test("a fully executed limit order details filled with its legs", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder(engineLimit());
  clock.advance(60);
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "10.000000",
    owner: "mm_pin"
  });
  const detail = projectExchangeOrderDetail(engine, [limitIntent()], "ord_000000000000000000000001");
  assert.ok(detail !== null);
  assert.equal(detail.status, "filled");
  // The detail read serves terminal state: the placed quantity is the
  // amount that executed and the last leg stamps the terminal update.
  assert.equal(detail.base_amount, "10.000000");
  assert.equal(detail.fills.length, 1);
  assert.equal(detail.fills[0].liquidity, "maker");
  assert.equal(detail.updated_at, detail.fills[0].executed_at);
  assert.ok(Date.parse(detail.updated_at) > Date.parse(detail.created_at));
  assert.equal(validExchangeOrderDetailView(detail), true);
});

test("a filled market order details the VWAP of its own legs", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder(
    engineLimit({ order_id: "ord_000000000000000000000011", quantity: "2.000000", owner: "mm_a" })
  );
  engine.submitOrder(
    engineLimit({ order_id: "ord_000000000000000000000012", price: "91.00000000", quantity: "2.000000", owner: "mm_b" })
  );
  clock.advance(60);
  engine.submitOrder({
    order_id: "ord_000000000000000000000013",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "cust_pin"
  });
  const detail = projectExchangeOrderDetail(
    engine,
    [limitIntent({ order_id: "ord_000000000000000000000013", side: "buy", order_type: "market", quantity: "4.000000" })],
    "ord_000000000000000000000013"
  );
  assert.ok(detail !== null);
  assert.equal(detail.status, "filled");
  assert.equal(detail.base_amount, "4.000000");
  assert.equal(detail.price, "90.50000000");
  assert.equal(detail.fills.length, 2);
  for (const fill of detail.fills) {
    assert.equal(fill.liquidity, "taker");
    assert.match(fill.fill_id, TRADE_ID);
  }
  assert.equal(detail.fills[0].price, "90.00000000");
  assert.equal(detail.fills[1].price, "91.00000000");
  assert.equal(validExchangeOrderDetailView(detail), true);
});

test("cancelled, expired and rejected terminal states detail with their legs", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  // Customer cancel of a partial fill: 4 executed then the remainder removed.
  engine.submitOrder(engineLimit({ order_id: "ord_000000000000000000000001" }));
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "mm_pin"
  });
  clock.advance(30);
  engine.cancelOrder("USDT/RUB", "ord_000000000000000000000001");
  // TTL sweep of an untouched order: the intent's expires flag re-labels it.
  engine.submitOrder(engineLimit({ order_id: "ord_000000000000000000000002", quantity: "5.000000" }));
  clock.advance(30);
  engine.cancelOrder("USDT/RUB", "ord_000000000000000000000002");
  // A market order that sweeps a thin maker then rejects its remainder.
  engine.submitOrder(
    engineLimit({ order_id: "ord_000000000000000000000003", quantity: "2.000000", owner: "mm_c" })
  );
  clock.advance(30);
  engine.submitOrder({
    order_id: "ord_000000000000000000000004",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "10.000000",
    owner: "cust_pin"
  });
  // A submission the engine's own validation refuses before tracking.
  engine.submitOrder({ ...engineLimit({ order_id: "ord_000000000000000000000005" }), note: "bad" });
  // The self-trade policy rejects the crossing order.
  engine.submitOrder(engineLimit({ order_id: "ord_000000000000000000000006" }));
  clock.advance(30);
  engine.submitOrder(
    engineLimit({ order_id: "ord_000000000000000000000007", side: "buy", quantity: "2.000000" })
  );
  const intents = [
    limitIntent(),
    limitIntent({ order_id: "ord_000000000000000000000002", quantity: "5.000000", expires: true }),
    limitIntent({ order_id: "ord_000000000000000000000004", side: "buy", order_type: "market", quantity: "10.000000" }),
    limitIntent({ order_id: "ord_000000000000000000000005" }),
    limitIntent({ order_id: "ord_000000000000000000000006" }),
    limitIntent({ order_id: "ord_000000000000000000000007", side: "buy", quantity: "2.000000" })
  ];
  const cancelled = projectExchangeOrderDetail(engine, intents, "ord_000000000000000000000001");
  assert.ok(cancelled !== null);
  assert.equal(cancelled.status, "cancelled");
  // The removed remainder is the never-executed amount; the legs stay.
  assert.equal(cancelled.base_amount, "6.000000");
  assert.equal(cancelled.fills.length, 1);
  assert.equal(cancelled.fills[0].liquidity, "maker");
  assert.ok(Date.parse(cancelled.updated_at) > Date.parse(cancelled.fills[0].executed_at));
  assert.equal(validExchangeOrderDetailView(cancelled), true);
  const expired = projectExchangeOrderDetail(engine, intents, "ord_000000000000000000000002");
  assert.ok(expired !== null);
  assert.equal(expired.status, "expired");
  assert.equal(expired.base_amount, "5.000000");
  assert.deepEqual(expired.fills, []);
  assert.equal(validExchangeOrderDetailView(expired), true);
  const rejected = projectExchangeOrderDetail(engine, intents, "ord_000000000000000000000004");
  assert.ok(rejected !== null);
  assert.equal(rejected.status, "rejected");
  // The refused remainder is the never-executed amount; the sweep's leg
  // stays and fixes the market order's VWAP price.
  assert.equal(rejected.base_amount, "8.000000");
  assert.equal(rejected.price, "90.00000000");
  assert.equal(rejected.fills.length, 1);
  assert.equal(rejected.fills[0].liquidity, "taker");
  assert.equal(validExchangeOrderDetailView(rejected), true);
  const untracked = projectExchangeOrderDetail(engine, intents, "ord_000000000000000000000005");
  assert.ok(untracked !== null);
  assert.equal(untracked.status, "rejected");
  assert.equal(untracked.base_amount, "10.000000");
  assert.deepEqual(untracked.fills, []);
  assert.equal(untracked.created_at, untracked.updated_at);
  assert.equal(validExchangeOrderDetailView(untracked), true);
  const resting = projectExchangeOrderDetail(engine, intents, "ord_000000000000000000000006");
  assert.ok(resting !== null);
  assert.equal(resting.status, "open");
  assert.deepEqual(resting.fills, []);
  const crossed = projectExchangeOrderDetail(engine, intents, "ord_000000000000000000000007");
  assert.ok(crossed !== null);
  assert.equal(crossed.status, "rejected");
  assert.equal(crossed.base_amount, "2.000000");
  assert.deepEqual(crossed.fills, []);
  assert.equal(validExchangeOrderDetailView(crossed), true);
});

test("a detail's fills join one-to-one to the trades read's rows", async () => {
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_order0007"]) {
    const scenario = exchangeOrderScenario(subject);
    const engine = replayExchangeOrderScenario(scenario);
    const trades = projectExchangeTrades(engine, scenario.intents);
    const tradesById = new Map(trades.map((trade) => [trade.trade_id, trade]));
    let joined = 0;
    for (const intent of scenario.intents) {
      const detail = projectExchangeOrderDetail(engine, scenario.intents, intent.order_id);
      assert.ok(detail !== null, intent.order_id);
      // Same journal order on both projections: the fill legs are exactly
      // this order's trade rows, in the same sequence.
      const expected = trades.filter((trade) => trade.order_id === intent.order_id);
      assert.deepEqual(
        detail.fills.map((fill) => fill.fill_id),
        expected.map((trade) => trade.trade_id),
        intent.order_id
      );
      for (const fill of detail.fills) {
        const trade = tradesById.get(fill.fill_id);
        assert.ok(trade, fill.fill_id);
        assert.equal(trade.price, fill.price);
        assert.equal(trade.quantity, fill.quantity);
        assert.equal(trade.liquidity, fill.liquidity);
        assert.equal(trade.executed_at, fill.executed_at);
        joined += 1;
      }
    }
    assert.ok(joined >= 2, `${subject} must have fill legs to join`);
    // And the trades directory's own read answers the same ids.
    const view = await createSyntheticTradeDirectory().listFor(subject);
    assert.deepEqual(view.trades.slice().reverse().map((trade) => trade.trade_id), [...tradesById.keys()]);
  }
});

test("GET /api/v1/customer/exchange-orders/{orderId} serves, gates and fails closed on 404", async () => {
  await withServer({}, async (port) => {
    const detail = await checkedRequest(port, { path: ORDER_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(detail.status, 200);
    const body = JSON.parse(detail.body);
    assert.equal(body.order_id, ORDER_DETAIL.split("/").at(-1));
    assert.equal(header(detail, "x-request-id"), REQUEST_ID);
    assert.equal(header(detail, "cache-control"), "no-store");
    assert.match(body.order_id, ORDER_ID);
    assert.ok(ORDER_DETAIL_STATUSES.includes(body.status));
    assert.ok(Array.isArray(body.fills));
    assert.equal(body.execution, "not_supported");
    assert.equal(body.posting, "none");
    // The scenario's first intent is always a filled limit order: its leg
    // stamps stay ISO and the ids carry the trd_* digest.
    assert.equal(body.status, "filled");
    assert.ok(body.fills.length >= 1);
    for (const fill of body.fills) {
      assert.match(fill.fill_id, TRADE_ID);
      assert.match(fill.executed_at, ISO_TIMESTAMP);
      assert.ok(["maker", "taker"].includes(fill.liquidity));
    }
    assert.deepEqual(
      validator.validate({ $ref: "#/components/schemas/ExchangeOrderDetailView" }, body),
      []
    );
    // Unverified and pending subjects are gated on the member read too.
    for (const headers of [customerHeaders(), customerHeaders({ Authorization: `Bearer ${token({ subject: "syn_cust_pending01" })}` })]) {
      const denied = await checkedRequest(port, { path: ORDER_DETAIL, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
    // Absent and foreign ids fail closed as the pinned 404 envelope — a
    // well-formed id never minted for the subject and an id minted for
    // another subject read identically.
    for (const path of [
      `${EXCHANGE_ORDERS}/ord_000000000000000000000000`,
      `${EXCHANGE_ORDERS}/${await orderIdFor(SUBJECT)}`
    ]) {
      const missing = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(missing.status, 404, path);
      assert.equal(JSON.parse(missing.body).code, "CAPABILITY_DENIED");
    }
    // Malformed ids never route to the order at all.
    for (const path of [
      `${EXCHANGE_ORDERS}/not-an-id`,
      `${EXCHANGE_ORDERS}/ord_`,
      `${EXCHANGE_ORDERS}/ord_X00000000000000000000000`,
      `${EXCHANGE_ORDERS}/trd_0123456789abcdef01234567`
    ]) {
      const missing = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(missing.status, 404, path);
    }
  });
});

test("the member read serves every scenario intent including terminal states", async () => {
  await withServer({}, async (port) => {
    const directory = createSyntheticExchangeOrderDirectory();
    const list = await directory.listFor(VERIFIED_SUBJECT);
    const listed = new Set(list.orders.map((order) => order.order_id));
    for (const intent of exchangeOrderScenario(VERIFIED_SUBJECT).intents) {
      const response = await checkedRequest(port, {
        path: `${EXCHANGE_ORDERS}/${intent.order_id}`,
        headers: verifiedCustomerHeaders()
      });
      assert.equal(response.status, 200, intent.order_id);
      const body = JSON.parse(response.body);
      assert.equal(body.order_id, intent.order_id);
      if (listed.has(intent.order_id)) {
        // An order the collection still advertises keeps the list's four
        // statuses and its fills match the recorded executions.
        assert.notEqual(body.status, "filled");
      } else {
        // Orders the collection excludes — the executed ones — answer
        // their terminal detail.
        assert.equal(body.status, "filled");
      }
    }
  });
});

test("non-GET methods on the member path stay the 404 envelope", async () => {
  await withServer({}, async (port) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: ORDER_DETAIL, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("order detail directory failures and drift return a client-safe 500 envelope", async () => {
  const failures = [
    { exchangeOrderDirectory: { async listFor() { return { mode: "test", orders: [] }; }, async orderFor() { throw new Error("order store exploded: secret=abc"); } } },
    { exchangeOrderDirectory: { async listFor() { return { mode: "test", orders: [] }; }, async orderFor() { return { order_id: "nope" }; } } },
    { exchangeOrderDirectory: { async listFor() { return { mode: "test", orders: [] }; }, async orderFor() { return null; } } }
  ];
  await withServer(failures[0], async (port) => {
    const response = await checkedRequest(port, { path: ORDER_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer(failures[1], async (port) => {
    const response = await checkedRequest(port, { path: ORDER_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  // A directory that mints no detail answers the pinned 404, not 500.
  await withServer(failures[2], async (port) => {
    const response = await checkedRequest(port, { path: ORDER_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 404);
    assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
  });
});

test("validExchangeOrderDetailView fails closed on directory drift", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const good = await directory.orderFor(VERIFIED_SUBJECT, await orderIdFor());
  assert.ok(good !== null);
  assert.equal(good.status, "filled");
  assert.ok(good.fills.length >= 1);
  const leg = good.fills[0];
  const bad = [
    null,
    "order",
    { ...good, extra: "x" },
    { ...good, fills: "yes" },
    { ...good, fills: null },
    { ...good, fills: [{ ...leg, extra: "x" }] },
    { ...good, fills: [{ ...leg, fill_id: "ord_0123456789abcdef01234567" }] },
    { ...good, fills: [{ ...leg, liquidity: "mid" }] },
    { ...good, fills: [{ ...leg, price: "90" }] },
    { ...good, fills: [{ ...leg, quantity: "0.000000" }] },
    { ...good, fills: [{ ...leg, executed_at: "soon" }] },
    { ...good, fills: [{ ...leg, executed_at: "2000-01-01T00:00:00.000Z" }] },
    { ...good, fills: [{ ...leg, executed_at: "2100-01-01T00:00:00.000Z" }] },
    { ...good, fills: [leg, leg] },
    { ...good, status: "pending" },
    { ...good, status: "open" },
    { ...good, fills: [] },
    { ...good, fills: [{ ...leg, quantity: "0.000001" }] },
    { ...good, base_amount: "0.000000" },
    { ...good, quote_amount: "0.01" },
    { ...good, updated_at: good.created_at },
    { ...good, created_at: "soon" },
    { ...good, execution: "supported" },
    { ...good, posting: "ledger" }
  ];
  for (const candidate of bad) {
    assert.equal(validExchangeOrderDetailView(candidate), false, JSON.stringify(candidate));
  }
  // Drift the other way: a resting order's legs may land after its
  // acceptance stamp — updated_at stays pinned while fills keep landing.
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder(engineLimit());
  clock.advance(60);
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "mm_pin"
  });
  const partial = projectExchangeOrderDetail(engine, [limitIntent()], "ord_000000000000000000000001");
  assert.ok(partial !== null);
  assert.equal(partial.status, "open");
  assert.ok(Date.parse(partial.fills[0].executed_at) > Date.parse(partial.updated_at));
  assert.equal(validExchangeOrderDetailView(partial), true);
  // But a terminal order can never carry a leg after its terminal stamp.
  assert.equal(
    validExchangeOrderDetailView({ ...partial, status: "cancelled" }),
    false
  );
  // And a market order's displayed price is its legs' exact VWAP — drift
  // either way fails closed.
  assert.equal(
    validExchangeOrderDetailView({ ...good, price: "1.00000000" }),
    false
  );
});
