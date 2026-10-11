import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSimulatedClock } from "../../matching-core/src/deterministic.mjs";
import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticTradeDirectory,
  exchangeOrderScenario,
  ORDER_PAIRS,
  ORDER_SIDES,
  projectExchangeTrades,
  replayExchangeOrderScenario,
  TRADE_LIQUIDITIES,
  validTradesView
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

const TRADES = "/api/v1/customer/trades";
const TRADE_ID = /^trd_[0-9a-f]{24}$/u;
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

test("synthetic trade directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticTradeDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.trades));
  for (const trade of first.trades) {
    assert.ok(Object.isFrozen(trade));
  }
  assert.equal(first.mode, "test");
  // The scenario's opening acts guarantee at least one maker and one
  // taker leg per subject, so the list is never empty.
  assert.ok(first.trades.length >= 2);
  assert.ok(first.trades.some((trade) => trade.liquidity === "maker"));
  assert.ok(first.trades.some((trade) => trade.liquidity === "taker"));
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const trade of [...first.trades, ...other.trades]) {
    assert.match(trade.trade_id, TRADE_ID);
    assert.match(trade.order_id, ORDER_ID);
    const definition = PAIR_DEFS.get(trade.pair);
    assert.ok(definition !== undefined, trade.pair);
    assert.equal(trade.base_asset, definition.base);
    assert.equal(trade.quote_asset, definition.quote);
    assert.ok(ORDER_SIDES.includes(trade.side));
    assert.ok(TRADE_LIQUIDITIES.includes(trade.liquidity));
    assert.match(trade.price, DECIMAL);
    assert.match(trade.quantity, DECIMAL);
    assert.match(trade.quote_amount, DECIMAL);
    assert.match(trade.fee_amount, DECIMAL);
    assert.match(trade.total_quote_amount, DECIMAL);
    assert.ok(Number.isSafeInteger(trade.fee_bps));
    assert.ok(trade.fee_bps >= 0 && trade.fee_bps <= 1000);
    assert.match(trade.executed_at, ISO_TIMESTAMP);
    assert.equal(trade.execution, "not_supported");
    assert.equal(trade.posting, "none");
    // Derived amounts recompute against the fill's fixed price: the quote
    // leg is the executed quantity at that price, the fee is charged on
    // it, and the total stays on the customer-unfriendly side.
    assert.ok(Number(trade.price) > 0);
    assert.ok(Number(trade.quantity) > 0);
    assert.ok(Number(trade.fee_amount) > 0);
    if (trade.side === "buy") {
      assert.ok(Number(trade.total_quote_amount) > Number(trade.quote_amount));
    } else {
      assert.ok(Number(trade.total_quote_amount) < Number(trade.quote_amount));
    }
  }
});

test("every derived view conforms to the declared TradesView schema", async () => {
  const directory = createSyntheticTradeDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/TradesView" }, { ...view }), [], subject);
  }
});

test("synthetic trade views cover every declared pair, side and liquidity", async () => {
  const directory = createSyntheticTradeDirectory();
  const pairs = new Set();
  const sides = new Set();
  const liquidities = new Set();
  for (
    let index = 0;
    index < 192 &&
    (pairs.size < ORDER_PAIRS.length ||
      sides.size < ORDER_SIDES.length ||
      liquidities.size < TRADE_LIQUIDITIES.length);
    index += 1
  ) {
    const view = await directory.listFor(`syn_cust_trade${String(index).padStart(4, "0")}`);
    for (const trade of view.trades) {
      pairs.add(trade.pair);
      sides.add(trade.side);
      liquidities.add(trade.liquidity);
    }
  }
  assert.deepEqual([...pairs].sort(), [...ORDER_PAIRS.map((definition) => definition.pair)].sort());
  assert.deepEqual([...sides].sort(), [...ORDER_SIDES].sort());
  assert.deepEqual([...liquidities].sort(), [...TRADE_LIQUIDITIES].sort());
});

