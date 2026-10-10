import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { DeviceSessionsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type {
  CustomerApiAuthSession,
  CustomerApiAuthSessions,
  CustomerApiAuthSessionsView,
  CustomerApiClient
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "sess_upstreammarker000000";
const sessionKeys = ["client", "createdAt", "current", "handle", "lastSeenAt"];
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

interface AuthSessionsStub {
  client: CustomerApiClient;
  calls: string[];
}

function authSessionsStub(result: CustomerApiAuthSessions | (() => Promise<CustomerApiAuthSessions>)): AuthSessionsStub {
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
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    }
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: AuthSessionsStub): Promise<Running> {
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

function authSession(overrides: Partial<CustomerApiAuthSession> = {}): CustomerApiAuthSession {
  return {
    session_id: marker,
    platform: "telegram-mini-app",
    state: "active",
    created_at: "2026-10-01T12:00:00.000Z",
    last_seen_at: "2026-10-01T13:00:00.000Z",
    current: true,
    ...overrides
  };
}

function upstreamView(sessions: readonly CustomerApiAuthSession[] = [authSession()]): CustomerApiAuthSessionsView {
  return { mode: "test", sessions };
}

describe("GET /bff/sessions through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/sessions");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local device view for gated and verified sessions without a configured customer-api", async () => {
    const running = await start(config());
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const view = await (await get(running.base, "/bff/sessions", cookie)).json() as DeviceSessionsView;
        assert.equal(view.mode, "test");
        assert.ok(view.sessions.length >= 1, kyc);
        // Dev sessions share the synthetic subject, so the store accumulates
        // logins across the loop — every entry keeps its ses_* handle and
        // exactly one is marked current.
        for (const entry of view.sessions) {
          assert.match(entry.handle, /^ses_[0-9a-f]{32}$/);
          assert.equal(entry.client, "dev-login");
        }
        assert.equal(view.sessions.filter((entry) => entry.current).length, 1, kyc);
      }
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a kyc-gated session: the read is never gated", async () => {
    // Like /bff/profile, /bff/kyc/status and /bff/support/requests — and
    // unlike /bff/wallet and /bff/notifications — gated sessions are
    // authorized for customer.auth.read upstream, so they reach the contract
    // surface too.
    const stub = authSessionsStub({
      status: "ok",
      view: upstreamView([
        authSession(),
        authSession({
          session_id: "sess_0123456789abcdef01234567",
          platform: "web",
          current: false,
          created_at: "2026-10-02T12:00:00.000Z",
          last_seen_at: "2026-10-02T14:00:00.000Z"
        }),
        authSession({
          session_id: "sess_fedcba9876543210fedcba98",
          platform: "ios",
          state: "revoked",
          current: false,
          last_seen_at: "2026-10-01T14:00:00.000Z"
        }),
        authSession({
          session_id: "sess_0123456789abcdef01234568",
          platform: "android",
          state: "expired",
          current: false,
          last_seen_at: "2026-10-01T15:00:00.000Z"
        })
      ])
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/sessions", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const key of ["session_id", "platform", "state", "created_at", "last_seen_at"]) {
        assert.equal(text.includes(key), false, `upstream key ${key} must not leak`);
      }
      const view = JSON.parse(text) as DeviceSessionsView;
      assert.deepEqual(Object.keys(view).sort(), ["mode", "sessions"]);
      assert.equal(view.mode, "test");
      // The app surface lists live sign-ins only: the revoked and expired
      // entries drop out of the adapted view.
      assert.equal(view.sessions.length, 2);
      const current = view.sessions[0];
      assert.deepEqual(Object.keys(current).sort(), sessionKeys);
      assert.equal(current.handle, marker);
      assert.equal(current.client, "telegram");
      assert.equal(current.current, true);
      assert.equal(current.createdAt, Date.parse("2026-10-01T12:00:00.000Z"));
      assert.equal(current.lastSeenAt, Date.parse("2026-10-01T13:00:00.000Z"));
      const other = view.sessions[1];
      assert.equal(other.handle, "sess_0123456789abcdef01234567");
      assert.equal(other.client, "dev-login");
      assert.equal(other.current, false);
      assert.equal(other.createdAt, Date.parse("2026-10-02T12:00:00.000Z"));
      assert.equal(other.lastSeenAt, Date.parse("2026-10-02T14:00:00.000Z"));
      assert.equal(stub.calls.length, 1, "gated sessions must reach upstream");
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a verified session too", async () => {
    const stub = authSessionsStub({
      status: "ok",
      view: upstreamView([
        authSession({ platform: "ios" }),
        authSession({
          session_id: "sess_fedcba9876543210fedcba98",
          platform: "android",
          current: false
        })
      ])
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/sessions", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as DeviceSessionsView;
      assert.equal(view.sessions.length, 2);
      assert.equal(view.sessions[0].handle, marker);
      assert.equal(view.sessions[0].client, "dev-login");
      assert.equal(view.sessions[1].client, "dev-login");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("keeps the upstream read source of truth for the list while revoke commands stay local", async () => {
    // POST /bff/sessions/revoke(-others) stays a local-store write (the
    // contract serves no command side), so a configured upstream owns the
    // list read: an upstream-listed sess_* handle is not a local ses_*
    // handle and can never resolve on the revoke routes.
    const stub = authSessionsStub({ status: "ok", view: upstreamView() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const revoked = await post(running.base, "/bff/sessions/revoke", { handle: "sess_0123456789abcdef01234567" }, cookie);
      assert.equal(revoked.status, 400);
      assert.deepEqual(await revoked.json(), { error: "invalid_request" });
      const others = await post(running.base, "/bff/sessions/revoke-others", {}, cookie);
      assert.equal(others.status, 200);
      // The revoke response is still the app view (local store only).
      const local = await others.json() as DeviceSessionsView;
      assert.equal(local.mode, "test");
      assert.ok(local.sessions.every((entry) => entry.current));
      // The upstream read still owns the list afterwards.
      const view = await (await get(running.base, "/bff/sessions", cookie)).json() as DeviceSessionsView;
      assert.deepEqual(view.sessions.map((entry) => entry.handle), [marker]);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to sessions_unavailable on upstream outage for gated and verified sessions without leaking the body", async () => {
    const stub = authSessionsStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/sessions", cookie);
        assert.equal(response.status, 503, kyc);
        const text = await response.text();
        assert.equal(/sess_[0-9a-f]/.test(text), false);
        assert.equal(text.includes("session_id"), false);
        assert.equal(text.includes("syn_cust_"), false);
        assert.deepEqual(JSON.parse(text), { error: "sessions_unavailable" });
      }
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiAuthSessions = { status: "unavailable" };
    const stub = authSessionsStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      assert.equal((await get(running.base, "/bff/sessions", cookie)).status, 503);
      result = { status: "ok", view: upstreamView([authSession({ session_id: "sess_recovered000000000000000" })]) };
      const view = await (await get(running.base, "/bff/sessions", cookie)).json() as DeviceSessionsView;
      assert.deepEqual(view.sessions.map((entry) => entry.handle), ["sess_recovered000000000000000"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
