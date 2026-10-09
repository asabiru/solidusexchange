import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { QuotesView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiQuote, CustomerApiQuotes } from "./customer-api-client.js";
import { quoteIdPattern, quotesView } from "./quotes.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "qte_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface QuotesStub {
  client: CustomerApiClient;
  calls: string[];
}

function quotesStub(result: CustomerApiQuotes | (() => Promise<CustomerApiQuotes>)): QuotesStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: QuotesStub): Promise<Running> {
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

function upstreamQuote(overrides: Partial<CustomerApiQuote> = {}): CustomerApiQuote {
  return {
    quote_id: "qte_0123456789abcdef01234567",
    pair: "USDT/RUB",
    base_asset: "USDT",
    quote_asset: "RUB",
    side: "sell",
    base_amount: "25.000000",
    mid_price: "90.00000000",
    price: "89.77500000",
    spread_bps: 50,
    fee_bps: 30,
    quote_amount: "2244.37",
    fee_amount: "6.74",
    total_quote_amount: "2237.63",
    rounding: "down",
    price_observed_at: "2026-10-02T14:04:57.000Z",
    issued_at: "2026-10-02T14:05:00.000Z",
    expires_at: "2026-10-02T14:05:30.000Z",
    ttl_seconds: 30,
    status: "indicative",
    execution: "not_supported",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/quotes through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/quotes");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = quotesStub({
      status: "ok",
      quotes: [upstreamQuote({ quote_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/quotes", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as QuotesView;
      assert.deepEqual(view, quotesView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.quotes.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/quotes", cookie)).json() as QuotesView;
      assert.deepEqual(view, quotesView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const quote of view.quotes) {
        assert.match(quote.id, quoteIdPattern);
        assert.equal(quote.status, "indicative");
        assert.equal(quote.execution, "not_supported");
        assert.equal(quote.posting, "none");
        assert.equal(quote.rounding, quote.side === "buy" ? "up" : "down");
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract quotes view into the app's quotes shape", async () => {
    const stub = quotesStub({
      status: "ok",
      quotes: [
        upstreamQuote({ quote_id: marker }),
        upstreamQuote({
          quote_id: "qte_fedcba9876543210fedcba98",
          pair: "TON/USDT",
          base_asset: "TON",
          quote_asset: "USDT",
          side: "buy",
          base_amount: "2.000000000",
          mid_price: "3.20000000",
          price: "3.21200000",
          spread_bps: 75,
          fee_bps: 20,
          quote_amount: "6.424000",
          fee_amount: "0.012848",
          total_quote_amount: "6.436848",
          rounding: "up",
          price_observed_at: "2026-09-30T11:59:55.000Z",
          issued_at: "2026-09-30T12:00:00.000Z",
          expires_at: "2026-09-30T12:00:45.000Z",
          ttl_seconds: 45
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/quotes", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("quote_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("base_asset"), false, "upstream key names must not leak");
      assert.equal(text.includes("quote_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("total_quote_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("price_observed_at"), false, "upstream key names must not leak");
      assert.equal(text.includes("issued_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as QuotesView;
      assert.deepEqual(Object.keys(view).sort(), ["kyc", "mode", "quotes"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.quotes.length, 2);
      for (const quote of view.quotes) {
        assert.deepEqual(Object.keys(quote).sort(), [
          "base",
          "baseAmount",
          "execution",
          "expiresAt",
          "feeAmount",
          "feeBps",
          "id",
          "issuedAt",
          "midPrice",
          "pair",
          "posting",
          "price",
          "priceObservedAt",
          "quote",
          "quoteAmount",
          "rounding",
          "side",
          "spreadBps",
          "status",
          "totalQuoteAmount",
          "ttlSeconds"
        ]);
        assert.match(quote.id, quoteIdPattern);
        assert.equal(quote.status, "indicative");
        assert.equal(quote.execution, "not_supported");
        assert.equal(quote.posting, "none");
        assert.equal(quote.pair, `${quote.base}/${quote.quote}`);
        assert.equal(quote.rounding, quote.side === "buy" ? "up" : "down");
      }
      const [first, second] = view.quotes;
      assert.equal(first.id, marker);
      assert.equal(first.pair, "USDT/RUB");
      assert.equal(first.side, "sell");
      assert.equal(first.baseAmount, "25.000000");
      assert.equal(first.price, "89.77500000");
      assert.equal(first.quoteAmount, "2244.37");
      assert.equal(first.totalQuoteAmount, "2237.63");
      assert.equal(first.priceObservedAt, Date.parse("2026-10-02T14:04:57.000Z"));
      assert.equal(first.issuedAt, Date.parse("2026-10-02T14:05:00.000Z"));
      assert.equal(first.expiresAt, Date.parse("2026-10-02T14:05:30.000Z"));
      assert.equal(second.id, "qte_fedcba9876543210fedcba98");
      assert.equal(second.side, "buy");
      assert.equal(second.pair, "TON/USDT");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream quotes refusal (403) to the gated view", async () => {
    const stub = quotesStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/quotes", gatedCookie)).json() as QuotesView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/quotes", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to quotes_unavailable on upstream outage without leaking the body", async () => {
    const stub = quotesStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/quotes", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("qte_"), false);
      assert.deepEqual(JSON.parse(text), { error: "quotes_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiQuotes = { status: "unavailable" };
    const stub = quotesStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/quotes", cookie)).status, 503);
      result = {
        status: "ok",
        quotes: [upstreamQuote({ quote_id: "qte_5ec0de5ec0de5ec0de5ec0de" })]
      };
      const view = await (await get(running.base, "/bff/quotes", cookie)).json() as QuotesView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.quotes.map((quote) => quote.id), ["qte_5ec0de5ec0de5ec0de5ec0de"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
