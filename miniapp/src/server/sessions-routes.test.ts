import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { ActivityView, DeviceSessionsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { createMiniappServer, routeTable } from "./server.js";
import { lastSeenGranularityMs, sessionHandlePattern } from "./session.js";

const origin = "http://127.0.0.1:4183";
const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
let now = 1_790_000_000_000;

function config(overrides: Record<string, string> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true", ...overrides }),
    telegramBotToken: syntheticToken
  };
}

interface Running {
  base: string;
  lines: string[];
  close: () => Promise<void>;
}

async function start(serverConfig: ServerConfig = config()): Promise<Running> {
  const lines: string[] = [];
  const server = createMiniappServer(serverConfig, { clock: () => now, logSink: (line) => lines.push(line) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    lines,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function sessionIdOf(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

async function telegramLogin(base: string, userId: number): Promise<string> {
  const initData = signInitData(new Map([
    ["auth_date", String(Math.floor(now / 1_000) - 5)],
    ["user", JSON.stringify({ id: userId, first_name: "Synthetic", username: "synthetic_user" })]
  ]), syntheticToken);
  const response = await post(base, "/bff/session/telegram", { initData });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function devLogin(base: string): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc: "verified" });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function sessions(base: string, cookie: string): Promise<DeviceSessionsView> {
  const response = await fetch(`${base}/bff/sessions`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return await response.json() as DeviceSessionsView;
}

async function otherHandle(base: string, cookie: string): Promise<string> {
  const other = (await sessions(base, cookie)).sessions.find((session) => !session.current);
  assert.ok(other);
  return other.handle;
}

async function revoke(base: string, cookie: string, handle: string, headers: Record<string, string> = {}) {
  return post(base, "/bff/sessions/revoke", { handle }, { cookie, ...headers });
}

async function authenticated(base: string, cookie: string): Promise<boolean> {
  const response = await fetch(`${base}/bff/session`, { headers: { cookie } });
  return response.status === 200;
}

async function activity(base: string, cookie: string): Promise<ActivityView> {
  const response = await fetch(`${base}/bff/activity`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return await response.json() as ActivityView;
}

describe("sessions routes: authentication and strict input", () => {
  let running: Running;
  before(async () => {
    running = await start();
  });
  after(async () => {
    await running.close();
  });

  it("declares one GET and two POST session routes", () => {
    assert.deepEqual(routeTable.filter((route) => route.path.startsWith("/bff/sessions")), [
      { method: "GET", path: "/bff/sessions" },
      { method: "POST", path: "/bff/sessions/revoke" },
      { method: "POST", path: "/bff/sessions/revoke-others" }
    ]);
  });

  it("requires a session on every route", async () => {
    assert.equal((await fetch(`${running.base}/bff/sessions`)).status, 401);
    assert.equal((await post(running.base, "/bff/sessions/revoke", { handle: `ses_${"0".repeat(32)}` })).status, 401);
    assert.equal((await post(running.base, "/bff/sessions/revoke-others", {})).status, 401);
    assert.equal((await fetch(`${running.base}/bff/sessions`, { headers: { cookie: "solidchange_ma_session=forged" } })).status, 401);
  });

  it("rejects query strings, malformed handles and unknown fields", async () => {
    const cookie = await telegramLogin(running.base, 8_001);
    assert.equal((await fetch(`${running.base}/bff/sessions?subject=x`, { headers: { cookie } })).status, 400);
    for (const body of [{}, { handle: "" }, { handle: sessionIdOf(cookie) }, { handle: `ses_${"G".repeat(32)}` }, { handle: `ses_${"0".repeat(32)}`, subject: "x" }]) {
      assert.equal((await post(running.base, "/bff/sessions/revoke", body, { cookie })).status, 400, JSON.stringify(body));
    }
    assert.equal((await post(running.base, "/bff/sessions/revoke-others", { handle: `ses_${"0".repeat(32)}` }, { cookie })).status, 400);
    assert.equal((await post(running.base, "/bff/sessions/revoke", { handle: [] }, { cookie })).status, 400);
  });

  it("requires the exact origin and a JSON body like other state-changing routes", async () => {
    await telegramLogin(running.base, 8_002);
    const cookie = await telegramLogin(running.base, 8_002);
    const handle = await otherHandle(running.base, cookie);
    for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, { origin: "http://127.0.0.1:4184" }]) {
      assert.equal((await revoke(running.base, cookie, handle, headers)).status, 403);
      assert.equal((await post(running.base, "/bff/sessions/revoke-others", {}, { cookie, ...headers })).status, 403);
    }
    const noOrigin = await fetch(`${running.base}/bff/sessions/revoke-others`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}"
    });
    assert.equal(noOrigin.status, 403);
    const form = await fetch(`${running.base}/bff/sessions/revoke`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin, cookie },
      body: JSON.stringify({ handle })
    });
    assert.equal(form.status, 415);
    assert.equal((await sessions(running.base, cookie)).sessions.length, 2);
  });

  it("answers wrong methods as unknown routes", async () => {
    const cookie = await telegramLogin(running.base, 8_003);
    assert.equal((await post(running.base, "/bff/sessions", {}, { cookie })).status, 404);
    assert.equal((await fetch(`${running.base}/bff/sessions/revoke`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(`${running.base}/bff/sessions/revoke-others`, { headers: { cookie } })).status, 404);
  });
});

