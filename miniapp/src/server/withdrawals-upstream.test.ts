import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { WithdrawalsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiWithdrawal, CustomerApiWithdrawals } from "./customer-api-client.js";
import { withdrawalIdPattern, withdrawalsView } from "./withdrawals.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "wdr_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface WithdrawalsStub {
  client: CustomerApiClient;
  calls: string[];
}

function withdrawalsStub(result: CustomerApiWithdrawals | (() => Promise<CustomerApiWithdrawals>)): WithdrawalsStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: WithdrawalsStub): Promise<Running> {
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

function upstreamWithdrawal(overrides: Partial<CustomerApiWithdrawal> = {}): CustomerApiWithdrawal {
  return {
    withdrawal_id: "wdr_0123456789abcdef01234567",
    asset: "USDT",
    network: "TRON_TESTNET",
    status: "confirmed",
    amount: "25.000000",
    fee_amount: "0.125000",
    destination_reference: "destination_ref_0123456789abcd",
    legs: [
      { leg_id: "wdl_0123456789abcdef01234567", asset: "USDT", amount: "25.000000", direction: "out" },
      { leg_id: "wdl_fedcba9876543210fedcba98", asset: "USDT", amount: "0.125000", direction: "out" }
    ],
    created_at: "2026-10-02T14:05:00.000Z",
    updated_at: "2026-10-02T14:20:00.000Z",
    expires_at: "2026-10-02T14:10:00.000Z",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/withdrawals through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/withdrawals");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = withdrawalsStub({
      status: "ok",
      withdrawals: [upstreamWithdrawal({ withdrawal_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/withdrawals", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as WithdrawalsView;
      assert.deepEqual(view, withdrawalsView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.withdrawals.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/withdrawals", cookie)).json() as WithdrawalsView;
      assert.deepEqual(view, withdrawalsView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const withdrawal of view.withdrawals) {
        assert.match(withdrawal.id, withdrawalIdPattern);
        assert.equal(withdrawal.posting, "none");
        for (const leg of withdrawal.legs) {
          assert.match(leg.id, /^wdl_[0-9a-f]{24}$/);
          assert.equal(leg.direction, "out");
        }
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract withdrawals view into the app's withdrawals shape", async () => {
    const stub = withdrawalsStub({
      status: "ok",
      withdrawals: [
        upstreamWithdrawal({ withdrawal_id: marker }),
        upstreamWithdrawal({
          withdrawal_id: "wdr_fedcba9876543210fedcba98",
          asset: "TON",
          network: "TON_TESTNET",
          status: "pending_checker_approval",
          amount: "2.000000000",
          fee_amount: "0.010000000",
          legs: [
            { leg_id: "wdl_111111111111111111111111", asset: "TON", amount: "2.000000000", direction: "out" },
            { leg_id: "wdl_222222222222222222222222", asset: "TON", amount: "0.010000000", direction: "out" }
          ],
          created_at: "2026-09-30T12:00:00.000Z",
          updated_at: "2026-10-01T08:00:00.000Z",
          expires_at: "2026-09-30T12:05:00.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/withdrawals", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("withdrawal_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("fee_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("destination_reference"), false, "upstream key names must not leak");
      assert.equal(text.includes("leg_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("created_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as WithdrawalsView;
      assert.deepEqual(Object.keys(view).sort(), ["kyc", "mode", "withdrawals"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.withdrawals.length, 2);
      for (const withdrawal of view.withdrawals) {
        assert.deepEqual(Object.keys(withdrawal).sort(), [
          "amount",
          "asset",
          "createdAt",
          "destinationReference",
          "expiresAt",
          "fee",
          "id",
          "legs",
          "network",
          "posting",
          "status",
          "updatedAt"
        ]);
        assert.match(withdrawal.id, withdrawalIdPattern);
        assert.equal(withdrawal.posting, "none");
        assert.equal(withdrawal.legs.length, 2);
        for (const leg of withdrawal.legs) {
          assert.deepEqual(Object.keys(leg).sort(), ["amount", "asset", "direction", "id"]);
          assert.equal(leg.direction, "out");
          assert.equal(leg.asset, withdrawal.asset);
        }
        assert.equal(withdrawal.legs[0].amount, withdrawal.amount);
        assert.equal(withdrawal.legs[1].amount, withdrawal.fee);
      }
      const [first, second] = view.withdrawals;
      assert.equal(first.id, marker);
      assert.equal(first.status, "confirmed");
      assert.equal(first.amount, "25.000000");
      assert.equal(first.fee, "0.125000");
      assert.equal(first.destinationReference, "destination_ref_0123456789abcd");
      assert.equal(first.createdAt, Date.parse("2026-10-02T14:05:00.000Z"));
      assert.equal(first.updatedAt, Date.parse("2026-10-02T14:20:00.000Z"));
      assert.equal(first.expiresAt, Date.parse("2026-10-02T14:10:00.000Z"));
      assert.equal(second.id, "wdr_fedcba9876543210fedcba98");
      assert.equal(second.status, "pending_checker_approval");
      assert.equal(second.network, "TON_TESTNET");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream withdrawals refusal (403) to the gated view", async () => {
    const stub = withdrawalsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/withdrawals", gatedCookie)).json() as WithdrawalsView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/withdrawals", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to withdrawals_unavailable on upstream outage without leaking the body", async () => {
    const stub = withdrawalsStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/withdrawals", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("wdr_"), false);
      assert.equal(text.includes("wdl_"), false);
      assert.deepEqual(JSON.parse(text), { error: "withdrawals_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiWithdrawals = { status: "unavailable" };
    const stub = withdrawalsStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/withdrawals", cookie)).status, 503);
      result = {
        status: "ok",
        withdrawals: [upstreamWithdrawal({ withdrawal_id: "wdr_recovered00000000000000" })]
      };
      const view = await (await get(running.base, "/bff/withdrawals", cookie)).json() as WithdrawalsView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.withdrawals.map((withdrawal) => withdrawal.id), ["wdr_recovered00000000000000"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
