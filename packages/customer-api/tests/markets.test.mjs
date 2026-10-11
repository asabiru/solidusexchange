import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSimulatedClock } from "../../matching-core/src/deterministic.mjs";
import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  createSyntheticMarketDirectory,
  exchangeOrderScenario,
  ORDER_PAIRS,
  projectExchangeMarkets,
  replayExchangeOrderScenario,
  validMarketsView
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

const MARKETS = "/api/v1/customer/markets";
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

function submit(engine, input) {
  engine.submitOrder(input);
}

test("synthetic market directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticMarketDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.markets));
  for (const market of first.markets) {
    assert.ok(Object.isFrozen(market));
    if (market.best_bid !== null) assert.ok(Object.isFrozen(market.best_bid));
    if (market.best_ask !== null) assert.ok(Object.isFrozen(market.best_ask));
    if (market.last_trade !== null) assert.ok(Object.isFrozen(market.last_trade));
  }
  assert.equal(first.mode, "test");
  // Every declared pair reports exactly once, in ORDER_PAIRS order.
  assert.deepEqual(
    first.markets.map((market) => market.instrument),
    ORDER_PAIRS.map((definition) => definition.pair)
  );
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const market of [...first.markets, ...other.markets]) {
    const definition = PAIR_DEFS.get(market.instrument);
    assert.ok(definition !== undefined, market.instrument);
    assert.equal(market.base_asset, definition.base);
    assert.equal(market.quote_asset, definition.quote);
    assert.equal(market.base_scale, definition.baseScale);
    assert.equal(market.quote_scale, definition.quoteScale);
    assert.equal(market.price_scale, 8);
    assert.equal(market.posting, "none");
    assert.match(market.as_of, ISO_TIMESTAMP);
    for (const level of [market.best_bid, market.best_ask]) {
      if (level === null) continue;
      assert.match(level.price, DECIMAL);
      assert.match(level.quantity, DECIMAL);
      assert.ok(Number.isSafeInteger(level.order_count) && level.order_count >= 1);
    }
    if (market.last_trade !== null) {
      assert.match(market.last_trade.price, DECIMAL);
      assert.match(market.last_trade.quantity, DECIMAL);
      assert.match(market.last_trade.executed_at, ISO_TIMESTAMP);
      assert.ok(Date.parse(market.last_trade.executed_at) <= Date.parse(market.as_of));
    }
    // The book never rests crossed and the spread is null exactly when a
    // side is empty.
    if (market.best_bid !== null && market.best_ask !== null) {
      assert.ok(Number(market.best_bid.price) < Number(market.best_ask.price));
      assert.ok(Number.isSafeInteger(market.spread_bps) && market.spread_bps >= 0);
    } else {
      assert.equal(market.spread_bps, null);
    }
  }
});

test("every derived view conforms to the declared MarketsView schema", async () => {
  const directory = createSyntheticMarketDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/MarketsView" }, { ...view }), [], subject);
  }
});

test("market views are projections of the same matching engine replay as the orders and trades reads", async () => {
  const directory = createSyntheticMarketDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_order0007", "syn_cust_order0013"]) {
    const scenario = exchangeOrderScenario(subject);
    // Replaying the same scenario on an independent engine instance must
    // yield the directory's view exactly: the markets read is a third
    // projection of the identical replay — the scenario carries every
    // input the engine saw.
    const engine = replayExchangeOrderScenario(scenario);
    const replayed = { mode: "test", markets: projectExchangeMarkets(engine, scenario) };
    assert.deepEqual(await directory.listFor(subject), replayed, subject);
  }
});

test("a resting order's level appears as the instrument's best bid and ask", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  submit(engine, {
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "buy",
    type: "limit",
    price: "89.00000000",
    quantity: "10.000000",
    owner: "cust_pin"
  });
  submit(engine, {
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "91.00000000",
    quantity: "5.000000",
    owner: "mm_pin"
  });
  submit(engine, {
    order_id: "ord_abcdef0123456789abcdef01",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "92.00000000",
    quantity: "7.000000",
    owner: "mm_pin"
  });
  const scenario = { start_seconds: 1_772_380_800, steps: Object.freeze([]), intents: Object.freeze([]) };
  const rows = projectExchangeMarkets(engine, scenario);
  const row = rows.find((market) => market.instrument === "USDT/RUB");
  assert.deepEqual(row.best_bid, { price: "89.00000000", quantity: "10.000000", order_count: 1 });
  assert.deepEqual(row.best_ask, { price: "91.00000000", quantity: "5.000000", order_count: 1 });
  // (91 - 89) * 20_000 / (91 + 89) = 222.22... -> 222 bps half_even.
  assert.equal(row.spread_bps, 222);
  assert.equal(row.last_trade, null);
  assert.equal(row.as_of, "2026-03-01T16:00:00.000Z");
  assert.equal(validMarketsView({ mode: "test", markets: rows }), true);
});

