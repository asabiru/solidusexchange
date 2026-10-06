import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AddressScreeningView, KycVerificationView, SessionView } from "../shared/api.js";
import { type AddressScreeningService, createAddressScreeningService } from "./address-screening.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const tonTestnet = "kQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RCIT";
const tonTestnetOther = "0QCKkZifpq20u8LJ0Nfe5ezz-gEIDxYdJCsyOUBHTlVcY3mp";
const tonMainnet = "EQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RJmZ";
const tronTestnet = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
const tronTestnetOther = "TKmJ2NCHa7qnFxj5KVNQ36Kfpri5L859h5";
const unknownId = `scr_${"0".repeat(32)}`;
let now = 1_790_000_000_000;

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function tonTestnetAddress(fill: number): string {
  const bytes = Buffer.alloc(36);
  bytes[0] = 0x91;
  for (let index = 2; index < 34; index += 1) bytes[index] = (fill * 13 + index * 3) & 0xff;
  bytes.writeUInt16BE(crc16(bytes.subarray(0, 34)), 34);
  return bytes.toString("base64url");
}

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

async function start(serverConfig: ServerConfig, addressScreening?: AddressScreeningService): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now, addressScreening });
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
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function screen(base: string, cookie: string, address = tonTestnet, asset = "TON", network = "TON_TESTNET") {
  return post(base, "/bff/address-screening", { asset, network, address }, { cookie });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function telegramLogin(base: string, userId: number): Promise<string> {
  const initData = signInitData(new Map([
    ["auth_date", String(Math.floor(now / 1_000) - 5)],
    ["user", JSON.stringify({ id: userId, first_name: "Synthetic" })]
  ]), syntheticToken);
  const response = await post(base, "/bff/session/telegram", { initData });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function getJson<T>(base: string, path: string, cookie: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, path);
  return await response.json() as T;
}

async function approveKyc(base: string, cookie: string): Promise<void> {
  assert.equal((await post(base, "/bff/kyc/applications", {}, { cookie })).status, 202);
  for (let step = 0; step < 120; step += 1) {
    now += 10_000;
    if ((await getJson<KycVerificationView>(base, "/bff/kyc/status", cookie)).state === "approved") return;
  }
  assert.fail("KYC never approved");
}

async function settle(base: string, cookie: string, id: string): Promise<AddressScreeningView> {
  for (let step = 0; step < 200; step += 1) {
    now += 5_000;
    const view = await getJson<AddressScreeningView>(base, `/bff/address-screening/${id}`, cookie);
    if (view.status !== "pending") return view;
  }
  assert.fail("screening never settled");
}

function assertSafe(text: string): void {
  for (const address of [tonTestnet, tonTestnetOther, tronTestnet, tronTestnetOther]) {
    assert.equal(text.includes(address), false);
  }
  assert.doesNotMatch(text, /sim-|kytasm|kytevt|binding|risk_score|categories|sanctions/);
}

describe("address screening routes: authentication, CSRF and strict input", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("requires a session for submission and lookup", async () => {
    assert.equal((await screen(running.base, "")).status, 401);
    assert.equal((await fetch(`${running.base}/bff/address-screening/${unknownId}`)).status, 401);
    const forged = "smx_session=00000000-0000-4000-8000-000000000000";
    assert.equal((await screen(running.base, forged)).status, 401);
    assert.equal((await fetch(`${running.base}/bff/address-screening/${unknownId}`, { headers: { cookie: forged } })).status, 401);
  });

  it("applies the exact-Origin CSRF check before any screening is created", async () => {
    const cookie = await devLogin(running.base);
    const body = { asset: "TON", network: "TON_TESTNET", address: tonTestnet };
    for (const bad of ["http://evil.example", "null", "http://127.0.0.1:4183.evil.example", "http://localhost:4184"]) {
      assert.equal((await post(running.base, "/bff/address-screening", body, { cookie, origin: bad })).status, 403, bad);
    }
    const missing = await fetch(`${running.base}/bff/address-screening`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body)
    });
    assert.equal(missing.status, 403);
    assert.equal((await screen(running.base, cookie)).status, 202);
  });

  it("accepts only the exact JSON body and no device identifier", async () => {
    const cookie = await devLogin(running.base);
    for (const body of [
      { asset: "TON", network: "TON_TESTNET" },
      { asset: "TON", network: "TON_TESTNET", address: tonTestnet, status: "low" },
      { asset: "TON", network: "TON_TESTNET", address: tonTestnet, executable: "true" },
      { asset: "TON", network: "TON_TESTNET", address: 1 },
      { asset: "TON", network: "TON_TESTNET", address: "k".repeat(5_000) },
      [],
      `{"asset":"TON","network":"TON_TESTNET","address":"${tonTestnet}","address":"${tonTestnetOther}"}`,
      "{not json"
    ]) {
      assert.equal((await post(running.base, "/bff/address-screening", body, { cookie })).status, 400, JSON.stringify(body).slice(0, 80));
    }
    const plain = await fetch(`${running.base}/bff/address-screening`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin, cookie },
      body: JSON.stringify({ asset: "TON", network: "TON_TESTNET", address: tonTestnet })
    });
    assert.equal(plain.status, 415);
    const device = await post(running.base, "/bff/address-screening", { asset: "TON", network: "TON_TESTNET", address: tonTestnet }, { cookie, "x-device-id": "sim-device" });
    assert.equal(device.status, 400);
  });

  it("rejects unsupported pairs and malformed or mainnet addresses with 400", async () => {
    const cookie = await devLogin(running.base);
    for (const [asset, network, address, error] of [
      ["RUB", "TON_TESTNET", tonTestnet, "invalid_target"],
      ["TON", "TRON_TESTNET", tronTestnet, "invalid_target"],
      ["USDT", "ETH_TESTNET", tronTestnet, "invalid_target"],
      ["TON", "TON_TESTNET", tonMainnet, "invalid_address"],
      ["TON", "TON_TESTNET", tronTestnet, "invalid_address"],
      ["USDT", "TON_TESTNET", `${tonTestnet.slice(0, -1)}A`, "invalid_address"],
      ["USDT", "TRON_TESTNET", tonTestnet, "invalid_address"],
      ["USDT", "TRON_TESTNET", `${tronTestnet.slice(0, -1)}1`, "invalid_address"],
      ["USDT", "TRON_TESTNET", ` ${tronTestnet}`, "invalid_address"],
      ["USDT", "TRON_TESTNET", "T".repeat(65), "invalid_address"]
    ]) {
      const response = await screen(running.base, cookie, address, asset, network);
      assert.equal(response.status, 400, `${asset} ${network} ${address}`);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { error });
      assert.equal(text.includes(address.trim()), false);
    }
  });

  it("requires verified KYC for submission and lookup", async () => {
    const cookie = await devLogin(running.base, "kyc-gated");
    const response = await screen(running.base, cookie);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "kyc_required" });
    const lookup = await fetch(`${running.base}/bff/address-screening/${unknownId}`, { headers: { cookie } });
    assert.equal(lookup.status, 403);
    assert.deepEqual(await lookup.json(), { error: "kyc_required" });
  });

  it("exposes no callback, execution or operator route", async () => {
    const cookie = await devLogin(running.base);
    const created = await (await screen(running.base, cookie, tronTestnet, "USDT", "TRON_TESTNET")).json() as AddressScreeningView;
    for (const path of [
      `/bff/address-screening/${created.id}`,
      "/bff/address-screening/callbacks",
      "/bff/kyt/callbacks",
      "/bff/operator/address-screening"
    ]) {
      assert.equal((await post(running.base, path, {}, { cookie })).status, 404, path);
    }
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${running.base}/bff/address-screening/${created.id}`, { method, headers: { origin, cookie } });
      assert.equal(response.status, 404, method);
    }
    assert.equal((await fetch(`${running.base}/bff/address-screening/${created.id}?status=low`, { headers: { cookie } })).status, 400);
    assert.equal((await fetch(`${running.base}/bff/address-screening/${created.id}`, { headers: { cookie, "x-device-id": "sim-device" } })).status, 400);
    for (const id of [unknownId, `${unknownId.slice(0, -1)}g`, "scr_", `${created.id}0`]) {
      assert.equal((await fetch(`${running.base}/bff/address-screening/${id}`, { headers: { cookie } })).status, 404, id);
    }
  });

  it("rate-limits new screenings per subject without blocking repeats", async () => {
    const isolated = await start(config());
    try {
      const cookie = await devLogin(isolated.base);
      const statuses: number[] = [];
      for (let fill = 0; fill < 21; fill += 1) statuses.push((await screen(isolated.base, cookie, tonTestnetAddress(fill))).status);
      assert.deepEqual(statuses, [...Array(20).fill(202), 429]);
      assert.equal((await screen(isolated.base, cookie, tonTestnetAddress(19))).status, 200);
      const limited = await screen(isolated.base, cookie, tonTestnetAddress(30));
      assert.deepEqual(await limited.json(), { error: "screening_rate_limited" });
      now += 3_600_000;
      assert.equal((await screen(isolated.base, await devLogin(isolated.base), tonTestnetAddress(30))).status, 202);
    } finally {
      await isolated.close();
    }
  });
});

describe("address screening routes: outage, timeout and callback integrity", () => {
  it("reports a provider outage as 503 and an unavailable screening", async () => {
    const running = await start(config({ kytScenario: "provider_outage" }));
    try {
      const cookie = await devLogin(running.base);
      const response = await screen(running.base, cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assertSafe(text);
      const body = JSON.parse(text) as { error: string; screening: AddressScreeningView };
      assert.equal(body.error, "screening_unavailable");
      assert.equal(body.screening.status, "unavailable");
      assert.equal(body.screening.executable, false);
      now += 600_000;
      const view = await getJson<AddressScreeningView>(running.base, `/bff/address-screening/${body.screening.id}`, cookie);
      assert.equal(view.status, "unavailable");
    } finally {
      await running.close();
    }
  });

  it("reports timed_out when no signed completion arrives in time", async () => {
    const running = await start(config({ kytScenario: "pending_timeout", kytScreeningTimeoutSeconds: 60 }));
    try {
      const cookie = await devLogin(running.base);
      const created = await (await screen(running.base, cookie)).json() as AddressScreeningView;
      assert.equal(created.status, "pending");
      assert.equal((await settle(running.base, cookie, created.id)).status, "timed_out");
    } finally {
      await running.close();
    }
  });

  it("keeps the screening pending when forged, unsigned or out-of-order callbacks arrive", async () => {
    const screening = createAddressScreeningService({ seed: "miniapp-kyt-routes", scenario: "high", screeningTimeoutSeconds: 900, clock: () => now });
    const running = await start(config(), screening);
    try {
      const cookie = await devLogin(running.base);
      const created = await (await screen(running.base, cookie)).json() as AddressScreeningView;
      now += 120_000;
      const [ack, completion] = screening.drainDeliveries();
      assert.ok(ack && completion);
      assert.deepEqual(screening.receiveCallback({ headers: {}, body: completion.body }, completion.deliverAt), { verified: false, reason: "missing_header" });
      const forged = Buffer.from(completion.body.toString("utf8").replace("\"risk_level\":\"high\"", "\"risk_level\":\"low\""), "utf8");
      assert.deepEqual(screening.receiveCallback({ headers: completion.headers, body: forged }, completion.deliverAt), { verified: false, reason: "signature_mismatch" });
      assert.deepEqual(screening.receiveCallback(completion, completion.deliverAt), { verified: true, action: "buffered" });
      const path = `/bff/address-screening/${created.id}`;
      assert.equal((await getJson<AddressScreeningView>(running.base, path, cookie)).status, "pending");
      assert.deepEqual(screening.receiveCallback(completion, completion.deliverAt), { verified: false, reason: "replayed_nonce" });
      assert.deepEqual(screening.receiveCallback(ack, ack.deliverAt), { verified: true, action: "applied" });
      assert.equal((await getJson<AddressScreeningView>(running.base, path, cookie)).status, "high");
    } finally {
      await running.close();
    }
  });
});

describe("address screening integration: KYC-approved login → screening result", () => {
  it("screens an address only after signed KYC approval and isolates subjects", async () => {
    const running = await start(config({ kytScenario: "medium" }));
    try {
      const cookie = await telegramLogin(running.base, 900_000_101);
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "kyc-gated");
      assert.equal((await screen(running.base, cookie, tronTestnet, "USDT", "TRON_TESTNET")).status, 403);

      await approveKyc(running.base, cookie);
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "verified");

      const response = await screen(running.base, cookie, tronTestnet, "USDT", "TRON_TESTNET");
      assert.equal(response.status, 202);
      const text = await response.text();
      assertSafe(text);
      const created = JSON.parse(text) as AddressScreeningView;
      assert.deepEqual(
        { mode: created.mode, status: created.status, advisory: created.advisory, executable: created.executable, asset: created.asset, network: created.network },
        { mode: "test", status: "pending", advisory: true, executable: false, asset: "USDT", network: "TRON_TESTNET" }
      );

      const result = await settle(running.base, cookie, created.id);
      assert.equal(result.status, "medium");
      assert.equal(result.advisory, true);
      assert.equal(result.executable, false);
      assertSafe(JSON.stringify(result));

      const repeat = await screen(running.base, cookie, tronTestnet, "USDT", "TRON_TESTNET");
      assert.equal(repeat.status, 200);
      assert.equal((await repeat.json() as AddressScreeningView).status, "medium");

      const otherTelegram = await telegramLogin(running.base, 900_000_102);
      await approveKyc(running.base, otherTelegram);
      const devCookie = await devLogin(running.base);
      for (const other of [otherTelegram, devCookie]) {
        const lookup = await fetch(`${running.base}/bff/address-screening/${created.id}`, { headers: { cookie: other } });
        assert.equal(lookup.status, 404);
        assert.deepEqual(await lookup.json(), { error: "not_found" });
      }
      const foreign = await (await screen(running.base, otherTelegram, tronTestnet, "USDT", "TRON_TESTNET")).json() as AddressScreeningView;
      assert.notEqual(foreign.id, created.id);

      assert.equal((await post(running.base, "/bff/auth/logout", {}, { cookie })).status, 200);
      assert.equal((await fetch(`${running.base}/bff/address-screening/${created.id}`, { headers: { cookie } })).status, 401);
    } finally {
      await running.close();
    }
  });
});

describe("address screening: browser bundle boundary", () => {
  const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

  function browserSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return path === join(sourceRoot, "server") ? [] : browserSources(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
  }

  it("keeps provider simulators, node: modules and server code out of browser sources", () => {
    const files = browserSources(sourceRoot);
    assert.ok(files.some((file) => file.endsWith(join("app", "sheets.tsx"))));
    assert.ok(files.some((file) => file.endsWith(join("shared", "address-screening.ts"))));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((match) => match[1] ?? "");
      for (const specifier of specifiers) {
        assert.doesNotMatch(specifier, /^node:|provider-simulators|\/server\//, `${file}: ${specifier}`);
      }
    }
  });

  it("offers no send or execution action in the screening sheet", () => {
    const sheets = readFileSync(join(sourceRoot, "app", "sheets.tsx"), "utf8");
    const start = sheets.indexOf("function AddressScreeningSheet(");
    const end = sheets.indexOf("\nfunction ", start + 1);
    assert.ok(start > 0 && end > start);
    const sheet = sheets.slice(start, end);
    assert.match(sheet, /t\("screening\.banner"\)/);
    assert.match(sheet, /t\("screening\.title"\)/);
    const catalog = readFileSync(join(sourceRoot, "app", "locales", "ru.ts"), "utf8");
    assert.match(catalog, /"screening\.banner": "Тестовый режим — перевод не выполняется"/);
    assert.match(catalog, /"screening\.title": "Проверить адрес \(тест\)"/);
    assert.doesNotMatch(sheet, /Отправить|Перевести|Вывести|withdraw|transfer|executable: true/i);
  });
});
