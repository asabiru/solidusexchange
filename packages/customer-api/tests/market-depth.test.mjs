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
  MAX_MARKET_DEPTH_LEVELS,
  ORDER_PAIRS,
  projectExchangeMarketDepth,
  replayExchangeOrderScenario,
  validMarketDepthView
} from "../src/exchange-orders.mjs";
import {
  checkedRequest,
  customerHeaders,
  header,
  marketDepthPathFor,
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

const DEPTH = marketDepthPathFor("USDT/RUB");
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

test("synthetic market directory returns deterministic frozen depth views per subject", async () => {
  const directory = createSyntheticMarketDirectory();
  const first = await directory.depthFor(VERIFIED_SUBJECT, "USDT/RUB");
  const second = await directory.depthFor(VERIFIED_SUBJECT, "USDT/RUB");
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.bids) && Object.isFrozen(first.asks));
  for (const level of [...first.bids, ...first.asks]) {
    assert.ok(Object.isFrozen(level));
  }
  if (first.last_trade !== null) assert.ok(Object.isFrozen(first.last_trade));
  assert.equal(first.mode, "test");
  assert.equal(first.posting, "none");
  for (const { pair } of ORDER_PAIRS) {
    const view = await directory.depthFor(VERIFIED_SUBJECT, pair);
    const definition = PAIR_DEFS.get(view.instrument);
    assert.ok(definition !== undefined, view.instrument);
    assert.equal(view.instrument, pair);
    assert.equal(view.base_asset, definition.base);
    assert.equal(view.quote_asset, definition.quote);
    assert.equal(view.mode, "test");
    assert.equal(view.posting, "none");
    assert.match(view.as_of, ISO_TIMESTAMP);
    assert.equal(view.depth_levels, Math.max(view.bids.length, view.asks.length));
    for (const [levels, descending] of [[view.bids, true], [view.asks, false]]) {
      let previous = null;
      for (const level of levels) {
        assert.match(level.price, DECIMAL);
        assert.match(level.quantity, DECIMAL);
        assert.ok(Number.isSafeInteger(level.order_count) && level.order_count >= 1);
        const price = Number(level.price);
        if (previous !== null) {
          assert.ok(descending ? price < previous : price > previous);
        }
        previous = price;
      }
    }
    if (view.bids.length > 0 && view.asks.length > 0) {
      assert.ok(Number(view.bids[0].price) < Number(view.asks[0].price));
    }
    if (view.last_trade !== null) {
      assert.match(view.last_trade.price, DECIMAL);
      assert.match(view.last_trade.quantity, DECIMAL);
      assert.match(view.last_trade.executed_at, ISO_TIMESTAMP);
      assert.ok(Date.parse(view.last_trade.executed_at) <= Date.parse(view.as_of));
    }
  }
});

test("every derived depth view conforms to the declared MarketDepthView schema", async () => {
  const directory = createSyntheticMarketDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    for (const { pair } of ORDER_PAIRS) {
      const view = await directory.depthFor(subject, pair);
      assert.deepEqual(
        validator.validate({ $ref: "#/components/schemas/MarketDepthView" }, { ...view }),
        [],
        `${subject} ${pair}`
      );
    }
  }
});

test("depth views are a fourth projection of the same matching engine replay", async () => {
  const directory = createSyntheticMarketDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_order0007", "syn_cust_order0013"]) {
    const scenario = exchangeOrderScenario(subject);
    // Replaying the same scenario on an independent engine instance must
    // yield the directory's view exactly: the depth read projects the
    // identical replay — the scenario carries every input the engine saw.
    const engine = replayExchangeOrderScenario(scenario);
    for (const { pair } of ORDER_PAIRS) {
      assert.deepEqual(
        await directory.depthFor(subject, pair),
        projectExchangeMarketDepth(engine, scenario, pair),
        `${subject} ${pair}`
      );
    }
  }
});

