import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSimulatedClock } from "../../matching-core/src/deterministic.mjs";
import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticExchangeOrderDirectory,
  exchangeOrderScenario,
  ORDER_PAIRS,
  ORDER_SIDES,
  ORDER_STATUSES,
  ORDER_TYPES,
  projectExchangeOrders,
  replayExchangeOrderScenario,
  validExchangeOrdersView
} from "../src/exchange-orders.mjs";
import {
  checkedRequest,
  customerHeaders,
  header,
  NOW_MS,
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
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const PAIR_DEFS = new Map(ORDER_PAIRS.map((definition) => [definition.pair, definition]));

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic exchange order directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.orders));
  for (const order of first.orders) {
    assert.ok(Object.isFrozen(order));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.orders.length >= 1);
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const order of [...first.orders, ...other.orders]) {
    assert.match(order.order_id, ORDER_ID);
    const definition = PAIR_DEFS.get(order.pair);
    assert.ok(definition !== undefined, order.pair);
    assert.equal(order.base_asset, definition.base);
    assert.equal(order.quote_asset, definition.quote);
    assert.ok(ORDER_SIDES.includes(order.side));
    assert.ok(ORDER_TYPES.includes(order.order_type));
    assert.ok(ORDER_STATUSES.includes(order.status));
    assert.match(order.base_amount, DECIMAL);
    assert.match(order.price, DECIMAL);
    assert.match(order.quote_amount, DECIMAL);
    assert.match(order.fee_amount, DECIMAL);
    assert.match(order.total_quote_amount, DECIMAL);
    assert.ok(Number.isSafeInteger(order.fee_bps));
    assert.ok(order.fee_bps >= 0 && order.fee_bps <= 1000);
    assert.match(order.created_at, ISO_TIMESTAMP);
    assert.match(order.updated_at, ISO_TIMESTAMP);
    // Lifecycle coherence mirrors the synthetic book: a resting open order
    // has never changed and a terminal order updates at or after creation.
    const created = Date.parse(order.created_at);
    const updated = Date.parse(order.updated_at);
    assert.ok(updated >= created);
    if (order.status === "open") {
      assert.equal(updated, created);
    }
    assert.equal(order.execution, "not_supported");
    assert.equal(order.posting, "none");
    // Derived amounts recompute against the order's fixed price: the quote
    // leg is the base amount at that price, the fee is charged on it, and
    // the total stays on the customer-unfriendly side.
    assert.ok(Number(order.price) > 0);
    assert.ok(Number(order.fee_amount) > 0);
    if (order.side === "buy") {
      assert.ok(Number(order.total_quote_amount) > Number(order.quote_amount));
    } else {
      assert.ok(Number(order.total_quote_amount) < Number(order.quote_amount));
    }
  }
});

test("every derived view conforms to the declared ExchangeOrdersView schema", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/ExchangeOrdersView" }, { ...view }), [], subject);
  }
});

test("synthetic exchange order views cover every declared pair, side, type and status", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const pairs = new Set();
  const sides = new Set();
  const types = new Set();
  const statuses = new Set();
  for (
    let index = 0;
    index < 192 &&
    (pairs.size < ORDER_PAIRS.length ||
      sides.size < ORDER_SIDES.length ||
      types.size < ORDER_TYPES.length ||
      statuses.size < ORDER_STATUSES.length);
    index += 1
  ) {
    const view = await directory.listFor(`syn_cust_order${String(index).padStart(4, "0")}`);
    for (const order of view.orders) {
      pairs.add(order.pair);
      sides.add(order.side);
      types.add(order.order_type);
      statuses.add(order.status);
    }
  }
  assert.deepEqual([...pairs].sort(), [...ORDER_PAIRS.map((definition) => definition.pair)].sort());
  assert.deepEqual([...sides].sort(), [...ORDER_SIDES].sort());
  assert.deepEqual([...types].sort(), [...ORDER_TYPES].sort());
  assert.deepEqual([...statuses].sort(), [...ORDER_STATUSES].sort());
});

