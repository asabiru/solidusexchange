import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiWallets } from "./customer-api-client.js";
import { createSimulatorQuoteProvider } from "./provider-quotes.js";
import { QuoteError } from "./quotes.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const startMs = 1_790_000_000_000;

function context(now: number, overrides: { ttlSeconds?: number; available?: string; kycRequired?: boolean; subject?: string } = {}) {
  return {
    nowMs: now,
    ttlSeconds: overrides.ttlSeconds ?? 30,
    kycRequired: overrides.kycRequired ?? false,
    subject: overrides.subject ?? "tg-0123456789abcdef",
    ...(overrides.available === undefined ? {} : { available: overrides.available })
  };
}

async function rejectsWith(promise: Promise<unknown>, code: string, reason?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof QuoteError, `expected QuoteError(${code}), got ${error}`);
    assert.equal(error.code, code);
    assert.equal(error.reason, reason);
    return true;
  });
}

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

function customerApiStub(overrides: { wallets: (subject: string) => Promise<CustomerApiWallets> }): { client: CustomerApiClient } {
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async (subject) => overrides.wallets(subject),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    trades: async () => ({ status: "not-configured" }),
    markets: async () => ({ status: "not-configured" }),
    marketDepth: async () => ({ status: "not-configured" }),
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
  return { client };
}

async function start(serverConfig: ServerConfig, stub?: { client: CustomerApiClient }): Promise<Running> {
  const server = createMiniappServer(serverConfig, {
    clock: () => startMs,
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

describe("quotes preview audit (wave 72)", () => {
  it("verifies a quote minted in a later second than the pre-request clock read", async () => {
    // The server clock ticks forward between the adapter's bucket read and
    // the simulator's internal issue read: a quote issued at T+1 was being
    // assessed at T and failed closed as not_yet_valid → quote_unavailable.
    let now = startMs;
    const clock = () => {
      const value = now;
      now += 1_000;
      return value;
    };
    const quotes = createSimulatorQuoteProvider({ seed: "audit-72", ttlSeconds: 30, clock });
    const preview = await quotes.preview({ from: "RUB", to: "USDT", amount: "100" }, context(startMs));
    assert.equal(preview.executable, false);
    assert.equal(preview.executionUnavailableReason, "dev_test_version");
    assert.ok(preview.expiresAt > preview.issuedAt);
    assert.ok(preview.issuedAt > startMs, "the quote carries the simulator's own issue instant");
  });

  it("rejects amounts past the canonical 18-integer-digit wall as invalid_amount, not amount_too_small", async () => {
    let now = startMs;
    const quotes = createSimulatorQuoteProvider({ seed: "audit-72", ttlSeconds: 30, clock: () => now });
    // The BFF grammar allows 30 integer digits; the canonical decimal wall is
    // 18. A 20-digit amount is a grammar violation, not a dust quote.
    await rejectsWith(
      quotes.preview({ from: "RUB", to: "USDT", amount: "99999999999999999999" }, context(now)),
      "invalid_amount"
    );
    await rejectsWith(
      quotes.preview({ from: "USDT", to: "RUB", amount: "9999999999999999999.000000" }, context(now)),
      "invalid_amount"
    );
  });

  it("re-issues a replayed quote whose signature aged out of the verify window", async () => {
    // Latent past the shipped 10..120s config bound but reachable through the
    // adapter API (the simulator accepts ttlSeconds up to 300): with
    // expired_quote at ttl 300 a replay lands outside the signature's 300s
    // freshness window. The adapter must re-issue rather than 503.
    // The epoch is bucket-aligned (seconds % 300 == 0) so both calls share
    // one idempotency bucket and the second is a true replay.
    let now = 1_790_000_100_000;
    const quotes = createSimulatorQuoteProvider({
      seed: "audit-72",
      ttlSeconds: 300,
      clock: () => now,
      scenario: "expired_quote"
    });
    const request = { from: "RUB", to: "USDT", amount: "100" } as const;
    const first = await quotes.preview(request, context(now, { ttlSeconds: 300 }));
    assert.equal(first.executable, false);
    now += 181_000;
    const second = await quotes.preview(request, context(now, { ttlSeconds: 300 }));
    assert.equal(second.executable, false);
    assert.equal(second.executionUnavailableReason, "dev_test_version");
  });

  it("rejects malformed previews before consulting the upstream wallet surface", async () => {
    const walletCalls: string[] = [];
    const stub = customerApiStub({
      wallets: async (subject) => {
        walletCalls.push(subject);
        return { status: "unavailable" };
      }
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const unroutable = await get(running.base, "/bff/quotes/preview?from=RUB&to=RUB&amount=5", cookie);
      assert.equal(unroutable.status, 400);
      assert.deepEqual(await unroutable.json(), { error: "invalid_pair" });
      const badAmount = await get(running.base, "/bff/quotes/preview?from=RUB&to=USDT&amount=abc", cookie);
      assert.equal(badAmount.status, 400);
      assert.deepEqual(await badAmount.json(), { error: "invalid_amount" });
      const zero = await get(running.base, "/bff/quotes/preview?from=RUB&to=USDT&amount=0", cookie);
      assert.equal(zero.status, 400);
      assert.deepEqual(await zero.json(), { error: "invalid_amount" });
      assert.equal(walletCalls.length, 0, "malformed previews must never reach the upstream wallet read");
    } finally {
      await running.close();
    }
  });

  it("still consults availability for a well-formed preview", async () => {
    const walletCalls: string[] = [];
    const stub = customerApiStub({
      wallets: async (subject) => {
        walletCalls.push(subject);
        return {
          status: "ok",
          wallets: [{ wallet_id: "wal_1", asset: "RUB", available: "5000.00", hold: "0.00" }]
        };
      }
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/quotes/preview?from=RUB&to=USDT&amount=100", cookie);
      assert.equal(response.status, 200);
      const body = await response.json() as { executable: boolean; insufficientBalance: boolean };
      assert.equal(body.executable, false);
      assert.equal(body.insufficientBalance, false);
      assert.equal(walletCalls.length, 1, "a well-formed preview still prices against served balances");
    } finally {
      await running.close();
    }
  });
});