describe("sessions routes: listing", () => {
  let running: Running;
  before(async () => {
    running = await start();
  });
  after(async () => {
    await running.close();
  });

  it("lists only the caller's own sessions with opaque handles and coarse labels", async () => {
    const first = await telegramLogin(running.base, 8_101);
    const second = await telegramLogin(running.base, 8_101);
    const stranger = await telegramLogin(running.base, 8_102);
    const view = await sessions(running.base, second);
    assert.deepEqual(Object.keys(view).sort(), ["mode", "sessions"]);
    assert.equal(view.mode, "test");
    assert.equal(view.sessions.length, 2);
    assert.deepEqual(view.sessions.map((session) => session.current), [true, false]);
    for (const session of view.sessions) {
      assert.deepEqual(Object.keys(session).sort(), ["client", "createdAt", "current", "handle", "lastSeenAt"]);
      assert.match(session.handle, sessionHandlePattern);
      assert.equal(session.client, "telegram");
      assert.equal(session.createdAt, now);
      assert.equal(session.lastSeenAt, now);
    }
    const handles = view.sessions.map((session) => session.handle);
    assert.equal(new Set(handles).size, 2);
    const body = JSON.stringify(view);
    for (const secret of [first, second, stranger].map(sessionIdOf)) assert.ok(!body.includes(secret));
    for (const pii of ["8101", "8102", "synthetic_user", "Synthetic", "127.0.0.1", "tg-", "user-agent"]) assert.ok(!body.includes(pii), pii);
    const strangers = await sessions(running.base, stranger);
    assert.equal(strangers.sessions.length, 1);
    assert.ok(strangers.sessions.every((session) => !handles.includes(session.handle)));
    assert.equal((await sessions(running.base, first)).sessions.find((session) => session.current)?.handle, handles[1]);
  });

  it("labels dev logins server-side", async () => {
    const cookie = await devLogin(running.base);
    const view = await sessions(running.base, cookie);
    assert.deepEqual(view.sessions.map((session) => session.client), ["dev-login"]);
  });

  it("keeps handles stable while the server runs", async () => {
    const cookie = await telegramLogin(running.base, 8_103);
    const before = (await sessions(running.base, cookie)).sessions[0]?.handle;
    now += 1_000;
    assert.equal((await sessions(running.base, cookie)).sessions[0]?.handle, before);
  });

  it("derives different handles in another server instance", async () => {
    const other = await start();
    try {
      const a = await telegramLogin(running.base, 8_104);
      const b = await telegramLogin(other.base, 8_104);
      assert.notEqual((await sessions(running.base, a)).sessions[0]?.handle, (await sessions(other.base, b)).sessions[0]?.handle);
    } finally {
      await other.close();
    }
  });

  it("refreshes last-seen only at coarse granularity", async () => {
    const created = now;
    const cookie = await telegramLogin(running.base, 8_105);
    now += lastSeenGranularityMs - 1;
    assert.equal((await sessions(running.base, cookie)).sessions[0]?.lastSeenAt, created);
    now += 1;
    const seen = (await sessions(running.base, cookie)).sessions[0];
    assert.equal(seen?.createdAt, created);
    assert.equal(seen?.lastSeenAt, now);
  });

  it("omits expired sessions and refuses to revoke them", async () => {
    const old = await telegramLogin(running.base, 8_106);
    const oldHandle = (await sessions(running.base, old)).sessions[0]?.handle ?? "";
    now += 1_700_000;
    const fresh = await telegramLogin(running.base, 8_106);
    assert.equal((await sessions(running.base, fresh)).sessions.length, 2);
    now += 200_000;
    const view = await sessions(running.base, fresh);
    assert.deepEqual(view.sessions.map((session) => session.current), [true]);
    assert.equal((await revoke(running.base, fresh, oldHandle)).status, 404);
    assert.equal(await authenticated(running.base, old), false);
  });

  it("caps listings at five sessions per subject", async () => {
    let cookie = "";
    for (let index = 0; index < 7; index += 1) cookie = await telegramLogin(running.base, 8_107);
    assert.equal((await sessions(running.base, cookie)).sessions.length, 5);
  });
});

