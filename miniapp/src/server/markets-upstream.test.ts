import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { MarketsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type {
  CustomerApiClient,
  CustomerApiMarket,
  CustomerApiMarketDepth,
  CustomerApiMarketDepthView,
  CustomerApiMarkets
} from "./customer-api-client.js";
import { marketsView } from "./markets.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "99.99000000";
const now = 1_790_000_000_000;

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }),
    ...overrides
  };
}

interface Running {
  base: string;
  close: () => Promise<void>;
}

interface MarketsStub {
  client: CustomerApiClient;
  calls: string[];
  depthCalls: string[];
}

function marketsStub(
  result: CustomerApiMarkets | (() => Promise<CustomerApiMarkets>),
  depth: CustomerApiMarketDepth | ((instrument: string) => Promise<CustomerApiMarketDepth>) = {
    status: "not-found"
  }
): MarketsStub {
  const calls: string[] = [];
  const depthCalls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    trades: async () => ({ status: "not-configured" }),
    markets: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    marketDepth: async (subject, instrument) => {
      depthCalls.push(`${subject}|${instrument}`);
      return typeof depth === "function" ? depth(instrument) : depth;
    },
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
    depositAddresses: async () => ({ status: "not-configured" }),
    addressScreenings: async () => ({ status: "not-configured" }),
    addressScreening: async () => ({ status: "not-configured" }),
    activity: async () => ({ status: "not-configured" }),
    operations: async () => ({ status: "not-configured" }),
    operation: async () => ({ status: "not-configured" }),
    users: async () => ({ status: "not-configured" })
  };
  return { client, calls, depthCalls };
}