test("the full resting ladder derives from bookSnapshot, aggregating same-price orders", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  submit(engine, {
    order_id: "ord_0123456789abcdef01234567",
    instrument: "USDT/RUB",
    side: "buy",
    type: "limit",
    price: "89.00000000",
    quantity: "10.000000",
    owner: "mm_pin"
  });
  // Two bids at distinct prices below a second bid at the same best price:
  // same-price orders aggregate into one level with summed quantity.
  submit(engine, {
    order_id: "ord_89abcdef0123456789abcdef",
    instrument: "USDT/RUB",
    side: "buy",
    type: "limit",
    price: "88.00000000",
    quantity: "3.000000",
    owner: "mm_two"
  });
  submit(engine, {
    order_id: "ord_abcdef0123456789abcdef01",
    instrument: "USDT/RUB",
    side: "buy",
    type: "limit",
    price: "89.00000000",
    quantity: "4.000000",
    owner: "mm_three"
  });
  submit(engine, {
    order_id: "ord_0123456789abcdef012345ff",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "91.00000000",
    quantity: "5.000000",
    owner: "mm_pin"
  });
  submit(engine, {
    order_id: "ord_fedcba9876543210fedcba98",
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "92.00000000",
    quantity: "7.000000",
    owner: "mm_pin"
  });
  const scenario = { start_seconds: 1_772_380_800, steps: Object.freeze([]), intents: Object.freeze([]) };
  const view = projectExchangeMarketDepth(engine, scenario, "USDT/RUB");
  // Bids best (highest) price first, asks best (lowest) price first — the
  // markets read's single top level expanded into the full ladder.
  assert.deepEqual(view.bids, [
    { price: "89.00000000", quantity: "14.000000", order_count: 2 },
    { price: "88.00000000", quantity: "3.000000", order_count: 1 }
  ]);
  assert.deepEqual(view.asks, [
    { price: "91.00000000", quantity: "5.000000", order_count: 1 },
    { price: "92.00000000", quantity: "7.000000", order_count: 1 }
  ]);
  assert.equal(view.depth_levels, 2);
  assert.equal(view.last_trade, null);
  assert.equal(view.as_of, "2026-03-01T16:00:00.000Z");
  assert.equal(validMarketDepthView(view), true);
});

test("an empty side reports an empty array, not a null level", () => {
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
  const view = projectExchangeMarketDepth(engine, scenario, "TON/RUB");
  assert.deepEqual(view.bids, [{ price: "300.00000000", quantity: "1.000000000", order_count: 1 }]);
  assert.deepEqual(view.asks, []);
  assert.equal(view.depth_levels, 1);
  // A fully empty book empties both sides — unlike the markets read's
  // nullable top levels, a ladder level is never null.
  const empty = projectExchangeMarketDepth(engine, scenario, "USDT/RUB");
  assert.deepEqual(empty.bids, []);
  assert.deepEqual(empty.asks, []);
  assert.equal(empty.depth_levels, 0);
  assert.equal(empty.last_trade, null);
  assert.equal(validMarketDepthView(view), true);
  assert.equal(validMarketDepthView(empty), true);
});

test("a book deeper than the bound truncates to 16 levels per side and reports the pre-cap count", () => {
  const clock = createSimulatedClock(1_772_380_800);
  const engine = createMatchingEngine({ clock });
  for (let index = 0; index < MAX_MARKET_DEPTH_LEVELS + 4; index += 1) {
    submit(engine, {
      order_id: `ord_${String(index).padStart(24, "0")}`,
      instrument: "USDT/RUB",
      side: "sell",
      type: "limit",
      price: `${(100 + index).toFixed(8)}`,
      quantity: "1.000000",
      owner: "mm_pin"
    });
  }
  const scenario = { start_seconds: 1_772_380_800, steps: Object.freeze([]), intents: Object.freeze([]) };
  const view = projectExchangeMarketDepth(engine, scenario, "USDT/RUB");
  // The ladder serves at most 16 levels per side; depth_levels keeps the
  // book's true resting count so the truncation is observable.
  assert.equal(view.asks.length, MAX_MARKET_DEPTH_LEVELS);
  assert.equal(view.bids.length, 0);
  assert.equal(view.depth_levels, MAX_MARKET_DEPTH_LEVELS + 4);
  assert.equal(view.asks[0].price, "100.00000000");
  assert.equal(view.asks[15].price, "115.00000000");
  assert.equal(validMarketDepthView(view), true);
});