test("the last fill in the book appears as last_trade per instrument", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  submit(engine, {
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "mm_pin"
  });
  submit(engine, {
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "4.000000",
    owner: "cust_pin"
  });
  // A later counterparty fill on the same instrument supersedes it.
  submit(engine, {
    order_id: "ord_abcdef0123456789abcdef01",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "91.00000000",
    quantity: "3.000000",
    owner: "mm_two"
  });
  clock.advance(60);
  submit(engine, {
    order_id: "ord_0123456789abcdef012345ff",
    instrument: "USDT/RUB",
    side: "buy",
    type: "market",
    quantity: "2.000000",
    owner: "cust_two"
  });
  const scenario = { start_seconds: 1_772_380_800, steps: Object.freeze([Object.freeze({ op: "advance", seconds: 60 })]), intents: Object.freeze([]) };
  const rows = projectExchangeMarkets(engine, scenario);
  const row = rows.find((market) => market.instrument === "USDT/RUB");
  // The last fill crossed 2 units at the 90.00000000 maker remnant — the
  // taker sweeps the best ask first, so the 91.00000000 level never
  // traded.
  assert.deepEqual(row.last_trade, {
    price: "90.00000000",
    quantity: "2.000000",
    executed_at: "2026-03-01T16:01:00.000Z"
  });
  // An instrument with no fills reports null.
  const empty = rows.find((market) => market.instrument === "TON/USDT");
  assert.equal(empty.last_trade, null);
  assert.equal(validMarketsView({ mode: "test", markets: rows }), true);
});

test("an empty side reports the level and spread_bps as null", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  submit(engine, {
    order_id: "ord_0123456789abcdef01234567",
    instrument: "TON/RUB",
    side: "buy",
    type: "limit",
    price: "300.00000000",
    quantity: "1.000000000",
    owner: "cust_pin"
  });
  const scenario = { start_seconds: 1_772_380_800, steps: Object.freeze([]), intents: Object.freeze([]) };
  const rows = projectExchangeMarkets(engine, scenario);
  const row = rows.find((market) => market.instrument === "TON/RUB");
  assert.deepEqual(row.best_bid, { price: "300.00000000", quantity: "1.000000000", order_count: 1 });
  assert.equal(row.best_ask, null);
  assert.equal(row.spread_bps, null);
  // A fully empty book nulls both levels.
  const empty = rows.find((market) => market.instrument === "USDT/RUB");
  assert.equal(empty.best_bid, null);
  assert.equal(empty.best_ask, null);
  assert.equal(empty.spread_bps, null);
  assert.equal(empty.last_trade, null);
  assert.equal(validMarketsView({ mode: "test", markets: rows }), true);
});

