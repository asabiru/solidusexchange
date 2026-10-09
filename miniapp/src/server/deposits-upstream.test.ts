import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { DepositsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiDeposit, CustomerApiDeposits } from "./customer-api-client.js";
import { depositIdPattern, depositsView } from "./deposits.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "dep_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface DepositsStub {
  client: CustomerApiClient;
  calls: string[];
}

function depositsStub(result: CustomerApiDeposits | (() => Promise<CustomerApiDeposits>)): DepositsStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: DepositsStub): Promise<Running> {
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

function upstreamDeposit(overrides: Partial<CustomerApiDeposit> = {}): CustomerApiDeposit {
  return {
    deposit_id: "dep_0123456789abcdef01234567",
    asset: "RUB",
    method: "sbp",
    status: "payment_received",
    expected_amount: "25000.00",
    received_total: "25000.00",
    reversed_total: "0.00",
    payment_reference: "SIMSBP0123456789AB",
    created_at: "2026-10-04T12:10:00.000Z",
    updated_at: "2026-10-04T12:14:00.000Z",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/deposits through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/deposits");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = depositsStub({
      status: "ok",
      deposits: [upstreamDeposit({ deposit_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/deposits", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as DepositsView;
      assert.deepEqual(view, depositsView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.deposits.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/deposits", cookie)).json() as DepositsView;
      assert.deepEqual(view, depositsView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const deposit of view.deposits) {
        assert.match(deposit.id, depositIdPattern);
        assert.equal(deposit.posting, "none");
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract deposits view into the app's deposits shape", async () => {
    const stub = depositsStub({
      status: "ok",
      deposits: [
        upstreamDeposit({ deposit_id: marker }),
        upstreamDeposit({
          deposit_id: "dep_fedcba9876543210fedcba98",
          status: "partial_payment",
          expected_amount: "10000.00",
          received_total: "4200.00",
          created_at: "2026-09-30T12:00:00.000Z",
          updated_at: "2026-10-01T08:00:00.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/deposits", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("deposit_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("expected_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("received_total"), false, "upstream key names must not leak");
      assert.equal(text.includes("payment_reference"), false, "upstream key names must not leak");
      assert.equal(text.includes("created_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as DepositsView;
      assert.deepEqual(Object.keys(view).sort(), ["deposits", "kyc", "mode"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.deposits.length, 2);
      for (const deposit of view.deposits) {
        assert.deepEqual(Object.keys(deposit).sort(), [
          "asset",
          "createdAt",
          "expected",
          "id",
          "method",
          "paymentReference",
          "posting",
          "received",
          "reversed",
          "status",
          "updatedAt"
        ]);
        assert.match(deposit.id, depositIdPattern);
        assert.equal(deposit.asset, "RUB");
        assert.equal(deposit.method, "sbp");
        assert.equal(deposit.posting, "none");
      }
      const [first, second] = view.deposits;
      assert.equal(first.id, marker);
      assert.equal(first.status, "payment_received");
      assert.equal(first.expected, "25000.00");
      assert.equal(first.received, "25000.00");
      assert.equal(first.reversed, "0.00");
      assert.equal(first.paymentReference, "SIMSBP0123456789AB");
      assert.equal(first.createdAt, Date.parse("2026-10-04T12:10:00.000Z"));
      assert.equal(first.updatedAt, Date.parse("2026-10-04T12:14:00.000Z"));
      assert.equal(second.id, "dep_fedcba9876543210fedcba98");
      assert.equal(second.status, "partial_payment");
      assert.equal(second.received, "4200.00");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream deposits refusal (403) to the gated view", async () => {
    const stub = depositsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/deposits", gatedCookie)).json() as DepositsView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/deposits", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to deposits_unavailable on upstream outage without leaking the body", async () => {
    const stub = depositsStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/deposits", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("dep_"), false);
      assert.deepEqual(JSON.parse(text), { error: "deposits_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiDeposits = { status: "unavailable" };
    const stub = depositsStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/deposits", cookie)).status, 503);
      result = {
        status: "ok",
        deposits: [upstreamDeposit({ deposit_id: "dep_recovered00000000000000" })]
      };
      const view = await (await get(running.base, "/bff/deposits", cookie)).json() as DepositsView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.deposits.map((deposit) => deposit.id), ["dep_recovered00000000000000"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