test("the instrument's last fill appears as last_trade like the markets read reports it", () => {
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
  const scenario = { start_seconds: 1_772_380_800, steps: Object.freeze([]), intents: Object.freeze([]) };
  const view = projectExchangeMarketDepth(engine, scenario, "USDT/RUB");
  assert.deepEqual(view.last_trade, {
    price: "90.00000000",
    quantity: "4.000000",
    executed_at: "2026-03-01T16:00:00.000Z"
  });
  // The untouched instrument reports no last trade.
  const empty = projectExchangeMarketDepth(engine, scenario, "TON/USDT");
  assert.equal(empty.last_trade, null);
  assert.equal(validMarketDepthView(view), true);
});

test("depthFor fails closed to null for instruments outside the declared universe", async () => {
  const directory = createSyntheticMarketDirectory();
  for (const instrument of [
    "nope",
    "BTC/USD",
    "usdt-rub",
    "USDT%2FRUB",
    "USDT/RUB/extra",
    "",
    " USDT/RUB ",
    "USDT/RUB "
  ]) {
    assert.equal(await directory.depthFor(VERIFIED_SUBJECT, instrument), null, instrument);
  }
});

test("validMarketDepthView fails closed on directory drift", () => {
  const entry = {
    mode: "test",
    instrument: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    bids: [
      { price: "89.00000000", quantity: "10.000000", order_count: 1 },
      { price: "88.00000000", quantity: "3.000000", order_count: 1 }
    ],
    asks: [
      { price: "91.00000000", quantity: "5.000000", order_count: 1 },
      { price: "92.00000000", quantity: "7.000000", order_count: 1 }
    ],
    last_trade: { price: "90.00000000", quantity: "4.000000", executed_at: "2026-09-01T00:00:10.000Z" },
    depth_levels: 2,
    as_of: "2026-09-01T00:00:20.000Z",
    posting: "none"
  };
  const valid = () => JSON.parse(JSON.stringify(entry));
  assert.equal(validMarketDepthView(valid()), true);
  const bad = [
    null,
    "depth",
    {},
    { ...valid(), mode: "live" },
    { ...valid(), extra: "x" },
    { ...valid(), instrument: "USDT/EUR" },
    { ...valid(), instrument: "usdt-rub" },
    { ...valid(), base_asset: "TON" },
    { ...valid(), quote_asset: "USDT" },
    { ...valid(), bids: "nope" },
    { ...valid(), asks: null },
    { ...valid(), bids: [null, ...entry.bids] },
    // Level shape drift: wrong scale, zero values, order_count drift, an
    // extra key, a repeated price, a non-strict or reversed ordering.
    { ...valid(), bids: [{ ...entry.bids[0], price: "89.001" }, entry.bids[1]], depth_levels: 2 },
    { ...valid(), bids: [{ ...entry.bids[0], quantity: "10.000" }, entry.bids[1]] },
    { ...valid(), bids: [{ ...entry.bids[0], order_count: 0 }, entry.bids[1]] },
    { ...valid(), bids: [{ ...entry.bids[0], extra: "x" }, entry.bids[1]] },
    { ...valid(), bids: [entry.bids[0], entry.bids[0]] },
    { ...valid(), bids: [entry.bids[1], entry.bids[0]] },
    { ...valid(), asks: [entry.asks[1], entry.asks[0]] },
    // A crossed book is impossible on this engine: the best bid must stay
    // strictly below the best ask.
    { ...valid(), bids: [{ price: "93.00000000", quantity: "1.000000", order_count: 1 }, entry.bids[1]] },
    { ...valid(), bids: [{ price: "92.00000000", quantity: "1.000000", order_count: 1 }, entry.bids[1]] },
    // depth_levels must cover the served levels and can only exceed them
    // at the documented cap.
    { ...valid(), depth_levels: 1 },
    { ...valid(), depth_levels: 3 },
    { ...valid(), depth_levels: 99 },
    { ...valid(), depth_levels: "2" },
    // More served levels than the bound allow is impossible.
    {
      ...valid(),
      bids: Array.from({ length: 17 }, (_v, index) => ({
        price: `${(100 - index).toFixed(8)}`,
        quantity: "1.000000",
        order_count: 1
      })),
      depth_levels: 17
    },
    { ...valid(), last_trade: { ...entry.last_trade, price: "90.000" } },
    { ...valid(), last_trade: { ...entry.last_trade, extra: "x" } },
    { ...valid(), last_trade: { ...entry.last_trade, executed_at: "soon" } },
    { ...valid(), last_trade: { ...entry.last_trade, executed_at: "2030-01-01T00:00:00.000Z" } },
    { ...valid(), last_trade: "nope" },
    { ...valid(), as_of: "soon" },
    { ...valid(), posting: "ledger" }
  ];
  for (const view of bad) {
    assert.equal(validMarketDepthView(view), false, JSON.stringify(view));
  }
});