test("validMarketsView fails closed on directory drift", () => {
  const entry = {
    instrument: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    best_bid: { price: "89.00000000", quantity: "10.000000", order_count: 1 },
    best_ask: { price: "91.00000000", quantity: "5.000000", order_count: 1 },
    last_trade: { price: "90.00000000", quantity: "4.000000", executed_at: "2026-09-01T00:00:10.000Z" },
    spread_bps: 222,
    base_scale: 6,
    quote_scale: 2,
    price_scale: 8,
    as_of: "2026-09-01T00:00:20.000Z",
    posting: "none"
  };
  const viewOf = (markets) => ({ mode: "test", markets });
  const tonRub = { ...entry, instrument: "TON/RUB", base_asset: "TON", best_bid: null, best_ask: null, last_trade: null, spread_bps: null, base_scale: 9 };
  const tonUsdt = { ...entry, instrument: "TON/USDT", base_asset: "TON", quote_asset: "USDT", best_bid: null, best_ask: null, last_trade: null, spread_bps: null, base_scale: 9, quote_scale: 6 };
  const valid = viewOf([entry, tonRub, tonUsdt]);
  assert.equal(validMarketsView(valid), true);
  const bad = [
    null,
    "markets",
    {},
    { mode: "test" },
    { mode: "live", markets: [] },
    { mode: "test", markets: null },
    { mode: "test", markets: [] },
    { mode: "test", markets: [entry] },
    { mode: "test", markets: [entry, tonRub], extra: true },
    viewOf([{ ...entry, extra: "x" }, tonRub, tonUsdt]),
    viewOf([{ ...entry, instrument: "USDT/EUR" }, tonRub, tonUsdt]),
    viewOf([{ ...entry, base_asset: "TON" }, tonRub, tonUsdt]),
    viewOf([{ ...entry, base_scale: 9 }, tonRub, tonUsdt]),
    viewOf([{ ...entry, price_scale: 9 }, tonRub, tonUsdt]),
    viewOf([{ ...entry, spread_bps: 223 }, tonRub, tonUsdt]),
    viewOf([{ ...entry, spread_bps: null }, tonRub, tonUsdt]),
    viewOf([{ ...entry, best_bid: { ...entry.best_bid, order_count: 0 } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, best_bid: { price: "89.00000000", quantity: "10.000000" } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, best_bid: { ...entry.best_bid, price: "89.001" } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, best_bid: { ...entry.best_bid, quantity: "10.000" } }, tonRub, tonUsdt]),
    // A crossed book is impossible on this engine: bid must stay below ask.
    viewOf([{ ...entry, best_bid: { price: "92.00000000", quantity: "1.000000", order_count: 1 } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, last_trade: { ...entry.last_trade, price: "90.000" } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, last_trade: { ...entry.last_trade, extra: "x" } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, last_trade: { ...entry.last_trade, executed_at: "soon" } }, tonRub, tonUsdt]),
    viewOf([{ ...entry, as_of: "soon" }, tonRub, tonUsdt]),
    viewOf([{ ...entry, posting: "ledger" }, tonRub, tonUsdt]),
    // The canonical instrument sequence is pinned: a reorder or a drop
    // fails closed too.
    viewOf([tonRub, entry, tonUsdt]),
    viewOf([entry, entry, tonUsdt])
  ];
  for (const view of bad) {
    assert.equal(validMarketsView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/markets returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticMarketDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, { path: MARKETS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, markets: [...expected.markets] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: MARKETS, headers: verifiedCustomerHeaders() });
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
        path: MARKETS,
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
      path: MARKETS,
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
        path: MARKETS,
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
    const response = await checkedRequest(port, { path: MARKETS, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: MARKETS, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: MARKETS, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: MARKETS, headers: customerHeaders() })).status, 403);
  });
});

test("market and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { marketDirectory: { async listFor() { throw new Error("market store exploded: secret=abc"); }, async depthFor() { return null; } } },
    { marketDirectory: { async listFor() { return { markets: "nope" }; }, async depthFor() { return null; } } },
    { marketDirectory: { async listFor() { return { mode: "test", markets: [], extra: "x" }; }, async depthFor() { return null; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: MARKETS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("market subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/markets/",
      "/api/v1/customer/markets/1",
      "/api/v1/customer/markets/USDT",
      "/api/v1/customer/markets/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: MARKETS, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});

test("subjects derive disjoint books — market views never share engine state", async () => {
  const directory = createSyntheticMarketDirectory();
  const first = await directory.listFor(SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.notDeepEqual(first, second);
  // Journals never overlap, so per-subject books stay subject-scoped.
  const firstEngine = replayExchangeOrderScenario(exchangeOrderScenario(SUBJECT));
  const secondEngine = replayExchangeOrderScenario(exchangeOrderScenario(VERIFIED_SUBJECT));
  assert.notDeepEqual(firstEngine.journal(), secondEngine.journal());
  assert.notDeepEqual(
    firstEngine.bookSnapshot("USDT/RUB"),
    secondEngine.bookSnapshot("USDT/RUB")
  );
});

test("the directory retains no per-subject engine or cache across calls", async () => {
  const directory = createSyntheticMarketDirectory();
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
