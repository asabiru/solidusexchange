import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { AddressScreeningView, AddressScreeningsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  type CustomerApiAddressScreening,
  type CustomerApiAddressScreeningResult,
  type CustomerApiAddressScreenings,
  type CustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

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

interface ScreeningStub {
  client: CustomerApiClient;
  listCalls: string[];
  detailCalls: string[];
}

function upstreamScreening(overrides: Partial<CustomerApiAddressScreening> = {}): CustomerApiAddressScreening {
  return {
    screening_id: "scr_0123456789abcdef0123456789abcdef",
    asset: "USDT",
    network: "TON_TESTNET",
    direction: "outbound",
    status: "low",
    verdict: "clear",
    risk_level: "low",
    advisory: true,
    executable: false,
    submitted_at: "2026-10-01T10:00:00.000Z",
    deadline: "2026-10-01T11:00:00.000Z",
    posting: "none",
    ...overrides
  };
}

function screeningStub(
  list: CustomerApiAddressScreenings | (() => Promise<CustomerApiAddressScreenings>),
  detail: CustomerApiAddressScreeningResult | ((id: string) => CustomerApiAddressScreeningResult) = { status: "missing" }
): ScreeningStub {
  const listCalls: string[] = [];
  const detailCalls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
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
    depositAddresses: async () => ({ status: "not-configured" }),
    addressScreenings: async (subject) => {
      listCalls.push(subject);
      return typeof list === "function" ? list() : list;
    },
    addressScreening: async (subject, screeningId) => {
      detailCalls.push(screeningId);
      return typeof detail === "function" ? detail(screeningId) : detail;
    },
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
  return { client, listCalls, detailCalls };
}

async function start(serverConfig: ServerConfig, stub?: ScreeningStub): Promise<Running> {
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

async function submit(base: string, cookie: string): Promise<AddressScreeningView> {
  const response = await fetch(`${base}/bff/address-screening`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify({ asset: "USDT", network: "TRON_TESTNET", address: "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB" })
  });
  assert.ok(response.status === 202 || response.status === 200, `submit -> ${response.status}`);
  return await response.json() as AddressScreeningView;
}

describe("GET /bff/address-screening through the customer-api seam", () => {
  it("requires a session and a verified KYC", async () => {
    const running = await start(config());
    try {
      assert.equal((await get(running.base, "/bff/address-screening")).status, 401);
      const gated = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/address-screening", gated);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "kyc_required" });
    } finally {
      await running.close();
    }
  });

  it("serves the local tracking view without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const created = await submit(running.base, cookie);
      const view = await (await get(running.base, "/bff/address-screening", cookie)).json() as AddressScreeningsView;
      assert.deepEqual(Object.keys(view).sort(), ["mode", "screenings"]);
      assert.equal(view.mode, "test");
      // The POST stays local: the locally-minted screening is the list.
      assert.equal(view.screenings.length, 1);
      assert.equal(view.screenings[0]?.id, created.id);
    } finally {
      await running.close();
    }
  });

  it("adapts the contract screenings list into the app's screening shape", async () => {
    const stub = screeningStub({
      status: "ok",
      screenings: [
        upstreamScreening(),
        upstreamScreening({
          screening_id: "scr_fedcba9876543210fedcba9876543210",
          asset: "TON",
          status: "high",
          verdict: "flagged",
          risk_level: "high"
        }),
        upstreamScreening({
          screening_id: "scr_11111111111111111111111111111111",
          network: "TRON_TESTNET",
          status: "pending",
          verdict: "none",
          risk_level: null
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/address-screening", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["screening_id", "submitted_at", "risk_level", "verdict", "direction", "posting"]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as AddressScreeningsView;
      assert.deepEqual(Object.keys(view).sort(), ["mode", "screenings"]);
      assert.equal(view.screenings.length, 3);
      for (const entry of view.screenings) {
        assert.deepEqual(Object.keys(entry).sort(), [
          "advisory", "asset", "deadline", "executable", "id", "mode", "network", "status", "submittedAt"
        ]);
        assert.match(entry.id, /^scr_[0-9a-f]{32}$/);
        assert.equal(entry.mode, "test");
        assert.equal(entry.advisory, true);
        assert.equal(entry.executable, false);
        assert.ok(entry.deadline > entry.submittedAt);
      }
      assert.equal(view.screenings[0]?.id, "scr_0123456789abcdef0123456789abcdef");
      assert.equal(view.screenings[0]?.status, "low");
      assert.equal(view.screenings[0]?.submittedAt, Date.parse("2026-10-01T10:00:00.000Z"));
      assert.equal(view.screenings[1]?.status, "high");
      assert.equal(view.screenings[2]?.status, "pending");
      assert.deepEqual(stub.listCalls, [devSubject]);
    } finally {
      await running.close();
    }
  });

  it("degrades the list in place to local records on an upstream refusal", async () => {
    const stub = screeningStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const created = await submit(running.base, cookie);
      const view = await (await get(running.base, "/bff/address-screening", cookie)).json() as AddressScreeningsView;
      // Local-submitted screenings still render when upstream refuses.
      assert.equal(view.screenings.length, 1);
      assert.equal(view.screenings[0]?.id, created.id);
    } finally {
      await running.close();
    }
  });

  it("answers 503 screening_unavailable when the list read fails", async () => {
    const stub = screeningStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/address-screening", cookie);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "screening_unavailable" });
    } finally {
      await running.close();
    }
  });
});

describe("GET /bff/address-screening/:id through the customer-api seam", () => {
  it("serves an upstream-owned screening in the app shape", async () => {
    const stub = screeningStub({ status: "unavailable" }, {
      status: "ok",
      screening: upstreamScreening({ status: "medium", verdict: "review", risk_level: "medium" })
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, `/bff/address-screening/${"scr_0123456789abcdef0123456789abcdef"}`, cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["screening_id", "submitted_at", "risk_level", "verdict", "posting"]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as AddressScreeningView;
      assert.equal(view.id, "scr_0123456789abcdef0123456789abcdef");
      assert.equal(view.status, "medium");
      assert.equal(view.mode, "test");
      assert.equal(view.executable, false);
      assert.deepEqual(stub.detailCalls, ["scr_0123456789abcdef0123456789abcdef"]);
    } finally {
      await running.close();
    }
  });

  it("falls back to the local store when upstream misses a locally-minted id", async () => {
    // Pinned fallback: POST-submitted screenings keep locally minted scr_* ids;
    // an upstream 404 ("missing") resolves through the local lookup so the
    // locally created record still renders while the POST stays unserved.
    const stub = screeningStub({ status: "unavailable" }, { status: "missing" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const created = await submit(running.base, cookie);
      const response = await get(running.base, `/bff/address-screening/${created.id}`, cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as AddressScreeningView;
      assert.deepEqual(view, created);
      assert.deepEqual(stub.detailCalls, [created.id]);
    } finally {
      await running.close();
    }
  });

  it("keeps the plain 404 when neither side knows the id", async () => {
    const stub = screeningStub({ status: "unavailable" }, { status: "missing" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, `/bff/address-screening/scr_${"0".repeat(32)}`, cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
    } finally {
      await running.close();
    }
  });

  it("answers 503 screening_unavailable when the detail read fails", async () => {
    const stub = screeningStub({ status: "unavailable" }, { status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, `/bff/address-screening/scr_${"0".repeat(32)}`, cookie);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "screening_unavailable" });
    } finally {
      await running.close();
    }
  });

  it("serves the local view without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const created = await submit(running.base, cookie);
      const view = await (await get(running.base, `/bff/address-screening/${created.id}`, cookie)).json();
      assert.deepEqual(view, created);
    } finally {
      await running.close();
    }
  });
});