test("GET /api/v1/customer/markets/{instrument} returns the exact synthetic depth view", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticMarketDirectory().depthFor(VERIFIED_SUBJECT, "USDT/RUB");
    const response = await checkedRequest(port, { path: DEPTH, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, { path: DEPTH, headers: verifiedCustomerHeaders() });
    assert.equal(repeat.body, response.body);
    // Every declared instrument answers its own ladder on the encoded
    // wire form; the canonical id inside the body keeps its '/' separator.
    for (const { pair } of ORDER_PAIRS) {
      const view = await checkedRequest(port, {
        path: marketDepthPathFor(pair),
        headers: verifiedCustomerHeaders()
      });
      assert.equal(view.status, 200, pair);
      assert.equal(JSON.parse(view.body).instrument, pair);
    }
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
        path: DEPTH,
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
      path: DEPTH,
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
        path: DEPTH,
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
    const response = await checkedRequest(port, { path: DEPTH, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: DEPTH, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: DEPTH, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal((await checkedRequest(port, { path: DEPTH, headers: customerHeaders() })).status, 403);
  });
});

test("market depth directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { marketDirectory: { async listFor() { return { mode: "test", markets: [] }; }, async depthFor() { throw new Error("depth store exploded: secret=abc"); } } },
    { marketDirectory: { async listFor() { return { mode: "test", markets: [] }; }, async depthFor() { return { bids: "nope" }; } } },
    { marketDirectory: { async listFor() { return { mode: "test", markets: [] }; }, async depthFor() { return { mode: "test", bids: [], asks: [], extra: "x" }; } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: DEPTH, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("unknown and malformed instruments answer the uniform 404", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      // A raw-admitted non-member slug routes, then fails closed like a
      // foreign id — never enumerating which instruments exist.
      "/api/v1/customer/markets/nope",
      "/api/v1/customer/markets/usdt-rub",
      // A well-formed non-member instrument decodes, then fails closed.
      "/api/v1/customer/markets/BTC%2FUSD",
      // A double-encoded id decodes once to a non-id string; a malformed
      // escape never decodes at all.
      "/api/v1/customer/markets/USDT%252FRUB",
      "/api/v1/customer/markets/%ZZ",
      "/api/v1/customer/markets/USDT%2FRUB%2F"
    ]) {
      const response = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, path);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("market depth subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      // The unencoded '/' splits into a seventh segment — no template
      // binds it — and a trailing member segment stays unmatched too.
      "/api/v1/customer/markets/USDT/RUB",
      "/api/v1/customer/markets/USDT%2FRUB/extra"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: DEPTH, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});

test("subjects derive disjoint books — depth views never share engine state", async () => {
  const directory = createSyntheticMarketDirectory();
  const first = await directory.depthFor(SUBJECT, "USDT/RUB");
  const second = await directory.depthFor(VERIFIED_SUBJECT, "USDT/RUB");
  assert.notDeepEqual(first, second);
  // Journals never overlap, so per-subject books stay subject-scoped.
  const firstEngine = replayExchangeOrderScenario(exchangeOrderScenario(SUBJECT));
  const secondEngine = replayExchangeOrderScenario(exchangeOrderScenario(VERIFIED_SUBJECT));
  assert.notDeepEqual(
    firstEngine.bookSnapshot("USDT/RUB"),
    secondEngine.bookSnapshot("USDT/RUB")
  );
});

test("the directory retains no per-subject engine or cache across calls", async () => {
  const directory = createSyntheticMarketDirectory();
  const first = await directory.depthFor(VERIFIED_SUBJECT, "USDT/RUB");
  for (let index = 0; index < 48; index += 1) {
    await directory.depthFor(`syn_cust_cache_probe_${index}`, "USDT/RUB");
  }
  assert.deepEqual(await directory.depthFor(VERIFIED_SUBJECT, "USDT/RUB"), first);
  // Structural pin: a per-subject engine memo would be mutable module
  // state — the source holds none at top level.
  const source = readFileSync(new URL("../src/exchange-orders.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^const\s+[A-Z_a-z]+\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\(/mu);
});
