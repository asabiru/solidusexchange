import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { TradesView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiTrade, CustomerApiTrades } from "./customer-api-client.js";
import { tradeIdPattern, tradesView } from "./trades.js";
import { exchangeOrderIdPattern } from "./exchange-orders.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "trd_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface TradesStub {
  client: CustomerApiClient;
  calls: string[];
}

function tradesStub(
  result: CustomerApiTrades | (() => Promise<CustomerApiTrades>)
): TradesStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    trades: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    markets: async () => ({ status: "not-configured" }),
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
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: TradesStub): Promise<Running> {
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

function upstreamTrade(overrides: Partial<CustomerApiTrade> = {}): CustomerApiTrade {
  return {
    trade_id: "trd_0123456789abcdef01234567",
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "sell",
    liquidity: "maker",
    price: "90.00000000",
    quantity: "10.000000",
    quote_amount: "900.00",
    fee_bps: 30,
    fee_amount: "2.70",
    total_quote_amount: "897.30",
    executed_at: "2026-10-02T14:05:00.000Z",
    execution: "not_supported",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/trades through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/trades");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = tradesStub({
      status: "ok",
      trades: [upstreamTrade({ trade_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/trades", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as TradesView;
      assert.deepEqual(view, tradesView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.trades.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/trades", cookie)).json() as TradesView;
      assert.deepEqual(view, tradesView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const trade of view.trades) {
        assert.match(trade.id, tradeIdPattern);
        assert.match(trade.orderId, exchangeOrderIdPattern);
        assert.equal(trade.execution, "not_supported");
        assert.equal(trade.posting, "none");
        assert.equal(trade.pair, `${trade.base}/${trade.quote}`);
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract trades view into the app's trades shape", async () => {
    const stub = tradesStub({
      status: "ok",
      trades: [
        upstreamTrade({ trade_id: marker }),
        upstreamTrade({
          trade_id: "trd_fedcba9876543210fedcba98",
          order_id: "ord_fedcba9876543210fedcba98",
          pair: "TON/USDT",
          base_asset: "TON",
          quote_asset: "USDT",
          side: "buy",
          liquidity: "taker",
          price: "3.20000000",
          quantity: "2.000000000",
          quote_amount: "6.400000",
          fee_bps: 20,
          fee_amount: "0.012800",
          total_quote_amount: "6.412800",
          executed_at: "2026-09-30T12:00:45.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/trades", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("trade_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("order_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("base_asset"), false, "upstream key names must not leak");
      assert.equal(text.includes("quote_asset"), false, "upstream key names must not leak");
      assert.equal(text.includes("quote_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("total_quote_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("executed_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as TradesView;
      assert.deepEqual(Object.keys(view).sort(), ["kyc", "mode", "trades"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.trades.length, 2);
      for (const trade of view.trades) {
        assert.deepEqual(Object.keys(trade).sort(), [
          "base",
          "executedAt",
          "execution",
          "feeAmount",
          "feeBps",
          "id",
          "liquidity",
          "orderId",
          "pair",
          "posting",
          "price",
          "quantity",
          "quote",
          "quoteAmount",
          "side",
          "totalQuoteAmount"
        ]);
        assert.match(trade.id, tradeIdPattern);
        assert.match(trade.orderId, exchangeOrderIdPattern);
        assert.equal(trade.execution, "not_supported");
        assert.equal(trade.posting, "none");
        assert.equal(trade.pair, `${trade.base}/${trade.quote}`);
      }
      const [first, second] = view.trades;
      assert.equal(first.id, marker);
      assert.equal(first.pair, "USDT/RUB");
      assert.equal(first.side, "sell");
      assert.equal(first.liquidity, "maker");
      assert.equal(first.price, "90.00000000");
      assert.equal(first.quantity, "10.000000");
      assert.equal(first.quoteAmount, "900.00");
      assert.equal(first.totalQuoteAmount, "897.30");
      assert.equal(first.executedAt, Date.parse("2026-10-02T14:05:00.000Z"));
      assert.equal(second.id, "trd_fedcba9876543210fedcba98");
      assert.equal(second.side, "buy");
      assert.equal(second.pair, "TON/USDT");
      assert.equal(second.liquidity, "taker");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream trades refusal (403) to the gated view", async () => {
    const stub = tradesStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/trades", gatedCookie)).json() as TradesView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/trades", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to trades_unavailable on upstream outage without leaking the body", async () => {
    const stub = tradesStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/trades", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("ord_"), false);
      assert.equal(text.includes("trd_"), false);
      assert.deepEqual(JSON.parse(text), { error: "trades_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiTrades = { status: "unavailable" };
    const stub = tradesStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/trades", cookie)).status, 503);
      result = {
        status: "ok",
        trades: [upstreamTrade({ trade_id: "trd_5ec0de5ec0de5ec0de5ec0de" })]
      };
      const view = await (await get(running.base, "/bff/trades", cookie)).json() as TradesView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.trades.map((trade) => trade.id), ["trd_5ec0de5ec0de5ec0de5ec0de"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