describe("sessions routes: revocation", () => {
  let running: Running;
  before(async () => {
    running = await start();
  });
  after(async () => {
    await running.close();
  });

  it("revokes another own session idempotently", async () => {
    const other = await telegramLogin(running.base, 8_201);
    const current = await telegramLogin(running.base, 8_201);
    const handle = await otherHandle(running.base, current);
    const first = await revoke(running.base, current, handle);
    assert.equal(first.status, 200);
    const view = await first.json() as DeviceSessionsView;
    assert.deepEqual(view.sessions.map((session) => session.current), [true]);
    assert.equal(await authenticated(running.base, other), false);
    assert.equal(await authenticated(running.base, current), true);
    const again = await revoke(running.base, current, handle);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), view);
    const kinds = (await activity(running.base, current)).items.filter((item) => item.kind === "session_revoked");
    assert.equal(kinds.length, 1);
  });

  it("rejects the current session and points to logout", async () => {
    const current = await telegramLogin(running.base, 8_202);
    const own = (await sessions(running.base, current)).sessions[0]?.handle ?? "";
    const response = await revoke(running.base, current, own);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "current_session" });
    assert.equal(await authenticated(running.base, current), true);
  });

  it("answers another subject's handle exactly like an unknown handle", async () => {
    await telegramLogin(running.base, 8_203);
    const victim = await telegramLogin(running.base, 8_203);
    const victimHandles = (await sessions(running.base, victim)).sessions.map((session) => session.handle);
    const attacker = await telegramLogin(running.base, 8_204);
    const unknown = await revoke(running.base, attacker, `ses_${"0".repeat(32)}`);
    const unknownBody = await unknown.text();
    for (const handle of victimHandles) {
      const response = await revoke(running.base, attacker, handle);
      assert.equal(response.status, unknown.status);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), unknownBody);
    }
    assert.equal((await sessions(running.base, victim)).sessions.length, 2);
    assert.equal(await authenticated(running.base, victim), true);
    const victimRevoked = await otherHandle(running.base, victim);
    assert.equal((await revoke(running.base, victim, victimRevoked)).status, 200);
    const replay = await revoke(running.base, attacker, victimRevoked);
    assert.equal(replay.status, 404);
    assert.equal(await replay.text(), unknownBody);
    assert.equal((await post(running.base, "/bff/sessions/revoke-others", {}, { cookie: attacker })).status, 200);
    assert.equal(await authenticated(running.base, victim), true);
  });

  it("revokes all other sessions but keeps the current one", async () => {
    const others = [await telegramLogin(running.base, 8_205), await telegramLogin(running.base, 8_205)];
    const current = await telegramLogin(running.base, 8_205);
    const bystander = await telegramLogin(running.base, 8_206);
    const response = await post(running.base, "/bff/sessions/revoke-others", {}, { cookie: current });
    assert.equal(response.status, 200);
    const view = await response.json() as DeviceSessionsView;
    assert.deepEqual(view.sessions.map((session) => session.current), [true]);
    for (const cookie of others) assert.equal(await authenticated(running.base, cookie), false);
    assert.equal(await authenticated(running.base, current), true);
    assert.equal(await authenticated(running.base, bystander), true);
    const repeat = await post(running.base, "/bff/sessions/revoke-others", {}, { cookie: current });
    assert.equal(repeat.status, 200);
    const revoked = (await activity(running.base, current)).items.filter((item) => item.kind === "session_revoked");
    assert.deepEqual(revoked.map((item) => item.kind === "session_revoked" && [item.scope, item.count]), [["others", 2]]);
    assert.equal((await activity(running.base, bystander)).items.some((item) => item.kind === "session_revoked"), false);
  });

  it("records revocations in activity without handles", async () => {
    await telegramLogin(running.base, 8_207);
    const current = await telegramLogin(running.base, 8_207);
    const handle = await otherHandle(running.base, current);
    assert.equal((await revoke(running.base, current, handle)).status, 200);
    const view = await activity(running.base, current);
    const item = view.items.find((entry) => entry.kind === "session_revoked");
    assert.ok(item);
    assert.deepEqual(Object.keys(item).sort(), ["at", "count", "id", "kind", "scope"]);
    assert.ok(!JSON.stringify(view).includes(handle));
    assert.ok(!JSON.stringify(view).includes(handle.slice(4)));
  });

  it("still lets logout end the current session", async () => {
    await telegramLogin(running.base, 8_208);
    const current = await telegramLogin(running.base, 8_208);
    assert.equal((await post(running.base, "/bff/auth/logout", {}, { cookie: current })).status, 200);
    assert.equal((await fetch(`${running.base}/bff/sessions`, { headers: { cookie: current } })).status, 401);
  });
});

