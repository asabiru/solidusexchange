import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Replay-bridge audit (wave 57): the exchangeOrderScenario ->
// replayExchangeOrderScenario -> projectExchange* chain plus the
// validXView fail-closed surface and the matching-core import seam.
// Each regression case below was accepted by the pre-audit bridge and
// must now be rejected; the pin cases prove the clean classes stay
// clean. See Documentation/regulated-core/exchange-bridge-audit-wave57.md.

import { createSimulatedClock } from "../../matching-core/src/deterministic.mjs";
import { createMatchingEngine } from "../../matching-core/src/engine.mjs";
import {
  createSyntheticExchangeOrderDirectory,
  createSyntheticMarketDirectory,
  createSyntheticTradeDirectory,
  exchangeOrderScenario,
  ORDER_PAIRS,
  projectExchangeMarkets,
  projectExchangeOrders,
  projectExchangeTrades,
  replayExchangeOrderScenario,
  validExchangeOrdersView,
  validMarketsView,
  validTradesView
} from "../src/exchange-orders.mjs";
import {
  checkedRequest,
  customerHeaders,
  startTestServer,
  stopServer,
  SUBJECT,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const EPOCH = 1_772_380_800;
const ORD_1 = "ord_000000000000000000000001";
const ORD_2 = "ord_000000000000000000000002";
const ORD_9 = "ord_000000000000000000000009";
const ORDER_ID = /^ord_[0-9a-f]{24}$/u;
const TRADE_ID = /^trd_[0-9a-f]{24}$/u;
const OWNER_SUBJECT = /^cust_[0-9a-f]{16}$/u;
const OWNER_COUNTERPARTY = /^mm_[0-9a-f]{12}$/u;

const BASE_INTENT = {
  pair: "USDT/RUB",
  side: "sell",
  order_type: "limit",
  price: "90.00000000",
  quantity: "10.000000",
  fee_bps: 25,
  expires: false
};

function limitInput(orderId, extra = {}) {
  return {
    order_id: orderId,
    instrument: "USDT/RUB",
    side: "sell",
    type: "limit",
    price: "90.00000000",
    quantity: "10.000000",
    owner: "cust_pin",
    ...extra
  };
}

function intent(orderId, extra = {}) {
  return { order_id: orderId, ...BASE_INTENT, ...extra };
}

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("a quantity-less terminal echo cannot erase the recorded remainder", () => {
  // Regression: a partially filled order that is cancelled, then hit by a
  // quantity-less terminal echo (a redundant cancel emits
  // order_not_resting, a resubmission emits duplicate_order_id), must keep
  // reporting the remainder the real removal recorded — the projection
  // must not fall back to the placed total and silently "un-execute" fills.
  for (const echo of ["cancel", "submit"]) {
    const engine = createMatchingEngine({ clock: createSimulatedClock(EPOCH) });
    engine.submitOrder(limitInput(ORD_1));
    engine.submitOrder({
      order_id: ORD_2,
      instrument: "USDT/RUB",
      side: "buy",
      type: "market",
      quantity: "6.000000",
      owner: "mm_pin"
    });
    engine.cancelOrder("USDT/RUB", ORD_1);
    if (echo === "cancel") {
      engine.cancelOrder("USDT/RUB", ORD_1);
    } else {
      engine.submitOrder(limitInput(ORD_1));
    }
    const rows = projectExchangeOrders(engine, [intent(ORD_1)]);
    assert.equal(rows.length, 1, echo);
    assert.equal(rows[0].status, "cancelled", echo);
    assert.equal(rows[0].base_amount, "4.000000", echo);
    assert.equal(validExchangeOrdersView({ mode: "test", orders: rows }), true, echo);
  }
});

test("a rejected order keeps the refused remainder through terminal echoes", () => {
  const engine = createMatchingEngine({ clock: createSimulatedClock(EPOCH) });
  // Self-trade rejection: both legs share the owner, so the crossing order
  // is refused with its full remainder, and a later quantity-less echo
  // must not overwrite it.
  engine.submitOrder(limitInput(ORD_1));
  engine.submitOrder({
    order_id: ORD_2,
    instrument: "USDT/RUB",
    side: "buy",
    type: "limit",
    price: "90.00000000",
    quantity: "5.000000",
    owner: "cust_pin"
  });
  engine.cancelOrder("USDT/RUB", ORD_2);
  const rows = projectExchangeOrders(engine, [intent(ORD_1), intent(ORD_2, { side: "buy", quantity: "5.000000" })]);
  const rejected = rows.find((row) => row.order_id === ORD_2);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.base_amount, "5.000000");
  assert.equal(validExchangeOrdersView({ mode: "test", orders: rows }), true);
});