async function start(serverConfig: ServerConfig, stub?: MarketsStub): Promise<Running> {
  const server = createMiniappServer(serverConfig, {
    clock: () => now,
    ...(stub ? { customerApi: stub.client } : {})
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
}

function upstreamMarket(overrides: Partial<CustomerApiMarket> = {}): CustomerApiMarket {
  return {
    instrument: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    best_bid: { price: "89.99000000", quantity: "25.000000", order_count: 1 },
    best_ask: { price: "90.01000000", quantity: "18.000000", order_count: 1 },
    last_trade: {
      price: "90.00000000",
      quantity: "10.000000",
      executed_at: "2026-10-02T14:05:00.000Z"
    },
    // (90.01 - 89.99) * 20_000 / (90.01 + 89.99) = 2.22... -> 2 bps.
    spread_bps: 2,
    base_scale: 6,
    quote_scale: 2,
    price_scale: 8,
    as_of: "2026-10-02T14:10:00.000Z",
    posting: "none",
    ...overrides
  };
}

function upstreamDepth(
  overrides: Partial<CustomerApiMarketDepthView> = {}
): CustomerApiMarketDepthView {
  return {
    instrument: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    bids: [
      { price: "89.99000000", quantity: "25.000000", order_count: 2 },
      { price: "89.97000000", quantity: "40.000000", order_count: 1 }
    ],
    asks: [
      { price: "90.01000000", quantity: "18.000000", order_count: 1 },
      { price: "90.05000000", quantity: "12.000000", order_count: 3 }
    ],
    last_trade: {
      price: "90.00000000",
      quantity: "10.000000",
      executed_at: "2026-10-02T14:05:00.000Z"
    },
    depth_levels: 2,
    base_scale: 6,
    quote_scale: 2,
    price_scale: 8,
    as_of: "2026-10-02T14:10:00.000Z",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/markets through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/markets");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = marketsStub({
      status: "ok",
      markets: [upstreamMarket({ best_bid: { price: marker, quantity: "1.000000", order_count: 1 } })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/markets", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as MarketsView;
      assert.deepEqual(view, marketsView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.markets.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/markets", cookie)).json() as MarketsView;
      assert.deepEqual(view, marketsView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const market of view.markets) {
        assert.equal(market.posting, "none");
        assert.equal(market.instrument, `${market.base}/${market.quote}`);
      }
      // The local view exercises the empty-side nullability contract too.
      assert.ok(view.markets.some((market) => market.bestBid === null || market.bestAsk === null));
    } finally {
      await running.close();
    }
  });

  it("adapts the contract markets view into the app's markets shape", async () => {
    const stub = marketsStub({
      status: "ok",
      markets: [
        upstreamMarket(),
        upstreamMarket({
          instrument: "TON/RUB",
          base_asset: "TON",
          quote_asset: "RUB",
          best_bid: null,
          best_ask: { price: "300.50000000", quantity: "1.250000000", order_count: 1 },
          last_trade: null,
          spread_bps: null,
          base_scale: 9,
          quote_scale: 2
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/markets", cookie)).json() as MarketsView;
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      assert.equal(view.markets.length, 2);
      assert.deepEqual(view.markets[0], {
        instrument: "USDT/RUB",
        base: "USDT",
        quote: "RUB",
        bestBid: { price: "89.99000000", quantity: "25.000000", orderCount: 1 },
        bestAsk: { price: "90.01000000", quantity: "18.000000", orderCount: 1 },
        lastTrade: {
          price: "90.00000000",
          quantity: "10.000000",
          executedAt: Date.parse("2026-10-02T14:05:00.000Z")
        },
        spreadBps: 2,
        baseScale: 6,
        quoteScale: 2,
        priceScale: 8,
        asOf: Date.parse("2026-10-02T14:10:00.000Z"),
        posting: "none"
      });
      assert.deepEqual(view.markets[1], {
        instrument: "TON/RUB",
        base: "TON",
        quote: "RUB",
        bestBid: null,
        bestAsk: { price: "300.50000000", quantity: "1.250000000", orderCount: 1 },
        lastTrade: null,
        spreadBps: null,
        baseScale: 9,
        quoteScale: 2,
        priceScale: 8,
        asOf: Date.parse("2026-10-02T14:10:00.000Z"),
        posting: "none"
      });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("an upstream 403 degrades to the same emptied view a gated session sees", async () => {
    const stub = marketsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/markets", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.deepEqual(JSON.parse(text), marketsView("kyc-gated"));
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("any other upstream failure answers 503 markets_unavailable", async () => {
    for (const result of [{ status: "unavailable" } as const]) {
      const stub = marketsStub(result);
      const running = await start(config(), stub);
      try {
        const cookie = await devLogin(running.base, "verified");
        const response = await get(running.base, "/bff/markets", cookie);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: "markets_unavailable" });
      } finally {
        await running.close();
      }
    }
  });
});

describe("GET /bff/markets/{instrument} through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/markets/USDT%2FRUB");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("keeps the local 404 for a gated session without consulting upstream", async () => {
    const stub = marketsStub({ status: "unavailable" }, { status: "ok", depth: upstreamDepth() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/markets/USDT%2FRUB", cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.equal(stub.depthCalls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("keeps the local 404 on the standalone unconfigured BFF", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/markets/USDT%2FRUB", cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
    } finally {
      await running.close();
    }
  });

  it("maps a malformed or multi-segment instrument to the local 404 without an upstream call", async () => {
    const stub = marketsStub({ status: "unavailable" }, { status: "ok", depth: upstreamDepth() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      for (const path of [
        "/bff/markets/USDT/RUB",
        "/bff/markets/usdt%2Frub",
        "/bff/markets/NOT-A-PAIR",
        "/bff/markets/%ZZ",
        "/bff/markets/USDT%252FRUB",
        "/bff/markets/"
      ]) {
        const response = await get(running.base, path, cookie);
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: "not_found" });
      }
      assert.equal(stub.depthCalls.length, 0, "malformed segments must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("rejects an undeclared query string on the member read without an upstream call", async () => {
    const stub = marketsStub({ status: "unavailable" }, { status: "ok", depth: upstreamDepth() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/markets/USDT%2FRUB?trace=1", cookie);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
      assert.equal(stub.depthCalls.length, 0, "an undeclared query must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("decodes the instrument once and maps upstream not-found/denied to the local 404", async () => {
    const stub = marketsStub({ status: "unavailable" }, async (instrument) => {
      assert.equal(instrument, "USDT/RUB", "the decoded instrument reaches upstream");
      return { status: "not-found" };
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/markets/USDT%2FRUB", cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.equal(stub.depthCalls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("adapts the upstream ladder into the depth view", async () => {
    const stub = marketsStub({ status: "unavailable" }, { status: "ok", depth: upstreamDepth() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/markets/USDT%2FRUB", cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        mode: "test",
        instrument: "USDT/RUB",
        base: "USDT",
        quote: "RUB",
        bids: [
          { price: "89.99000000", quantity: "25.000000", orderCount: 2 },
          { price: "89.97000000", quantity: "40.000000", orderCount: 1 }
        ],
        asks: [
          { price: "90.01000000", quantity: "18.000000", orderCount: 1 },
          { price: "90.05000000", quantity: "12.000000", orderCount: 3 }
        ],
        lastTrade: {
          price: "90.00000000",
          quantity: "10.000000",
          executedAt: Date.parse("2026-10-02T14:05:00.000Z")
        },
        depthLevels: 2,
        baseScale: 6,
        quoteScale: 2,
        priceScale: 8,
        asOf: Date.parse("2026-10-02T14:10:00.000Z"),
        posting: "none"
      });
      assert.equal(stub.depthCalls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("any other upstream failure answers 503 markets_unavailable", async () => {
    const stub = marketsStub({ status: "unavailable" }, { status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/markets/USDT%2FRUB", cookie);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "markets_unavailable" });
    } finally {
      await running.close();
    }
  });
});
