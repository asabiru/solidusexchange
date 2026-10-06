import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { KycVerificationView, SessionView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { createSimulatorQuoteProvider } from "./provider-quotes.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const devTelegramUserId = 900_000_001;
let now = 1_790_000_000_000;

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }),
    telegramBotToken: syntheticToken,
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
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

function telegramInitData(userId: number): string {
  return signInitData(new Map([
    ["auth_date", String(Math.floor(now / 1_000) - 5)],
    ["user", JSON.stringify({ id: userId, first_name: "Synthetic" })]
  ]), syntheticToken);
}

async function telegramLogin(base: string, userId: number): Promise<string> {
  const response = await post(base, "/bff/session/telegram", { initData: telegramInitData(userId) });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function getJson<T>(base: string, path: string, cookie: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, path);
  return await response.json() as T;
}

describe("BFF audit: dev-synthetic and Telegram subjects never share KYC state", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("does not verify the Telegram user whose id matches the dev login user", async () => {
    const dev = await post(running.base, "/bff/auth/dev-session", { kyc: "kyc-gated" });
    assert.equal(dev.status, 201);
    const devCookie = cookieOf(dev);
    assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie: devCookie })).status, 202);
    let devView: SessionView | undefined;
    for (let step = 0; step < 120 && devView?.kyc !== "verified"; step += 1) {
      now += 10_000;
      devView = await getJson<SessionView>(running.base, "/bff/session", devCookie);
    }
    assert.equal(devView?.kyc, "verified");

    const telegramCookie = await telegramLogin(running.base, devTelegramUserId);
    const telegram = await getJson<SessionView>(running.base, "/bff/session", telegramCookie);
    assert.equal(telegram.kyc, "kyc-gated");
    assert.notEqual(telegram.customerRef, devView?.customerRef);
    const kyc = await getJson<KycVerificationView>(running.base, "/bff/kyc/status", telegramCookie);
    assert.equal(kyc.state, "not_started");
  });

  it("does not let a dev login reset a Telegram user's KYC application", async () => {
    const telegramCookie = await telegramLogin(running.base, devTelegramUserId);
    assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie: telegramCookie })).status, 202);
    assert.equal((await post(running.base, "/bff/auth/dev-session", { kyc: "kyc-gated" })).status, 201);
    const kyc = await getJson<KycVerificationView>(running.base, "/bff/kyc/status", telegramCookie);
    assert.notEqual(kyc.state, "not_started");
    assert.equal(kyc.canSubmit, false);
  });
});

describe("BFF audit: sessions per subject are bounded", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("evicts the oldest sessions when one initData is replayed to mint many sessions", async () => {
    const initData = telegramInitData(4_242);
    const cookies: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const response = await post(running.base, "/bff/session/telegram", { initData });
      assert.equal(response.status, 201);
      cookies.push(cookieOf(response));
    }
    const statuses: number[] = [];
    for (const cookie of cookies) {
      statuses.push((await fetch(`${running.base}/bff/session`, { headers: { cookie } })).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 200, 200, 200, 200, 200]);
  });

  it("keeps other subjects' sessions when one subject mints many sessions", async () => {
    const victim = await telegramLogin(running.base, 5_151);
    const initData = telegramInitData(6_262);
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await post(running.base, "/bff/session/telegram", { initData })).status, 201);
    }
    assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie: victim } })).status, 200);
  });
});

describe("BFF audit: one subject cannot exhaust the quote replay cache", () => {
  it("keeps serving other subjects after a flood of previews from one subject", async () => {
    const clockMs = 1_790_000_000_000;
    const quotes = createSimulatorQuoteProvider({ seed: "miniapp-audit", ttlSeconds: 30, clock: () => clockMs });
    const context = (subject: string) => ({ nowMs: clockMs, ttlSeconds: 30, kycRequired: false, subject });
    for (let index = 0; index < 10_050; index += 1) {
      await quotes.preview({ from: "USDT", to: "RUB", amount: "100" }, context("tg-aaaaaaaaaaaaaaaa"));
    }
    const victim = await quotes.preview({ from: "USDT", to: "RUB", amount: "100" }, context("tg-bbbbbbbbbbbbbbbb"));
    assert.equal(victim.executable, false);
    assert.match(victim.id, /^quote_[0-9a-f]{32}$/);
  });
});