test("replay fails closed on a step op it does not know", () => {
  // Regression: an `amend` op (or any typo'd/new op) used to be silently
  // applied as a cancel — a scenario drift the bridge must not replay.
  const scenario = {
    start_seconds: EPOCH,
    steps: Object.freeze([
      Object.freeze({ op: "submit", input: Object.freeze(limitInput(ORD_9)) }),
      Object.freeze({ op: "amend", instrument: "USDT/RUB", order_id: ORD_9 })
    ]),
    intents: Object.freeze([])
  };
  assert.throws(() => replayExchangeOrderScenario(scenario), /unknown scenario step op/u);
  // The generated op vocabulary still replays exactly: every step a real
  // scenario emits is one of the three declared ops.
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_probe0007"]) {
    const generated = exchangeOrderScenario(subject);
    for (const step of generated.steps) {
      assert.ok(step.op === "advance" || step.op === "submit" || step.op === "cancel", step.op);
    }
  }
});

test("the orders validator rejects a view a projection could never emit", () => {
  // Regression pins: rows that shape-check but violate emission
  // invariants — duplicated order ids and an impossible market-order
  // status (market orders never rest and are never cancelled).
  const directory = createSyntheticExchangeOrderDirectory();
  return directory.listFor(VERIFIED_SUBJECT).then((view) => {
    const row = view.orders[0];
    const duplicated = { mode: "test", orders: [...view.orders, { ...row }] };
    assert.equal(validExchangeOrdersView(duplicated), false);
    assert.equal(validExchangeOrdersView(view), true);
    const marketOpen = { ...row, order_type: "market", status: "open" };
    assert.equal(validExchangeOrdersView({ mode: "test", orders: [marketOpen] }), false);
    const marketCancelled = { ...row, order_type: "market", status: "cancelled" };
    assert.equal(validExchangeOrdersView({ mode: "test", orders: [marketCancelled] }), false);
    const marketExpired = { ...row, order_type: "market", status: "expired" };
    assert.equal(validExchangeOrdersView({ mode: "test", orders: [marketExpired] }), false);
  });
});

test("the trades validator rejects duplicated trade ids", async () => {
  const view = await createSyntheticTradeDirectory().listFor(VERIFIED_SUBJECT);
  const duplicated = { mode: "test", trades: [...view.trades, { ...view.trades[0] }] };
  assert.equal(validTradesView(duplicated), false);
  assert.equal(validTradesView(view), true);
});

test("the markets validator rejects a last trade after the snapshot close", async () => {
  const view = await createSyntheticMarketDirectory().listFor(VERIFIED_SUBJECT);
  const copy = JSON.parse(JSON.stringify(view));
  const row = copy.markets.find((market) => market.last_trade !== null) ?? copy.markets[0];
  row.last_trade = {
    price: "90.00000000",
    quantity: "1.000000",
    executed_at: "2030-01-01T00:00:00.000Z"
  };
  assert.equal(validMarketsView(copy), false);
  // A last trade exactly at the close remains admissible: the final act's
  // submission executes at the session's last second.
  const atClose = JSON.parse(JSON.stringify(view));
  const target = atClose.markets.find((market) => market.last_trade !== null) ?? atClose.markets[0];
  target.last_trade = {
    price: "90.00000000",
    quantity: "1.000000",
    executed_at: target.as_of
  };
  assert.equal(validMarketsView(atClose), true);
  assert.equal(validMarketsView(view), true);
});