test("trades sort newest-first and carry unique fill ids per subject", async () => {
  const directory = createSyntheticTradeDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_trade0042"]) {
    const view = await directory.listFor(subject);
    const ids = view.trades.map((trade) => trade.trade_id);
    assert.equal(new Set(ids).size, ids.length, subject);
    const stamps = view.trades.map((trade) => trade.executed_at);
    assert.deepEqual(stamps, [...stamps].sort().reverse(), subject);
  }
});

test("validTradesView fails closed on directory drift", () => {
  const entry = {
    trade_id: "trd_0123456789abcdef01234567",
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "buy",
    liquidity: "maker",
    price: "90.00000000",
    quantity: "100.000000",
    quote_amount: "9000.00",
    fee_bps: 25,
    fee_amount: "22.50",
    total_quote_amount: "9022.50",
    executed_at: "2026-09-01T00:00:10.000Z",
    execution: "not_supported",
    posting: "none"
  };
  assert.equal(validTradesView({ mode: "test", trades: [entry] }), true);
  assert.equal(validTradesView({ mode: "test", trades: [] }), true);
  const bad = [
    null,
    "trades",
    {},
    { mode: "test" },
    { mode: "live", trades: [] },
    { mode: "test", trades: null },
    { mode: "test", trades: [], extra: true },
    { mode: "test", trades: [{ ...entry, extra: "x" }] },
    { mode: "test", trades: [{ ...entry, trade_id: "fll_0123456789abcdef01234567" }] },
    { mode: "test", trades: [{ ...entry, order_id: "order_0123456789abcdef01234567" }] },
    { mode: "test", trades: [{ ...entry, pair: "USDT/EUR" }] },
    { mode: "test", trades: [{ ...entry, base_asset: "TON" }] },
    { mode: "test", trades: [{ ...entry, side: "swap" }] },
    { mode: "test", trades: [{ ...entry, liquidity: "aggressor" }] },
    { mode: "test", trades: [{ ...entry, quantity: 100 }] },
    { mode: "test", trades: [{ ...entry, price: "90,00000000" }] },
    { mode: "test", trades: [{ ...entry, price: "90.001" }] },
    { mode: "test", trades: [{ ...entry, quote_amount: "9000.9" }] },
    { mode: "test", trades: [{ ...entry, quote_amount: "8999.99" }] },
    { mode: "test", trades: [{ ...entry, fee_bps: -1 }] },
    { mode: "test", trades: [{ ...entry, fee_bps: 1001 }] },
    { mode: "test", trades: [{ ...entry, fee_bps: 2.5 }] },
    { mode: "test", trades: [{ ...entry, fee_amount: "-2.26" }] },
    { mode: "test", trades: [{ ...entry, total_quote_amount: "0.00" }] },
    { mode: "test", trades: [{ ...entry, executed_at: "soon" }] },
    { mode: "test", trades: [{ ...entry, executed_at: "2026-09-01T00:00:10+00:00" }] },
    { mode: "test", trades: [{ ...entry, execution: "supported" }] },
    { mode: "test", trades: [{ ...entry, posting: "ledger" }] },
    { mode: "test", trades: [["fll_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validTradesView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/trades returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticTradeDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: TRADES, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, trades: [...expected.trades] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: TRADES, headers: verifiedCustomerHeaders() });
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
        path: TRADES,
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
      path: TRADES,
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
        path: TRADES,
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
    const response = await checkedRequest(port, { path: TRADES, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: TRADES, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: TRADES, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: TRADES, headers: customerHeaders() })).status, 403);
  });
});