test("validExchangeOrdersView fails closed on directory drift", () => {
  const entry = {
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "buy",
    order_type: "limit",
    base_amount: "100.000000",
    price: "90.00000000",
    quote_amount: "9000.00",
    fee_bps: 25,
    fee_amount: "22.50",
    total_quote_amount: "9022.50",
    status: "open",
    created_at: "2026-09-01T00:00:10.000Z",
    updated_at: "2026-09-01T00:00:10.000Z",
    execution: "not_supported",
    posting: "none"
  };
  assert.equal(validExchangeOrdersView({ mode: "test", orders: [entry] }), true);
  const bad = [
    null,
    "orders",
    {},
    { mode: "test" },
    { mode: "live", orders: [] },
    { mode: "test", orders: null },
    { mode: "test", orders: [], extra: true },
    { mode: "test", orders: [{ ...entry, extra: "x" }] },
    { mode: "test", orders: [{ ...entry, order_id: "order_0123456789abcdef01234567" }] },
    { mode: "test", orders: [{ ...entry, pair: "USDT/EUR" }] },
    { mode: "test", orders: [{ ...entry, base_asset: "TON" }] },
    { mode: "test", orders: [{ ...entry, side: "swap" }] },
    { mode: "test", orders: [{ ...entry, order_type: "stop" }] },
    { mode: "test", orders: [{ ...entry, base_amount: 100 }] },
    { mode: "test", orders: [{ ...entry, price: "90,00000000" }] },
    { mode: "test", orders: [{ ...entry, price: "90.001" }] },
    { mode: "test", orders: [{ ...entry, quote_amount: "9000.9" }] },
    { mode: "test", orders: [{ ...entry, quote_amount: "8999.99" }] },
    { mode: "test", orders: [{ ...entry, fee_bps: -1 }] },
    { mode: "test", orders: [{ ...entry, fee_bps: 1001 }] },
    { mode: "test", orders: [{ ...entry, fee_bps: 2.5 }] },
    { mode: "test", orders: [{ ...entry, fee_amount: "-2.26" }] },
    { mode: "test", orders: [{ ...entry, total_quote_amount: "0.00" }] },
    { mode: "test", orders: [{ ...entry, status: "filled" }] },
    { mode: "test", orders: [{ ...entry, status: "open", updated_at: "2026-09-01T00:00:11.000Z" }] },
    { mode: "test", orders: [{ ...entry, status: "cancelled", updated_at: "2026-09-01T00:00:09.000Z" }] },
    { mode: "test", orders: [{ ...entry, created_at: "soon" }] },
    { mode: "test", orders: [{ ...entry, updated_at: "2026-09-01T00:00:10+00:00" }] },
    { mode: "test", orders: [{ ...entry, execution: "supported" }] },
    { mode: "test", orders: [{ ...entry, posting: "ledger" }] },
    { mode: "test", orders: [["ord_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validExchangeOrdersView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/exchange-orders returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticExchangeOrderDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, orders: [...expected.orders] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(repeat.body, response.body);
  });
});

test("unverified and pending customers are denied with the 403 envelope", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    for (const subject of [SUBJECT, "syn_cust_pending01", "syn_cust_unknown01"]) {
      const response = await checkedRequest(port, {
        path: EXCHANGE_ORDERS,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 403, subject);
      const body = JSON.parse(response.body);
      assert.equal(body.code, "CAPABILITY_DENIED");
      assert.equal(body.request_id, REQUEST_ID);
      assert.deepEqual(body.details, {});
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
    }
    const verified = await checkedRequest(port, {
      path: EXCHANGE_ORDERS,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(verified.status, 200);
  });
});

test("unauthenticated and non-customer tokens are rejected like the sibling reads", async () => {
  await withServer({}, async (port) => {
    const valid = token({ subject: VERIFIED_SUBJECT });
    const rejected = [
      null,
      "Bearer",
      `Bearer ${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, key: "b".repeat(64) })}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 0 })}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 3601 })}`,
      `Bearer ${valid.replace("scdev1", "scdev2")}`
    ];
    for (const value of rejected) {
      const response = await checkedRequest(port, {
        path: EXCHANGE_ORDERS,
        headers: verifiedCustomerHeaders({ Authorization: value })
      });
      assert.equal(response.status, 401, String(value));
      assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
      assert.equal(header(response, "www-authenticate"), "Bearer");
    }
  });
  const operator = {
    async verify() {
      return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
    }
  };
  await withServer({ verifier: operator }, async (port) => {
    const response = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: customerHeaders() })).status, 403);
  });
});

