import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { ActivityView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  type CustomerApiActivity,
  type CustomerApiActivityItem,
  type CustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "act_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface ActivityStub {
  client: CustomerApiClient;
  calls: string[];
}

function activityStub(
  result: CustomerApiActivity | (() => Promise<CustomerApiActivity>)
): ActivityStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    depositAddresses: async () => ({ status: "not-configured" }),
    addressScreenings: async () => ({ status: "not-configured" }),
    addressScreening: async () => ({ status: "not-configured" }),
    activity: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
    users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: ActivityStub): Promise<Running> {
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

function upstreamItem(overrides: Partial<CustomerApiActivityItem> = {}): CustomerApiActivityItem {
  return {
    activity_id: marker,
    kind: "deposit",
    status: "confirmed",
    title: "Deposit · confirmed",
    detail: "dep_0123456789abcdef01234567 confirmed",
    money: { amount: "10.000000", asset: "USDT" },
    created_at: "2026-10-10T09:15:00.000Z",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/activity through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/activity");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("keeps the local view for a kyc-gated session without consulting upstream", async () => {
    const stub = activityStub({
      status: "ok",
      activity: [upstreamItem()]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/activity", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as ActivityView;
      assert.equal(view.mode, "test");
      assert.equal(view.executable, false);
      assert.ok(view.items.every((item) => item.kind !== "contract"));
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("keeps the local view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/activity", cookie)).json() as ActivityView;
      assert.equal(view.mode, "test");
      assert.equal(view.executable, false);
      assert.ok(view.items.every((item) => item.kind !== "contract"));
    } finally {
      await running.close();
    }
  });

  it("adapts the contract activity view into the app's activity shape", async () => {
    const stub = activityStub({
      status: "ok",
      activity: [
        upstreamItem(),
        upstreamItem({
          activity_id: "act_fedcba9876543210fedcba98",
          kind: "kyc",
          status: "approved",
          title: "Identity check · approved",
          detail: "kyv_fedcba9876543210fedcba98 approved",
          money: null,
          created_at: "2026-10-09T09:15:00.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/activity", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["activity_id", "created_at", "posting", "money", "sender", "subject", upstreamSubject]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as ActivityView;
      assert.deepEqual(Object.keys(view).sort(), ["executable", "items", "mode"]);
      assert.equal(view.mode, "test");
      assert.equal(view.executable, false);
      assert.equal(view.items.length, 2);
      const [first, second] = view.items;
      assert.equal(first.kind, "contract");
      if (first.kind === "contract") {
        assert.equal(first.id, marker);
        assert.equal(first.contract, "deposit");
        assert.equal(first.status, "confirmed");
        assert.equal(first.title, "Deposit · confirmed");
        assert.equal(first.detail, "dep_0123456789abcdef01234567 confirmed");
        assert.equal(first.at, Date.parse("2026-10-10T09:15:00.000Z"));
        assert.equal(first.amount, "10.000000");
        assert.equal(first.asset, "USDT");
        assert.equal(first.executable, false);
      }
      assert.equal(second.kind, "contract");
      if (second.kind === "contract") {
        assert.equal(second.contract, "kyc");
        assert.equal(second.amount, undefined);
        assert.equal(second.asset, undefined);
      }
      assert.deepEqual(stub.calls, [devSubject]);
    } finally {
      await running.close();
    }
  });

  it("applies the limit parameter to the served feed like the local log", async () => {
    const stub = activityStub({
      status: "ok",
      activity: [
        upstreamItem(),
        upstreamItem({ activity_id: "act_111111111111111111111111", created_at: "2026-10-09T09:15:00.000Z" })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/activity?limit=1", cookie)).json() as ActivityView;
      assert.equal(view.items.length, 1);
      assert.equal(view.items[0].id, marker);
    } finally {
      await running.close();
    }
  });

  it("degrades in place to the local view when the upstream read is denied", async () => {
    const stub = activityStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/activity", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      const view = JSON.parse(text) as ActivityView;
      assert.equal(view.mode, "test");
      assert.equal(view.executable, false);
      assert.ok(view.items.every((item) => item.kind !== "contract"));
      assert.deepEqual(stub.calls, [devSubject]);
    } finally {
      await running.close();
    }
  });

  it("fails closed with activity_unavailable when the upstream read cannot answer", async () => {
    const stub = activityStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/activity", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes(upstreamSubject), false);
      assert.deepEqual(JSON.parse(text), { error: "activity_unavailable" });
    } finally {
      await running.close();
    }
  });
});