test("trade and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { tradeDirectory: { async listFor() { throw new Error("trade store exploded: secret=abc"); } } },
    { tradeDirectory: { async listFor() { return { trades: "nope" }; } } },
    { tradeDirectory: { async listFor() { return { mode: "test", trades: [], extra: "x" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: TRADES, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("trade subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/trades/",
      "/api/v1/customer/trades/1",
      "/api/v1/customer/trades/trd_000000000000000000000001",
      "/api/v1/customer/trades/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: TRADES, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});

test("trade views are projections of the same matching engine replay as the orders read", async () => {
  const directory = createSyntheticTradeDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_order0007", "syn_cust_order0013"]) {
    const scenario = exchangeOrderScenario(subject);
    // Replaying the same scenario on an independent engine instance must
    // yield the directory's view exactly: the trades read is a second
    // projection of the identical replay — the scenario carries every
    // input the engine saw.
    const engine = replayExchangeOrderScenario(scenario);
    const replayed = {
      mode: "test",
      trades: projectExchangeTrades(engine, scenario.intents).slice().reverse()
    };
    assert.deepEqual(await directory.listFor(subject), replayed, subject);
    assert.ok(replayed.trades.length >= 2, subject);
  }
});

test("a partial sweep projects a maker trade row for the resting order", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
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
  const rows = projectExchangeTrades(engine, [
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
  const row = rows[0];
  assert.equal(row.order_id, "ord_0123456789abcdef01234567");
  assert.equal(row.liquidity, "maker");
  assert.equal(row.side, "sell");
  // The trade's price/quantity are the fill's own: 4 units crossed at the
  // resting maker's 90.00000000, not the intent's 10.
  assert.equal(row.price, "90.00000000");
  assert.equal(row.quantity, "4.000000");
  assert.equal(row.quote_amount, "360.00");
  assert.equal(row.fee_amount, "0.90");
  assert.equal(row.total_quote_amount, "359.10");
  assert.match(row.trade_id, TRADE_ID);
  assert.equal(validTradesView({ mode: "test", trades: rows }), true);
});

test("a sweeping taker leg projects a taker trade row", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder({
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "mm_pin"
  });
  engine.submitOrder({
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "cust_pin"
  });
  const rows = projectExchangeTrades(engine, [
    {
      order_id: "ord_0123456789abcdef01234567",
      pair: "USDT/RUB",
      side: "buy",
      order_type: "market",
      price: "90.00000000",
      quantity: "4.000000",
      fee_bps: 25,
      expires: false
    }
  ]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.liquidity, "taker");
  assert.equal(row.side, "buy");
  assert.equal(row.price, "90.00000000");
  assert.equal(row.quantity, "4.000000");
  assert.equal(row.quote_amount, "360.00");
  assert.equal(row.fee_amount, "0.90");
  assert.equal(row.total_quote_amount, "360.90");
  assert.equal(validTradesView({ mode: "test", trades: rows }), true);
});

test("counterparty-only fills and untracked legs are never the subject's trades", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  engine.submitOrder({
    order_id: "ord_0000000000000000000000aa",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "mm_a"
  });
  engine.submitOrder({
    order_id: "ord_0000000000000000000000bb",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "mm_b"
  });
  // The fill happened — but neither leg belongs to the subject.
  const rows = projectExchangeTrades(engine, []);
  assert.deepEqual(rows, []);
  // A subject intent resting untouched records no trade either.
  engine.submitOrder({
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "95.00000000",
    quantity: "1.000000",
    owner: "cust_pin"
  });
  const stillEmpty = projectExchangeTrades(engine, [
    {
      order_id: "ord_0123456789abcdef01234567",
      pair: "USDT/RUB",
      side: "sell",
      order_type: "limit",
      price: "95.00000000",
      quantity: "1.000000",
      fee_bps: 25,
      expires: false
    }
  ]);
  assert.deepEqual(stillEmpty, []);
});

test("subjects see only their own legs — the trade sets are disjoint", async () => {
  const directory = createSyntheticTradeDirectory();
  const first = await directory.listFor(SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  const firstOrders = new Set(first.trades.map((trade) => trade.order_id));
  for (const trade of second.trades) {
    assert.ok(!firstOrders.has(trade.order_id), trade.order_id);
  }
  // Journals (and therefore the fills they record) never overlap either.
  const firstEngine = replayExchangeOrderScenario(exchangeOrderScenario(SUBJECT));
  const secondEngine = replayExchangeOrderScenario(exchangeOrderScenario(VERIFIED_SUBJECT));
  assert.notDeepEqual(firstEngine.journal(), secondEngine.journal());
});

test("the directory retains no per-subject engine or cache across calls", async () => {
  const directory = createSyntheticTradeDirectory();
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
