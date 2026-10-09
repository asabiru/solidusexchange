import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { WalletView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiWallets } from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";
import { syntheticData } from "./synthetic.js";

const origin = "http://127.0.0.1:4183";
const marker = "syn_wal_upstreammarker";
let now = 1_790_000_000_000;

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

function walletStub(result: CustomerApiWallets | (() => Promise<CustomerApiWallets>)): WalletStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    notifications: async () => ({ status: "not-configured" })
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

describe("GET /bff/wallet through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/wallet");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = walletStub({
      status: "ok",
      wallets: [
        { wallet_id: marker, asset: "RUB", available: "1.00", hold: "0.00" }
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/wallet", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as WalletView;
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.totalRub, "0.00");
      assert.equal(view.availableRub, "0.00");
      assert.equal(view.holdRub, "0.00");
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/wallet", cookie)).json() as WalletView;
      assert.deepEqual(view, syntheticData.wallet("verified"));
    } finally {
      await running.close();
    }
  });

  it("adapts the contract wallets view into the app's wallet shape", async () => {
    const stub = walletStub({
      status: "ok",
      wallets: [
        { wallet_id: marker, asset: "RUB", available: "1000.00", hold: "50.00" },
        { wallet_id: "syn_wal_second0001", asset: "USDT", available: "100.000000", hold: "0.000000" }
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/wallet", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "upstream wallet ids must not leak");
      assert.equal(text.includes("syn_wal_"), false, "upstream wallet ids must not leak");
      const view = JSON.parse(text) as WalletView;
      assert.deepEqual(Object.keys(view).sort(), ["assets", "availableRub", "holdRub", "kyc", "totalRub"]);
      assert.equal(view.kyc, "verified");
      assert.deepEqual(
        view.assets.map((asset) => Object.keys(asset).sort()),
        view.assets.map(() => ["available", "code", "hold", "valueRub"])
      );
      assert.deepEqual(view.assets, [
        { code: "RUB", available: "1000.00", hold: "50.00", valueRub: "1050.00" },
        { code: "USDT", available: "100.000000", hold: "0.000000", valueRub: "9240.00" }
      ]);
      assert.equal(view.availableRub, "10240.00");
      assert.equal(view.holdRub, "50.00");
      assert.equal(view.totalRub, "10290.00");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream wallets refusal (403) to the gated view", async () => {
    const stub = walletStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/wallet", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as WalletView;
      assert.deepEqual(view, syntheticData.wallet("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to wallet_unavailable on upstream outage without leaking the body", async () => {
    const stub = walletStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/wallet", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.deepEqual(JSON.parse(text), { error: "wallet_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to real balances once upstream answers correctly again", async () => {
    let result: CustomerApiWallets = { status: "unavailable" };
    const stub = walletStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/wallet", cookie)).status, 503);
      result = {
        status: "ok",
        wallets: [{ wallet_id: "syn_wal_rub00001", asset: "RUB", available: "10.00", hold: "0.00" }]
      };
      const view = await (await get(running.base, "/bff/wallet", cookie)).json() as WalletView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.assets, [
        { code: "RUB", available: "10.00", hold: "0.00", valueRub: "10.00" }
      ]);
    } finally {
      await running.close();
    }
  });
});