test("exchange order and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { exchangeOrderDirectory: { async listFor() { throw new Error("order store exploded: secret=abc"); }, async orderFor() { return null; } } },
    { exchangeOrderDirectory: { async listFor() { return { orders: "nope" }; }, async orderFor() { return null; } } },
    { exchangeOrderDirectory: { async listFor() { return { mode: "test", orders: [], extra: "x" }; }, async orderFor() { return null; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("exchange order subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/exchange-orders/",
      "/api/v1/customer/exchange-orders/1",
      "/api/v1/customer/exchange-orders/ord_000000000000000000000001",
      "/api/v1/customer/exchange-orders/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});

test("exchange order views are projections of a real matching engine replay", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_order0007", "syn_cust_order0013"]) {
    const scenario = exchangeOrderScenario(subject);
    // Replaying the same scenario on an independent engine instance must
    // yield the directory's view exactly: the read is a pure projection
    // of engine state — the scenario carries every input the engine saw.
    const clock = createSimulatedClock(scenario.start_seconds);
    const engine = createMatchingEngine({ clock });
    for (const step of scenario.steps) {
      if (step.op === "advance") {
        clock.advance(step.seconds);
      } else if (step.op === "submit") {
        engine.submitOrder(step.input);
      } else {
        engine.cancelOrder(step.instrument, step.order_id);
      }
    }
    const replayed = {
      mode: "test",
      orders: projectExchangeOrders(engine, scenario.intents).slice().reverse()
    };
    assert.deepEqual(await directory.listFor(subject), replayed, subject);
  }
});

test("the per-subject scenario is a pure deterministic function", () => {
  assert.deepEqual(exchangeOrderScenario(VERIFIED_SUBJECT), exchangeOrderScenario(VERIFIED_SUBJECT));
  assert.notDeepEqual(exchangeOrderScenario(VERIFIED_SUBJECT), exchangeOrderScenario(SUBJECT));
});

test("different subjects replay into different engine state", () => {
  // Subject isolation: each scenario replays its own orders and
  // counterparty liquidity — the journals (and therefore the books) can
  // never overlap.
  const first = replayExchangeOrderScenario(exchangeOrderScenario(SUBJECT));
  const second = replayExchangeOrderScenario(exchangeOrderScenario(VERIFIED_SUBJECT));
  assert.notDeepEqual(first.journal(), second.journal());
});

test("a partially filled resting order reports its reduced remaining quantity", () => {
  const engine = createMatchingEngine({ clock: createSimulatedClock(1_772_380_800) });
  engine.submitOrder({
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "cust_pin"
  });
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "mm_pin"
  });
  const rows = projectExchangeOrders(engine, [
    {
      order_id: "ord_0123456789abcdef01234567",
      pair: "USDT/RUB",
      side: "sell",
      order_type: "limit",
      price: "90.00000000",
      quantity: "10.000000",
      fee_bps: 25,
      expires: false
    }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "open");
  // 10 placed, 4 executed: the view reports the 6 still resting.
  assert.equal(rows[0].base_amount, "6.000000");
  assert.equal(rows[0].price, "90.00000000");
  assert.equal(rows[0].updated_at, rows[0].created_at);
  assert.equal(validExchangeOrdersView({ mode: "test", orders: rows }), true);
});

test("fully executed orders are excluded — the contract never advertises fills", () => {
  const engine = createMatchingEngine({ clock: createSimulatedClock(1_772_380_800) });
  engine.submitOrder({
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "cust_pin"
  });
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "10.000000",
    owner: "mm_pin"
  });
  const rows = projectExchangeOrders(engine, [
    {
      order_id: "ord_0123456789abcdef01234567",
      pair: "USDT/RUB",
      side: "sell",
      order_type: "limit",
      price: "90.00000000",
      quantity: "10.000000",
      fee_bps: 25,
      expires: false
    }
  ]);
  assert.deepEqual(rows, []);
});

