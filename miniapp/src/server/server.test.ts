import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { OperationDetail, QuotePreview, SessionView, WalletView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { createMiniappServer, routeTable, sessionCookie } from "./server.js";

const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const origin = "http://127.0.0.1:4183";
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

async function start(serverConfig: ServerConfig): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
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
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0];
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

describe("dev BFF configuration", () => {
  it("defaults to loopback, dev login off and bounded TTLs", () => {
    const loaded = loadServerConfig({});
    assert.equal(loaded.host, "127.0.0.1");
    assert.equal(loaded.port, 4184);
    assert.equal(loaded.allowDevLogin, false);
    assert.equal(loaded.telegramBotToken, undefined);
    assert.deepEqual(loaded.allowedOrigins, ["http://127.0.0.1:4183", "http://localhost:4183"]);
    assert.equal(loaded.quoteTtlSeconds, 30);
  });

  it("refuses non-loopback hosts, non-loopback HTTP origins and malformed tokens", () => {
    assert.throws(() => loadServerConfig({ MINIAPP_BFF_HOST: "0.0.0.0" }));
    assert.throws(() => loadServerConfig({ MINIAPP_ALLOWED_ORIGINS: "http://example.test" }));
    assert.throws(() => loadServerConfig({ MINIAPP_ALLOWED_ORIGINS: "http://127.0.0.1:4183/path" }));
    assert.throws(() => loadServerConfig({ MINIAPP_TELEGRAM_BOT_TOKEN: "not-a-token" }));
    assert.throws(() => loadServerConfig({ MINIAPP_QUOTE_TTL_SECONDS: "1" }));
    assert.equal(loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "1" }).allowDevLogin, false);
    assert.equal(
      loadServerConfig({ MINIAPP_TELEGRAM_BOT_TOKEN: syntheticToken }).telegramBotToken,
      syntheticToken
    );
  });

  it("refuses NODE_ENV=production in any casing or padding", () => {
    for (const value of ["production", " Production ", "PRODUCTION"]) {
      assert.throws(() => loadServerConfig({ NODE_ENV: value, MINIAPP_ALLOW_DEV_LOGIN: "true" }), /NODE_ENV=production/);
    }
    assert.equal(loadServerConfig({ NODE_ENV: "development" }).host, "127.0.0.1");
  });
});