test("served reads fail closed on shape-valid content drift", async () => {
  // Regression pin at the serving edge: a directory returning a view that
  // shape-checks but fails derived-value recomputation gets the 500
  // envelope — validation is the gate, not serialization.
  const tamperedOrder = {
    async listFor(subject) {
      const view = await createSyntheticExchangeOrderDirectory().listFor(subject);
      const orders = view.orders.map((order, index) =>
        index === 0 ? { ...order, quote_amount: order.total_quote_amount } : order
      );
      return { ...view, orders };
    },
    async orderFor(subject, orderId) {
      return createSyntheticExchangeOrderDirectory().orderFor(subject, orderId);
    }
  };
  const tamperedTrade = {
    async listFor(subject) {
      const view = await createSyntheticTradeDirectory().listFor(subject);
      const trades = view.trades.map((trade, index) =>
        index === 0 ? { ...trade, fee_amount: trade.total_quote_amount } : trade
      );
      return { ...view, trades };
    }
  };
  const tamperedMarket = {
    async listFor(subject) {
      const view = await createSyntheticMarketDirectory().listFor(subject);
      const markets = view.markets.map((market, index) =>
        index === 0
          ? {
              ...market,
              last_trade: {
                price: "90.00000000",
                quantity: "1.000000",
                executed_at: "2030-01-01T00:00:00.000Z"
              }
            }
          : market
      );
      return { ...view, markets };
    },
    async depthFor(subject, instrument) {
      return createSyntheticMarketDirectory().depthFor(subject, instrument);
    }
  };
  const routes = [
    ["/api/v1/customer/exchange-orders", { exchangeOrderDirectory: tamperedOrder }],
    ["/api/v1/customer/trades", { tradeDirectory: tamperedTrade }],
    ["/api/v1/customer/markets", { marketDirectory: tamperedMarket }]
  ];
  for (const [path, options] of routes) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, path);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    });
  }
});

