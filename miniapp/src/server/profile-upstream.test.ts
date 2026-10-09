import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { CustomerApiAccess, ProfileView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type {
  CustomerApiClient,
  CustomerApiProfile,
  CustomerApiProfileView
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "prf_upstreammarker000000";
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

interface ProfileStub {
  client: CustomerApiClient;
  calls: string[];
  accessCalls: number;
}

function profileStub(
  result: CustomerApiProfile | (() => Promise<CustomerApiProfile>),
  access: CustomerApiAccess = { status: "unavailable" }
): ProfileStub {
  const calls: string[] = [];
  const stub: ProfileStub = { client: undefined as unknown as CustomerApiClient, calls, accessCalls: 0 };
  stub.client = {
    configured: true,
    access: async () => {
      stub.accessCalls += 1;
      return access;
    },
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "unavailable" }),
    kyc: async () => ({ status: "unavailable" }),
    profile: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    support: async () => ({ status: "not-configured" })
  };
  return stub;
}

async function start(serverConfig: ServerConfig, stub?: ProfileStub): Promise<Running> {
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

function upstreamView(overrides: Partial<CustomerApiProfileView> = {}): CustomerApiProfileView {
  return {
    mode: "test",
    customer_ref: "SC-DEV-UPST1",
    display_name: "Customer ab12cd34",
    locale: "ru",
    registered_at: "2026-09-01T12:00:00.000Z",
    ...overrides
  };
}

const profileKeys = ["apiAccess", "customerRef", "displayName", "fees", "kyc", "limits", "security"];

describe("GET /bff/profile through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/profile");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for gated and verified sessions without a configured customer-api", async () => {
    const running = await start(config());
    try {
      for (const [kyc, state] of [["kyc-gated", "kyc-gated"], ["verified", "verified"]] as const) {
        const cookie = await devLogin(running.base, kyc);
        const view = await (await get(running.base, "/bff/profile", cookie)).json() as ProfileView;
        assert.deepEqual(Object.keys(view).sort(), [...profileKeys].sort());
        assert.equal(view.displayName, "Тестовый клиент");
        assert.match(view.customerRef, /^SC-DEV-[0-9A-F]{5}$/);
        assert.equal(view.kyc.state, state);
        assert.equal(view.limits.decision, "D-014");
        assert.deepEqual(view.apiAccess, { status: "not-configured" });
      }
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a kyc-gated session: the read is never gated", async () => {
    // Unlike /bff/wallet and /bff/notifications, gated sessions are authorized
    // for customer.profile.read upstream, so they reach the contract surface
    // too — the same inversion /bff/kyc/status follows.
    const stub = profileStub({ status: "ok", view: upstreamView({ display_name: marker }) });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/profile", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("display_name"), false, "upstream key names must not leak");
      assert.equal(text.includes("registered_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as ProfileView;
      assert.deepEqual(Object.keys(view).sort(), [...profileKeys].sort());
      // The upstream identity fields overlay the app view; the app keeps its
      // own kyc/limits/fees/security sections and the apiAccess block.
      assert.equal(view.displayName, marker);
      assert.equal(view.customerRef, "SC-DEV-UPST1");
      assert.equal(view.kyc.state, "kyc-gated", "the local session flag still keys the app kyc surface");
      assert.equal(view.limits.decision, "D-014");
      assert.deepEqual(view.apiAccess, { status: "unavailable" });
      assert.equal(stub.calls.length, 1, "gated sessions must reach upstream");
      assert.equal(stub.accessCalls, 1, "apiAccess is still consulted");
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a verified session and keeps the apiAccess block connected", async () => {
    const stub = profileStub(
      { status: "ok", view: upstreamView({ locale: "ky" }) },
      { status: "connected", granted: ["customer.session.read", "customer.profile.read"], commandsEnabled: false }
    );
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/profile", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as ProfileView;
      assert.equal(view.displayName, "Customer ab12cd34");
      assert.equal(view.customerRef, "SC-DEV-UPST1");
      assert.equal(view.kyc.state, "verified");
      assert.deepEqual(view.apiAccess, {
        status: "connected",
        granted: ["customer.session.read", "customer.profile.read"],
        commandsEnabled: false
      });
      // The upstream locale and registered_at have no app counterpart.
      assert.equal("locale" in view, false);
      assert.equal("registeredAt" in view, false);
      assert.equal(stub.calls.length, 1);
      assert.equal(stub.accessCalls, 1);
    } finally {
      await running.close();
    }
  });

  it("keeps 200 with a degraded apiAccess block when only the access read fails", async () => {
    // The apiAccess surface degrades in place exactly as before the wiring:
    // an ok profile read still yields the merged view with apiAccess
    // unavailable instead of failing the whole response.
    const stub = profileStub({ status: "ok", view: upstreamView() }, { status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/profile", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as ProfileView;
      assert.equal(view.displayName, "Customer ab12cd34");
      assert.deepEqual(view.apiAccess, { status: "unavailable" });
    } finally {
      await running.close();
    }
  });

  it("degrades to profile_unavailable on upstream outage for gated and verified sessions without leaking the body", async () => {
    const stub = profileStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/profile", cookie);
        assert.equal(response.status, 503, kyc);
        const text = await response.text();
        assert.equal(text.includes(marker), false);
        assert.equal(text.includes("syn_cust_"), false);
        assert.equal(text.includes("SC-DEV"), false);
        assert.deepEqual(JSON.parse(text), { error: "profile_unavailable" });
      }
      assert.equal(stub.calls.length, 2);
      assert.equal(stub.accessCalls, 0, "a failed profile read never reaches the access read");
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiProfile = { status: "unavailable" };
    const stub = profileStub(async () => result, {
      status: "connected",
      granted: ["customer.profile.read"],
      commandsEnabled: false
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      assert.equal((await get(running.base, "/bff/profile", cookie)).status, 503);
      result = { status: "ok", view: upstreamView({ customer_ref: "SC-DEV-RCVR1" }) };
      const view = await (await get(running.base, "/bff/profile", cookie)).json() as ProfileView;
      assert.equal(view.customerRef, "SC-DEV-RCVR1");
      assert.deepEqual(view.apiAccess, { status: "connected", granted: ["customer.profile.read"], commandsEnabled: false });
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