describe("session and Origin boundary", () => {
  let running: Running;
  before(async () => {
    running = await start(config({ telegramBotToken: syntheticToken }));
  });
  after(async () => {
    await running.close();
  });

  it("issues an HttpOnly SameSite=Strict session cookie scoped to /bff", async () => {
    const response = await post(running.base, "/bff/auth/dev-session", { kyc: "verified" });
    assert.equal(response.status, 201);
    const header = response.headers.get("set-cookie") ?? "";
    assert.match(header, new RegExp(`^${sessionCookie}=[0-9a-f-]{36}; `));
    assert.match(header, /; Path=\/bff;/);
    assert.match(header, /; HttpOnly;/);
    assert.match(header, /; SameSite=Strict;/);
    assert.doesNotMatch(header, /Secure/);
    const body = await response.json() as SessionView;
    assert.equal(body.source, "dev-synthetic");
    assert.equal(body.kyc, "verified");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("rejects state-changing POSTs without the exact allowed Origin", async () => {
    for (const headers of [{ origin: "" }, { origin: "http://127.0.0.1:4999" }, { origin: "http://evil.test" }, { origin: `${origin}/` }]) {
      const telegram = await post(running.base, "/bff/session/telegram", { initData: "a=1" }, headers);
      assert.equal(telegram.status, 403, headers.origin);
      const logout = await post(running.base, "/bff/auth/logout", {}, headers);
      assert.equal(logout.status, 403, headers.origin);
      const dev = await post(running.base, "/bff/auth/dev-session", {}, headers);
      assert.equal(dev.status, 404, headers.origin);
    }
  });

  it("requires a session for customer data", async () => {
    for (const path of ["/bff/session", "/bff/wallet", "/bff/operations", "/bff/operations/op-89104", "/bff/profile", "/bff/quotes/preview?from=RUB&to=USDT&amount=1"]) {
      const response = await fetch(`${running.base}${path}`);
      assert.equal(response.status, 401, path);
    }
    const forged = await fetch(`${running.base}/bff/session`, { headers: { cookie: `${sessionCookie}=forged` } });
    assert.equal(forged.status, 401);
  });

  it("verifies Telegram initData before creating a session", async () => {
    const authDate = String(Math.floor(now / 1_000) - 5);
    const initData = signInitData(new Map([
      ["auth_date", authDate],
      ["user", JSON.stringify({ id: 42, first_name: "Synthetic" })]
    ]), syntheticToken);
    const accepted = await post(running.base, "/bff/session/telegram", { initData });
    assert.equal(accepted.status, 201);
    const session = await accepted.json() as SessionView;
    assert.equal(session.source, "telegram");
    assert.equal(session.kyc, "kyc-gated");
    assert.equal(session.displayName, "Тестовый клиент");

    const tampered = await post(running.base, "/bff/session/telegram", { initData: initData.replace("42", "43") });
    assert.equal(tampered.status, 401);
    assert.deepEqual(await tampered.json(), { error: "init_data_rejected", reason: "invalid_hash" });
    assert.equal(tampered.headers.get("set-cookie"), null);

    const stale = signInitData(new Map([
      ["auth_date", String(Math.floor(now / 1_000) - 3_600)],
      ["user", JSON.stringify({ id: 42 })]
    ]), syntheticToken);
    const staleResponse = await post(running.base, "/bff/session/telegram", { initData: stale });
    assert.deepEqual(await staleResponse.json(), { error: "init_data_rejected", reason: "stale_auth_date" });
  });

  it("rejects non-JSON and unexpected request bodies", async () => {
    const text = await fetch(`${running.base}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin },
      body: "{}"
    });
    assert.equal(text.status, 415);
    const extra = await post(running.base, "/bff/auth/dev-session", { kyc: "verified", role: "admin" });
    assert.equal(extra.status, 400);
    const badKyc = await post(running.base, "/bff/auth/dev-session", { kyc: "unlimited" });
    assert.equal(badKyc.status, 400);
    const duplicate = await fetch(`${running.base}/bff/session/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: "{\"initData\":\"a\",\"initData\":\"b\"}"
    });
    assert.equal(duplicate.status, 400);
  });

  it("revokes the session on logout", async () => {
    const cookie = await devLogin(running.base);
    assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie } })).status, 200);
    const logout = await post(running.base, "/bff/auth/logout", {}, { cookie });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie } })).status, 401);
  });

  it("revokes the previous session on a new login", async () => {
    const first = await devLogin(running.base);
    const second = await post(running.base, "/bff/auth/dev-session", { kyc: "kyc-gated" }, { cookie: first });
    assert.equal(second.status, 201);
    assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie: first } })).status, 401);
    assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie: cookieOf(second) } })).status, 200);
  });

  it("expires sessions after the configured TTL", async () => {
    const cookie = await devLogin(running.base);
    now += 1_800_000;
    try {
      assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie } })).status, 401);
    } finally {
      now -= 1_800_000;
    }
  });

  it("rejects requests whose Host is not loopback", async () => {
    const { port } = new URL(running.base);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: Number(port),
        path: "/bff/health",
        headers: { host: "rebind.example.test" }
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(status, 421);
  });
});

describe("dev login gating", () => {
  it("returns 404 when the explicit dev login flag is off", async () => {
    const running = await start(config({ allowDevLogin: false }));
    try {
      const response = await post(running.base, "/bff/auth/dev-session", {});
      assert.equal(response.status, 404);
      const health = await (await fetch(`${running.base}/bff/health`)).json();
      assert.deepEqual(health, {
        mode: "dev-synthetic",
        devLogin: false,
        telegramVerification: "not-configured",
        moneyMovement: "disabled"
      });
    } finally {
      await running.close();
    }
  });

  it("returns 404 for a non-loopback allowed origin", async () => {
    const running = await start(config({ allowedOrigins: ["https://miniapp.example.test"] }));
    try {
      const response = await post(running.base, "/bff/auth/dev-session", {}, { origin: "https://miniapp.example.test" });
      assert.equal(response.status, 404);
    } finally {
      await running.close();
    }
  });

  it("answers 503 for Telegram sessions when no bot token is configured", async () => {
    const running = await start(config());
    try {
      const response = await post(running.base, "/bff/session/telegram", { initData: "a=1" });
      assert.equal(response.status, 503);
    } finally {
      await running.close();
    }
  });
});