test("the member read fails closed on shape-valid detail drift", async () => {
  // The detail arm applies its own validExchangeOrderDetailView gate the
  // same way: a shape-valid detail whose legs recompute wrong still hits
  // the 500 envelope.
  const base = createSyntheticExchangeOrderDirectory();
  const real = await base.listFor(VERIFIED_SUBJECT);
  const target = real.orders.at(-1);
  const tamperedDetail = {
    async listFor(subject) {
      return base.listFor(subject);
    },
    async orderFor(subject, orderId) {
      const detail = await base.orderFor(subject, orderId);
      if (detail === null) {
        return null;
      }
      return { ...detail, quote_amount: detail.total_quote_amount };
    }
  };
  await withServer({ exchangeOrderDirectory: tamperedDetail }, async (port) => {
    const response = await checkedRequest(port, {
      path: `/api/v1/customer/exchange-orders/${target.order_id}`,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
  });
});

test("the ORDER_PAIRS / INSTRUMENTS drift check throws at module load", () => {
  // The bridge pins the engine registry against ORDER_PAIRS at import:
  // a drifted registry must fail the module instead of mis-pricing views.
  // Proven by loading the module in a subprocess against a patched copy.
  const root = mkdtempSync(join(tmpdir(), "bridge-drift-"));
  const bridgeDir = join(root, "packages/customer-api/src");
  const coreDir = join(root, "packages/matching-core/src");
  mkdirSync(bridgeDir, { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  const repoBridge = fileURLToPath(new URL("../src/exchange-orders.mjs", import.meta.url));
  const repoCore = fileURLToPath(new URL("../../matching-core/src", import.meta.url));
  // cpSync's Windows override path (fs.cp native binding) fails to overwrite
  // a destination whose parent tree came from mkdtempSync under a non-ASCII
  // source path — copyFileSync keeps the file-to-file semantics everywhere.
  copyFileSync(repoBridge, join(bridgeDir, "exchange-orders.mjs"));
  for (const name of [
    "book.mjs",
    "decimal.mjs",
    "deterministic.mjs",
    "engine.mjs",
    "events.mjs",
    "instruments.mjs",
    "journal-store.mjs",
    "snapshot.mjs"
  ]) {
    copyFileSync(join(repoCore, name), join(coreDir, name));
  }
  const entry = join(root, "entry.mjs");
  writeFileSync(entry, `import ${JSON.stringify(`file://${join(bridgeDir, "exchange-orders.mjs")}`)};\n`);
  const healthy = spawnSync(process.execPath, [entry], { encoding: "utf8" });
  assert.equal(healthy.status, 0, healthy.stderr);
  // A changed scale and a missing registry entry each trip the check.
  const instrumentsPath = join(coreDir, "instruments.mjs");
  for (const mutate of [
    (text) => text.replace("base_scale: 6", "base_scale: 7"),
    (text) => text.replace(/^\s*Object\.freeze\(\{ instrument: "TON\/USDT"[^\n]*\n?/mu, "")
  ]) {
    writeFileSync(instrumentsPath, mutate(readFileSync(instrumentsPath, "utf8")));
    const drifted = spawnSync(process.execPath, [entry], { encoding: "utf8" });
    assert.notEqual(drifted.status, 0);
    assert.match(drifted.stderr, /instrument registry drifted/u);
    copyFileSync(join(repoCore, "instruments.mjs"), instrumentsPath);
  }
});

test("scenario actors stay namespaced: counterparty liquidity is never the subject's", () => {
  // Pin: every subject intent id is an `ord_*` minted under `id:` salts,
  // every counterparty submission carries an `mm_*` owner distinct from
  // the subject's `cust_*` owner, and no counterparty id ever collides
  // with a subject intent id — the engine's self-trade policy can only
  // fire inside the subject's own submissions.
  const idPattern = /^[a-z_]+_[0-9a-f]{12,24}$/u;
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_probe0013", "syn_cust_probe0042"]) {
    const scenario = exchangeOrderScenario(subject);
    const intentIds = new Set(scenario.intents.map((item) => item.order_id));
    assert.equal(intentIds.size, scenario.intents.length, subject);
    const owners = new Set();
    const submitted = new Map();
    for (const step of scenario.steps) {
      if (step.op === "submit") {
        const input = /** @type {{ order_id: string, owner?: string, instrument: string }} */ (step.input);
        assert.match(input.order_id, ORDER_ID, subject);
        assert.match(input.owner, idPattern, subject);
        if (intentIds.has(input.order_id)) {
          assert.match(input.owner, OWNER_SUBJECT, subject);
        } else {
          assert.match(input.owner, OWNER_COUNTERPARTY, subject);
        }
        owners.add(input.owner);
        submitted.set(input.order_id, input.instrument);
      } else if (step.op === "cancel") {
        // A cancel step may only ever target an order the same scenario
        // submitted earlier, on the instrument it was submitted under.
        assert.equal(submitted.get(step.order_id), step.instrument, subject);
      }
    }
    for (const id of submitted.keys()) {
      if (!intentIds.has(id)) {
        assert.ok(!id.startsWith("ord_") || ORDER_ID.test(id), id);
      }
    }
    // Exactly one subject owner per scenario — the self-trade namespace.
    const subjectOwners = [...owners].filter((owner) => OWNER_SUBJECT.test(owner));
    assert.equal(subjectOwners.length, 1, subject);
  }
});

test("every act stays inside the declared instrument and quantity bounds", () => {
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_probe0101"]) {
    const scenario = exchangeOrderScenario(subject);
    for (const intentRow of scenario.intents) {
      const definition = ORDER_PAIRS.find((entry) => entry.pair === intentRow.pair);
      assert.ok(definition !== undefined, intentRow.pair);
      assert.match(intentRow.order_id, ORDER_ID);
      assert.match(intentRow.price, /^(0|[1-9][0-9]*)\.[0-9]{8}$/u);
      assert.match(intentRow.quantity, /^(0|[1-9][0-9]*)\.[0-9]+$/u);
      assert.ok(Number.isSafeInteger(intentRow.fee_bps));
      assert.ok(intentRow.fee_bps >= 15 && intentRow.fee_bps <= 45);
      assert.ok(intentRow.order_type === "limit" || intentRow.order_type === "market");
      // The reference estimate is pinned inside the jitter band: ±0.75%
      // of the pair's mid at the shared price scale.
      const mid = Number(definition.referenceMid);
      const price = Number(intentRow.price);
      assert.ok(price >= mid * 0.99 && price <= mid * 1.01, intentRow.price);
    }
    // Replays of a generated scenario can never throw: the scenario is
    // well-formed against the engine by construction.
    assert.doesNotThrow(() => replayExchangeOrderScenario(scenario));
  }
});

test("replay cost is bounded by the scenario's fixed act vocabulary", () => {
  // The #281 invariant is "bounded cost per read": the scenario emits at
  // most nine acts (two opening fills, up to four ordinary acts, one
  // guaranteed tail, two ghosts), each a constant number of steps, and
  // the book depth is bounded by the resting orders those acts leave —
  // so the journal, the trails fold and the projections are all linear
  // in a fixed small bound, never in the subject string.
  let maxSteps = 0;
  let maxSubmits = 0;
  let maxEvents = 0;
  let maxIntents = 0;
  for (let index = 0; index < 160; index += 1) {
    const scenario = exchangeOrderScenario(`syn_cust_bound${String(index).padStart(4, "0")}`);
    maxSteps = Math.max(maxSteps, scenario.steps.length);
    maxIntents = Math.max(maxIntents, scenario.intents.length);
    const submits = scenario.steps.filter((step) => step.op === "submit").length;
    maxSubmits = Math.max(maxSubmits, submits);
    const engine = replayExchangeOrderScenario(scenario);
    maxEvents = Math.max(maxEvents, engine.journal().length);
  }
  assert.ok(maxSteps <= 40, `steps ${maxSteps}`);
  assert.ok(maxSubmits <= 16, `submits ${maxSubmits}`);
  assert.ok(maxIntents <= 16, `intents ${maxIntents}`);
  // Per-submission cost is a bounded sweep over a book that can hold at
  // most the resting orders of nine acts: the whole replay stays a small
  // constant, not a function of adversarial input.
  assert.ok(maxEvents <= 512, `journal ${maxEvents}`);
});

test("cross-request state never leaks: concurrent and repeated reads agree", async () => {
  const orders = createSyntheticExchangeOrderDirectory();
  const trades = createSyntheticTradeDirectory();
  const markets = createSyntheticMarketDirectory();
  const [a, b, c] = await Promise.all([
    orders.listFor(VERIFIED_SUBJECT),
    orders.listFor(VERIFIED_SUBJECT),
    orders.listFor(VERIFIED_SUBJECT)
  ]);
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  // Reads of one subject's views can never carry another subject's ids.
  const other = await orders.listFor(SUBJECT);
  const firstIds = new Set(a.orders.map((order) => order.order_id));
  for (const order of other.orders) {
    assert.ok(!firstIds.has(order.order_id), order.order_id);
  }
  const otherTrades = await trades.listFor(SUBJECT);
  const firstTrades = new Set((await trades.listFor(VERIFIED_SUBJECT)).trades.map((trade) => trade.trade_id));
  for (const trade of otherTrades.trades) {
    assert.ok(!firstTrades.has(trade.trade_id), trade.trade_id);
  }
  const otherMarkets = await markets.listFor(SUBJECT);
  assert.notDeepEqual(otherMarkets, await markets.listFor(VERIFIED_SUBJECT));
});

test("the served orders list is newest-first with unique minted ids", async () => {
  const view = await createSyntheticExchangeOrderDirectory().listFor(VERIFIED_SUBJECT);
  const ids = view.orders.map((order) => order.order_id);
  assert.equal(new Set(ids).size, ids.length);
  const stamps = view.orders.map((order) => order.created_at);
  assert.deepEqual(stamps, [...stamps].sort().reverse());
  assert.ok(view.orders.length >= 1);
});

test("the matching-core import seam stays minimal and dependency-free", () => {
  // The boundary grants exactly three leaf imports; a new matching-core
  // specifier or a barrel/driver import must fail the boundary check.
  const bridge = readFileSync(new URL("../src/exchange-orders.mjs", import.meta.url), "utf8");
  const allowed = new Set([
    "../../matching-core/src/deterministic.mjs",
    "../../matching-core/src/engine.mjs",
    "../../matching-core/src/instruments.mjs"
  ]);
  for (const match of bridge.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gmu)) {
    assert.ok(allowed.has(match[1]) || match[1] === "node:crypto", match[1]);
  }
  // The whole transitive closure the bridge drags in — the three leaves
  // plus what engine.mjs itself imports — must stay free of the pg driver
  // (the leaf-vs-barrel trap from #285).
  const core = fileURLToPath(new URL("../../matching-core/src", import.meta.url));
  const closure = new Set(["deterministic.mjs", "engine.mjs", "instruments.mjs"]);
  for (const name of [...closure]) {
    const text = readFileSync(join(core, name), "utf8");
    for (const match of text.matchAll(/from\s+"\.\/([a-z-]+\.mjs)"/gu)) {
      closure.add(match[1]);
    }
  }
  for (const name of closure) {
    const text = readFileSync(join(core, name), "utf8");
    assert.doesNotMatch(text, /from\s+"pg"|import\s*\(\s*"pg"/u, name);
    assert.doesNotMatch(text, /postgres-journal-store/u, name);
  }
});

test("the projection fold tolerates a validation reject before a later accept", () => {
  // A submission id refused before tracking does not consume the id: a
  // later valid submission under it is accepted, and the fold reports the
  // accept as creation.
  const engine = createMatchingEngine({ clock: createSimulatedClock(EPOCH) });
  engine.submitOrder(limitInput(ORD_9, { note: "bad" }));
  const clock2 = engine;
  clock2.submitOrder(limitInput(ORD_9));
  const rows = projectExchangeOrders(engine, [intent(ORD_9)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].created_at, rows[0].updated_at);
});

test("a cancelled-then-filled view never reports ghost executions", () => {
  // The trades read must name only fills the subject's own orders were a
  // leg of; a resting order cancelled before any sweep produces no trade.
  const engine = createMatchingEngine({ clock: createSimulatedClock(EPOCH) });
  engine.submitOrder(limitInput(ORD_1));
  engine.cancelOrder("USDT/RUB", ORD_1);
  const trades = projectExchangeTrades(engine, [intent(ORD_1)]);
  assert.deepEqual(trades, []);
  const orders = projectExchangeOrders(engine, [intent(ORD_1)]);
  assert.equal(orders[0].status, "cancelled");
  assert.equal(orders[0].base_amount, "10.000000");
});

test("the market projection reports the replay's own book state per pair", () => {
  for (const subject of [SUBJECT, VERIFIED_SUBJECT]) {
    const scenario = exchangeOrderScenario(subject);
    const engine = replayExchangeOrderScenario(scenario);
    const markets = projectExchangeMarkets(engine, scenario);
    assert.equal(markets.length, ORDER_PAIRS.length);
    assert.deepEqual(
      markets.map((market) => market.instrument),
      ORDER_PAIRS.map((entry) => entry.pair)
    );
    for (const market of markets) {
      assert.ok(Date.parse(market.as_of) === Date.parse(markets[0].as_of));
      if (market.last_trade !== null) {
        assert.ok(Date.parse(market.last_trade.executed_at) <= Date.parse(market.as_of));
      }
      if (market.best_bid !== null && market.best_ask !== null) {
        assert.ok(Number.isSafeInteger(market.spread_bps));
      }
      assert.equal(market.posting, "none");
    }
    assert.equal(validMarketsView({ mode: "test", markets }), true);
  }
});
