import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { ExchangeOrdersView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiExchangeOrder, CustomerApiExchangeOrders } from "./customer-api-client.js";
import { exchangeOrderIdPattern, exchangeOrdersView } from "./exchange-orders.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "ord_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface ExchangeOrdersStub {
  client: CustomerApiClient;
  calls: string[];
}

function exchangeOrdersStub(
  result: CustomerApiExchangeOrders | (() => Promise<CustomerApiExchangeOrders>)
): ExchangeOrdersStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
        users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: ExchangeOrdersStub): Promise<Running> {
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

function upstreamExchangeOrder(overrides: Partial<CustomerApiExchangeOrder> = {}): CustomerApiExchangeOrder {
  return {
    order_id: "ord_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "sell",
    order_type: "limit",
    base_amount: "25.000000",
    price: "89.77500000",
    quote_amount: "2244.37",
    fee_bps: 30,
    fee_amount: "6.74",
    total_quote_amount: "2237.63",
    status: "open",
    created_at: "2026-10-02T14:05:00.000Z",
    updated_at: "2026-10-02T14:05:00.000Z",
    execution: "not_supported",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/exchange-orders through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/exchange-orders");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = exchangeOrdersStub({
      status: "ok",
      orders: [upstreamExchangeOrder({ order_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/exchange-orders", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as ExchangeOrdersView;
      assert.deepEqual(view, exchangeOrdersView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.orders.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/exchange-orders", cookie)).json() as ExchangeOrdersView;
      assert.deepEqual(view, exchangeOrdersView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const order of view.orders) {
        assert.match(order.id, exchangeOrderIdPattern);
        assert.equal(order.execution, "not_supported");
        assert.equal(order.posting, "none");
        assert.equal(order.pair, `${order.base}/${order.quote}`);
        if (order.status === "open") assert.equal(order.updatedAt, order.createdAt);
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract exchange-orders view into the app's orders shape", async () => {
    const stub = exchangeOrdersStub({
      status: "ok",
      orders: [
        upstreamExchangeOrder({ order_id: marker }),
        upstreamExchangeOrder({
          order_id: "ord_fedcba9876543210fedcba98",
          pair: "TON/USDT",
          base_asset: "TON",
          quote_asset: "USDT",
          side: "buy",
          order_type: "market",
          base_amount: "2.000000000",
          price: "3.21200000",
          quote_amount: "6.424000",
          fee_bps: 20,
          fee_amount: "0.012848",
          total_quote_amount: "6.436848",
          status: "cancelled",
          created_at: "2026-09-30T12:00:00.000Z",
          updated_at: "2026-09-30T12:00:45.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/exchange-orders", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("order_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("base_asset"), false, "upstream key names must not leak");
      assert.equal(text.includes("order_type"), false, "upstream key names must not leak");
      assert.equal(text.includes("quote_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("total_quote_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("created_at"), false, "upstream key names must not leak");
      assert.equal(text.includes("updated_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as ExchangeOrdersView;
      assert.deepEqual(Object.keys(view).sort(), ["kyc", "mode", "orders"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.orders.length, 2);
      for (const order of view.orders) {
        assert.deepEqual(Object.keys(order).sort(), [
          "base",
          "baseAmount",
          "createdAt",
          "execution",
          "feeAmount",
          "feeBps",
          "id",
          "orderType",
          "pair",
          "posting",
          "price",
          "quote",
          "quoteAmount",
          "side",
          "status",
          "totalQuoteAmount",
          "updatedAt"
        ]);
        assert.match(order.id, exchangeOrderIdPattern);
        assert.equal(order.execution, "not_supported");
        assert.equal(order.posting, "none");
        assert.equal(order.pair, `${order.base}/${order.quote}`);
      }
      const [first, second] = view.orders;
      assert.equal(first.id, marker);
      assert.equal(first.pair, "USDT/RUB");
      assert.equal(first.side, "sell");
      assert.equal(first.orderType, "limit");
      assert.equal(first.baseAmount, "25.000000");
      assert.equal(first.price, "89.77500000");
      assert.equal(first.quoteAmount, "2244.37");
      assert.equal(first.totalQuoteAmount, "2237.63");
      assert.equal(first.status, "open");
      assert.equal(first.createdAt, Date.parse("2026-10-02T14:05:00.000Z"));
      assert.equal(first.updatedAt, Date.parse("2026-10-02T14:05:00.000Z"));
      assert.equal(second.id, "ord_fedcba9876543210fedcba98");
      assert.equal(second.side, "buy");
      assert.equal(second.pair, "TON/USDT");
      assert.equal(second.orderType, "market");
      assert.equal(second.status, "cancelled");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream exchange-orders refusal (403) to the gated view", async () => {
    const stub = exchangeOrdersStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/exchange-orders", gatedCookie)).json() as ExchangeOrdersView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/exchange-orders", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to exchange_orders_unavailable on upstream outage without leaking the body", async () => {
    const stub = exchangeOrdersStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/exchange-orders", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("ord_"), false);
      assert.deepEqual(JSON.parse(text), { error: "exchange_orders_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiExchangeOrders = { status: "unavailable" };
    const stub = exchangeOrdersStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/exchange-orders", cookie)).status, 503);
      result = {
        status: "ok",
        orders: [upstreamExchangeOrder({ order_id: "ord_5ec0de5ec0de5ec0de5ec0de" })]
      };
      const view = await (await get(running.base, "/bff/exchange-orders", cookie)).json() as ExchangeOrdersView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.orders.map((order) => order.id), ["ord_5ec0de5ec0de5ec0de5ec0de"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
