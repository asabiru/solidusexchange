import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { AccountView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  createCustomerApiClient,
  type CustomerApiClient,
  type CustomerApiUserView,
  type CustomerApiUsers
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "usr_0123456789abcdef01234567";
const accountKeys = ["createdAt", "flags", "id", "mode", "status", "subject", "updatedAt"];
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

interface UsersStub {
  client: CustomerApiClient;
  calls: string[];
}

function usersStub(result: CustomerApiUsers | (() => Promise<CustomerApiUsers>)): UsersStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "not-configured" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
    users: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    }
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, client?: CustomerApiClient): Promise<Running> {
  const server = createMiniappServer(serverConfig, {
    clock: () => now,
    ...(client ? { customerApi: client } : {})
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown, cookie?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
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

function upstreamView(overrides: Partial<CustomerApiUserView> = {}): CustomerApiUserView {
  return {
    mode: "test",
    user_id: marker,
    subject: "syn_cust_0123456789abcdef01234567",
    status: "active",
    flags: {
      terms_accepted: true,
      two_factor_enabled: false,
      marketing_opt_in: true
    },
    created_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-10-01T12:00:00.000Z",
    ...overrides
  };
}

describe("GET /bff/account through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/account");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local account view for gated and verified sessions without a configured customer-api", async () => {
    const running = await start(config());
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/account", cookie);
        assert.equal(response.status, 200, kyc);
        const view = await response.json() as AccountView;
        assert.deepEqual(Object.keys(view).sort(), accountKeys, kyc);
        assert.equal(view.mode, "test");
        assert.match(view.id, /^usr_[0-9a-f]{24}$/, kyc);
        assert.match(view.subject, /^dev-[0-9a-f]{16}$/, kyc);
        assert.equal(view.status, "active");
        assert.deepEqual(view.flags, {
          termsAccepted: false,
          twoFactorEnabled: false,
          marketingOptIn: false
        });
        assert.equal(view.createdAt, view.updatedAt, kyc);
      }
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a kyc-gated session: the read is never gated", async () => {
    // Like /bff/profile, /bff/kyc/status, /bff/support/requests and
    // /bff/sessions — and unlike /bff/wallet and /bff/notifications — gated
    // sessions are authorized for customer.users.read upstream (it is the
    // subject's own account record), so they reach the contract surface too.
    const stub = usersStub({ status: "ok", view: upstreamView() });
    const running = await start(config(), stub.client);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/account", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const key of ["user_id", "terms_accepted", "two_factor_enabled", "marketing_opt_in", "created_at", "updated_at"]) {
        assert.equal(text.includes(key), false, `upstream key ${key} must not leak`);
      }
      const view = JSON.parse(text) as AccountView;
      assert.deepEqual(Object.keys(view).sort(), accountKeys);
      assert.equal(view.mode, "test");
      assert.equal(view.id, marker);
      assert.equal(view.subject, "syn_cust_0123456789abcdef01234567");
      assert.equal(view.status, "active");
      assert.deepEqual(view.flags, {
        termsAccepted: true,
        twoFactorEnabled: false,
        marketingOptIn: true
      });
      assert.equal(view.createdAt, Date.parse("2026-09-01T12:00:00.000Z"));
      assert.equal(view.updatedAt, Date.parse("2026-10-01T12:00:00.000Z"));
      assert.equal(stub.calls.length, 1, "gated sessions must reach upstream");
      assert.match(stub.calls[0], /^dev-[0-9a-f]{16}$/);
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a verified session too", async () => {
    const stub = usersStub({
      status: "ok",
      view: upstreamView({ status: "suspended" })
    });
    const running = await start(config(), stub.client);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/account", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as AccountView;
      assert.equal(view.mode, "test");
      assert.equal(view.id, marker);
      assert.equal(view.status, "suspended");
      assert.equal(stub.calls.length, 1, "verified sessions must reach upstream");
    } finally {
      await running.close();
    }
  });

  it("degrades to account_unavailable on any upstream failure, for both session levels", async () => {
    // The users read is never denied upstream, so a 403 is contract drift
    // like any other failure: the stub reports every non-ok outcome as
    // "unavailable" and the route maps it to the sibling *_unavailable
    // shape with no upstream detail leaking.
    const stub = usersStub({ status: "unavailable" });
    const running = await start(config(), stub.client);
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/account", cookie);
        assert.equal(response.status, 503, kyc);
        const text = await response.text();
        assert.equal(text.includes(marker), false, "upstream detail must not leak");
        assert.equal(text.includes("syn_cust_"), false, "upstream subject must not leak");
        assert.deepEqual(JSON.parse(text), { error: "account_unavailable" }, kyc);
      }
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });

  it("fails closed on an upstream view violating the contract field patterns", async () => {
    // End to end through the real client: an upstream drifting from the
    // declared user_id/subject/status shapes or the flags schema is contract
    // drift, the client reports "unavailable", and the route answers 503
    // with no upstream detail reaching the app.
    const malformed = {
      mode: "test",
      user_id: "account-not-a-usr-id",
      subject: "syn_cust_0123456789abcdef01234567",
      status: "active",
      flags: {
        terms_accepted: true,
        two_factor_enabled: false,
        marketing_opt_in: true
      },
      created_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-10-01T12:00:00.000Z"
    };
    const upstream = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.url === "/api/v1/customer/users" ? malformed : { error: "not_found" }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const client = createCustomerApiClient({ baseUrl, devTokenKey: randomBytes(32).toString("hex") });
    const running = await start(config(), client);
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/account", cookie);
        assert.equal(response.status, 503, kyc);
        const text = await response.text();
        assert.equal(text.includes("account-not-a-usr-id"), false, "upstream detail must not leak");
        assert.deepEqual(JSON.parse(text), { error: "account_unavailable" }, kyc);
      }
    } finally {
      await running.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("recovers once upstream answers correctly again", async () => {
    let calls = 0;
    const stub = usersStub(async () => {
      calls += 1;
      return calls === 1
        ? { status: "unavailable" }
        : { status: "ok", view: upstreamView() };
    });
    const running = await start(config(), stub.client);
    try {
      const cookie = await devLogin(running.base, "verified");
      const degraded = await get(running.base, "/bff/account", cookie);
      assert.equal(degraded.status, 503);
      const recovered = await get(running.base, "/bff/account", cookie);
      assert.equal(recovered.status, 200);
      const view = await recovered.json() as AccountView;
      assert.equal(view.id, marker);
      assert.equal(view.status, "active");
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