describe("synthetic customer data", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("serves verified balances and holds for RUB, USDT and TON as decimal strings", async () => {
    const cookie = await devLogin(running.base, "verified");
    const wallet = await (await fetch(`${running.base}/bff/wallet`, { headers: { cookie } })).json() as WalletView;
    assert.deepEqual(wallet.assets.map((asset) => asset.code), ["RUB", "USDT", "TON"]);
    assert.equal(wallet.kyc, "verified");
    for (const asset of wallet.assets) {
      assert.match(asset.available, /^\d+\.\d+$/);
      assert.match(asset.hold, /^\d+\.\d+$/);
    }
    assert.match(wallet.totalRub, /^\d+\.\d{2}$/);
    assert.notEqual(wallet.holdRub, "0.00");
  });

  it("serves an empty, zero-balance view while KYC gated", async () => {
    const cookie = await devLogin(running.base, "kyc-gated");
    const wallet = await (await fetch(`${running.base}/bff/wallet`, { headers: { cookie } })).json() as WalletView;
    assert.equal(wallet.kyc, "kyc-gated");
    assert.equal(wallet.totalRub, "0.00");
    const operations = await (await fetch(`${running.base}/bff/operations`, { headers: { cookie } })).json();
    assert.deepEqual(operations, { operations: [] });
    assert.equal((await fetch(`${running.base}/bff/operations/op-89104`, { headers: { cookie } })).status, 404);
  });

  it("serves operation details with a timeline", async () => {
    const cookie = await devLogin(running.base, "verified");
    const list = await (await fetch(`${running.base}/bff/operations`, { headers: { cookie } })).json() as { operations: OperationDetail[] };
    assert.ok(list.operations.length >= 5);
    assert.equal(list.operations[0].timeline, undefined);
    const detail = await (await fetch(`${running.base}/bff/operations/op-89071`, { headers: { cookie } })).json() as OperationDetail;
    assert.equal(detail.status, "in-review");
    assert.ok(detail.timeline.some((step) => step.state === "current"));
    assert.equal((await fetch(`${running.base}/bff/operations/op-missing`, { headers: { cookie } })).status, 404);
  });

  it("reports limits as not configured per D-014 and never as unlimited", async () => {
    const cookie = await devLogin(running.base, "verified");
    const response = await fetch(`${running.base}/bff/profile`, { headers: { cookie } });
    const text = await response.text();
    const profile = JSON.parse(text);
    assert.equal(profile.limits.status, "not_configured");
    assert.equal(profile.limits.decision, "D-014");
    assert.doesNotMatch(text, /unlimited|безлимит|без лимит|неогранич/i);
  });

  it("serves deterministic, non-executable quote previews", async () => {
    const cookie = await devLogin(running.base, "verified");
    const response = await fetch(`${running.base}/bff/quotes/preview?from=RUB&to=USDT&amount=5000`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const quote = await response.json() as QuotePreview;
    assert.equal(quote.amountOut, "53.681807");
    assert.equal(quote.executable, false);
    assert.equal(quote.expiresAt, now + 30_000);
    const invalid = await fetch(`${running.base}/bff/quotes/preview?from=RUB&to=USDT&amount=1e3`, { headers: { cookie } });
    assert.equal(invalid.status, 400);
  });
});

describe("money movement is absent", () => {
  const moneyWords = /execut|confirm|withdraw|deposit|transfer|payout|send|order|trade|swap|pay/i;

  it("declares no money-moving route", () => {
    const postPaths = routeTable.filter((route) => route.method === "POST").map((route) => route.path);
    assert.deepEqual(postPaths.sort(), ["/bff/address-screening", "/bff/auth/dev-session", "/bff/auth/logout", "/bff/kyc/applications", "/bff/notifications/read", "/bff/session/telegram", "/bff/sessions/revoke", "/bff/sessions/revoke-others", "/bff/support/requests"]);
    for (const route of routeTable) {
      assert.doesNotMatch(route.path, moneyWords, route.path);
    }
  });

  it("answers 404 to execute, withdraw and deposit POSTs even with a valid session", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const paths = [
        "/bff/exchange/execute",
        "/bff/exchange/confirm",
        "/bff/quotes/Q-1/execute",
        "/bff/quotes/Q-1/confirm",
        "/bff/quotes/preview",
        "/bff/orders",
        "/bff/withdraw",
        "/bff/withdrawals",
        "/bff/deposit",
        "/bff/deposits",
        "/bff/qr/pay",
        "/bff/transfers",
        "/bff/wallet"
      ];
      for (const path of paths) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = await fetch(`${running.base}${path}`, {
            method,
            headers: { "content-type": "application/json", origin, cookie, "idempotency-key": "synthetic-1" },
            body: JSON.stringify({ amount: "1" })
          });
          assert.equal(response.status, 404, `${method} ${path}`);
        }
      }
    } finally {
      await running.close();
    }
  });
});