describe("sessions routes: logs", () => {
  it("never logs handles, cookies or Telegram identities", async () => {
    const running = await start(config({ MINIAPP_LOG: "json" }));
    try {
      const other = await telegramLogin(running.base, 8_301);
      const current = await telegramLogin(running.base, 8_301);
      const handles = (await sessions(running.base, current)).sessions.map((session) => session.handle);
      const handle = await otherHandle(running.base, current);
      await revoke(running.base, current, handle);
      await revoke(running.base, current, `ses_${"0".repeat(32)}`);
      await post(running.base, "/bff/sessions/revoke-others", {}, { cookie: current });
      for (let attempt = 0; attempt < 200 && running.lines.length < 7; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(running.lines.length >= 7);
      const secrets = [...handles, ...handles.map((value) => value.slice(4)), sessionIdOf(other), sessionIdOf(current), "8301", "synthetic_user"];
      for (const line of running.lines) {
        for (const secret of secrets) assert.ok(!line.includes(secret), `${secret} leaked into log`);
      }
      const routes = running.lines.map((line) => (JSON.parse(line) as { route: string }).route);
      assert.ok(routes.includes("/bff/sessions/revoke"));
      assert.ok(routes.includes("/bff/sessions/revoke-others"));
    } finally {
      await running.close();
    }
  });
});
