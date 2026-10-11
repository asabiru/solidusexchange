import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { WalletView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  type CustomerApiClient,
  type CustomerApiDepositAddress,
  type CustomerApiDepositAddresses,
  type CustomerApiWallets,
  customerApiSubject
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";
import { syntheticData } from "./synthetic.js";

const origin = "http://127.0.0.1:4183";
const now = 1_790_000_000_000;
const devSubject = `dev-${createHash("sha256")
  .update("solidchange-miniapp-dev-synthetic|900000001")
  .digest("hex")
  .slice(0, 16)}`;
const upstreamSubject = customerApiSubject(devSubject);

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

interface WalletStub {
  client: CustomerApiClient;
  calls: string[];
}

function upstreamAddress(overrides: Partial<CustomerApiDepositAddress> = {}): CustomerApiDepositAddress {
  return {
    deposit_address_id: "dpa_0123456789abcdef01234567",
    asset: "USDT",
    network: "TON_TESTNET",
    address: `kQ${"A".repeat(46)}`,
    status: "active",
    created_at: "2026-09-02T00:00:00.000Z",
    posting: "none",
    ...overrides
  };
}

function walletStub(
  wallets: CustomerApiWallets,
  addresses: CustomerApiDepositAddresses
): WalletStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => wallets,
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    trades: async () => ({ status: "not-configured" }),
    markets: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    depositAddresses: async (subject) => {
      calls.push(subject);
      return addresses;
    },
    addressScreenings: async () => ({ status: "not-configured" }),
    addressScreening: async () => ({ status: "not-configured" }),
    activity: async () => ({ status: "not-configured" }),
    operations: async () => ({ status: "not-configured" }),
    operation: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
    users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: WalletStub): Promise<Running> {
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

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await fetch(`${base}/bff/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ kyc })
  });
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
}

const servedWallets: CustomerApiWallets = {
  status: "ok",
  wallets: [{ wallet_id: "wal_0001", asset: "USDT", available: "10.000000", hold: "0.500000" }]
};

describe("GET /bff/wallet depositAddresses through the customer-api seam", () => {
  it("keeps the local wallet view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/wallet", cookie)).json() as WalletView;
      assert.deepEqual(view, syntheticData.wallet("verified"));
      // The wallet surface has no local deposit-address data: the section
      // exists but stays empty whenever the served read is not wired.
      assert.deepEqual(view.depositAddresses, []);
    } finally {
      await running.close();
    }
  });

  it("maps served deposit-addresses into the wallet view alongside balances", async () => {
    const stub = walletStub(servedWallets, {
      status: "ok",
      depositAddresses: [
        upstreamAddress(),
        upstreamAddress({
          deposit_address_id: "dpa_fedcba9876543210fedcba98",
          asset: "TON",
          address: `kQ${"b".repeat(46)}`
        }),
        upstreamAddress({
          deposit_address_id: "dpa_111111111111111111111111",
          network: "TRON_TESTNET",
          address: `T${"1".repeat(33)}`
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/wallet", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["deposit_address_id", "created_at"]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as WalletView;
      assert.deepEqual(Object.keys(view).sort(), ["assets", "availableRub", "depositAddresses", "holdRub", "kyc", "totalRub"]);
      assert.equal(view.depositAddresses.length, 3);
      for (const entry of view.depositAddresses) {
        assert.deepEqual(Object.keys(entry).sort(), ["address", "asset", "createdAt", "id", "network", "posting", "status"]);
        assert.match(entry.id, /^dpa_[0-9a-f]{24}$/);
        assert.equal(entry.status, "active");
        assert.equal(entry.posting, "none");
      }
      assert.equal(view.depositAddresses[0]?.id, "dpa_0123456789abcdef01234567");
      assert.equal(view.depositAddresses[0]?.address, `kQ${"A".repeat(46)}`);
      assert.equal(view.depositAddresses[0]?.createdAt, Date.parse("2026-09-02T00:00:00.000Z"));
      assert.deepEqual(stub.calls, [devSubject]);
    } finally {
      await running.close();
    }
  });

  it("degrades the depositAddresses section in place on an upstream refusal", async () => {
    const stub = walletStub(servedWallets, { status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/wallet", cookie)).json() as WalletView;
      assert.equal(view.assets.length, 1);
      assert.equal(view.assets[0]?.code, "USDT");
      assert.deepEqual(view.depositAddresses, []);
    } finally {
      await running.close();
    }
  });

  it("answers 503 wallet_unavailable when the deposit-addresses read fails", async () => {
    const stub = walletStub(servedWallets, { status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/wallet", cookie);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "wallet_unavailable" });
    } finally {
      await running.close();
    }
  });

  it("keeps the gated synthetic view when the balances read is denied", async () => {
    const stub = walletStub({ status: "denied" }, {
      status: "ok",
      depositAddresses: [upstreamAddress()]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/wallet", cookie)).json() as WalletView;
      assert.deepEqual(view, syntheticData.wallet("kyc-gated"));
      assert.deepEqual(view.depositAddresses, []);
      // The address read is not attempted once balances are denied.
      assert.deepEqual(stub.calls, []);
    } finally {
      await running.close();
    }
  });
});