test("engine states map to the contract's four non-executed statuses", () => {
  const engine = createMatchingEngine({ clock: createSimulatedClock(1_772_380_800) });
  // resting -> open
  engine.submitOrder({ order_id: "ord_000000000000000000000001", instrument: "USDT/RUB", side: "sell", type: "limit", price: "90.00000000", quantity: "10.000000", owner: "cust_pin" });
  // cancelled -> cancelled
  engine.submitOrder({ order_id: "ord_000000000000000000000002", instrument: "USDT/RUB", side: "buy", type: "limit", price: "80.00000000", quantity: "5.000000", owner: "cust_pin" });
  engine.cancelOrder("USDT/RUB", "ord_000000000000000000000002");
  // cancelled with the intent's expires flag -> expired (TTL sweep)
  engine.submitOrder({ order_id: "ord_000000000000000000000003", instrument: "TON/RUB", side: "sell", type: "limit", price: "300.00000000", quantity: "7.000000000", owner: "cust_pin" });
  engine.cancelOrder("TON/RUB", "ord_000000000000000000000003");
  // rejected after acceptance: a market order the book cannot serve
  engine.submitOrder({ order_id: "ord_000000000000000000000004", instrument: "TON/USDT", side: "buy", type: "market", quantity: "5.000000000", owner: "cust_pin" });
  // rejected before tracking: the unknown key fails input validation
  engine.submitOrder({ order_id: "ord_000000000000000000000005", instrument: "USDT/RUB", side: "sell", type: "limit", price: "90.00000000", quantity: "1.000000", owner: "cust_pin", note: "bad" });
  // rejected by the self-trade policy: the crossing order meets order 001
  engine.submitOrder({ order_id: "ord_000000000000000000000006", instrument: "USDT/RUB", side: "buy", type: "limit", price: "90.00000000", quantity: "2.000000", owner: "cust_pin" });
  const rows = projectExchangeOrders(engine, [
    { order_id: "ord_000000000000000000000001", pair: "USDT/RUB", side: "sell", order_type: "limit", price: "90.00000000", quantity: "10.000000", fee_bps: 25, expires: false },
    { order_id: "ord_000000000000000000000002", pair: "USDT/RUB", side: "buy", order_type: "limit", price: "80.00000000", quantity: "5.000000", fee_bps: 25, expires: false },
    { order_id: "ord_000000000000000000000003", pair: "TON/RUB", side: "sell", order_type: "limit", price: "300.00000000", quantity: "7.000000000", fee_bps: 25, expires: true },
    { order_id: "ord_000000000000000000000004", pair: "TON/USDT", side: "buy", order_type: "market", price: "3.20000000", quantity: "5.000000000", fee_bps: 25, expires: false },
    { order_id: "ord_000000000000000000000005", pair: "USDT/RUB", side: "sell", order_type: "limit", price: "90.00000000", quantity: "1.000000", fee_bps: 25, expires: false },
    { order_id: "ord_000000000000000000000006", pair: "USDT/RUB", side: "buy", order_type: "limit", price: "90.00000000", quantity: "2.000000", fee_bps: 25, expires: false }
  ]);
  const byId = new Map(rows.map((row) => [row.order_id, row]));
  assert.equal(rows.length, 6);
  assert.equal(byId.get("ord_000000000000000000000001")?.status, "open");
  assert.equal(byId.get("ord_000000000000000000000002")?.status, "cancelled");
  assert.equal(byId.get("ord_000000000000000000000003")?.status, "expired");
  assert.equal(byId.get("ord_000000000000000000000004")?.status, "rejected");
  assert.equal(byId.get("ord_000000000000000000000005")?.status, "rejected");
  assert.equal(byId.get("ord_000000000000000000000006")?.status, "rejected");
  // Removed and refused rows carry the never-executed remainder.
  assert.equal(byId.get("ord_000000000000000000000001")?.base_amount, "10.000000");
  assert.equal(byId.get("ord_000000000000000000000002")?.base_amount, "5.000000");
  assert.equal(byId.get("ord_000000000000000000000003")?.base_amount, "7.000000000");
  assert.equal(byId.get("ord_000000000000000000000004")?.base_amount, "5.000000000");
  assert.equal(byId.get("ord_000000000000000000000006")?.base_amount, "2.000000");
  assert.equal(validExchangeOrdersView({ mode: "test", orders: rows }), true);
});

test("a rejected market order's price is the VWAP of its own fills", () => {
  const engine = createMatchingEngine({ clock: createSimulatedClock(1_772_380_800) });
  // Two thin makers at different prices; the market order sweeps both and
  // its leftover is rejected — the row's price is the fill-weighted mean.
  engine.submitOrder({ order_id: "ord_000000000000000000000011", instrument: "USDT/RUB", side: "sell", type: "limit", price: "90.00000000", quantity: "2.000000", owner: "mm_a" });
  engine.submitOrder({ order_id: "ord_000000000000000000000012", instrument: "USDT/RUB", side: "sell", type: "limit", price: "91.00000000", quantity: "2.000000", owner: "mm_b" });
  engine.submitOrder({ order_id: "ord_000000000000000000000013", instrument: "USDT/RUB", side: "buy", type: "market", quantity: "10.000000", owner: "cust_pin" });
  const rows = projectExchangeOrders(engine, [
    { order_id: "ord_000000000000000000000013", pair: "USDT/RUB", side: "buy", order_type: "market", price: "90.00000000", quantity: "10.000000", fee_bps: 25, expires: false }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "rejected");
  assert.equal(rows[0].base_amount, "6.000000");
  assert.equal(rows[0].price, "90.50000000");
  assert.equal(validExchangeOrdersView({ mode: "test", orders: rows }), true);
});

test("the directory retains no per-subject engine or cache across calls", async () => {
  const directory = createSyntheticExchangeOrderDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  for (let index = 0; index < 48; index += 1) {
    await directory.listFor(`syn_cust_cache_probe_${index}`);
  }
  assert.deepEqual(await directory.listFor(VERIFIED_SUBJECT), first);
  // Structural pin: a per-subject engine memo would be mutable module
  // state — the source holds none at top level.
  const source = readFileSync(new URL("../src/exchange-orders.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^const\s+[A-Z_a-z]+\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\(/mu);
});
