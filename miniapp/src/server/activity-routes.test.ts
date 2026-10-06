import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ActivityView, AddressScreeningView, KycVerificationView, QuotePreview, SessionView } from "../shared/api.js";
import { activityIdPattern } from "./activity.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { type KycService, applicantRefOf, createKycService } from "./kyc.js";
import { createMiniappServer, routeTable } from "./server.js";

const origin = "http://127.0.0.1:4183";
const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const tonTestnet = "kQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RCIT";
const tronTestnet = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
let now = 1_790_000_000_000;

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true", MINIAPP_QUOTE_SOURCE: "provider-simulator" }),
    telegramBotToken: syntheticToken,
    ...overrides
  };
}

interface Running {
  base: string;
  close: () => Promise<void>;
}

async function start(serverConfig: ServerConfig, kyc?: KycService): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now, kyc });
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

async function devLogin(base: string, kyc = "kyc-gated"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
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

async function getJson<T>(base: string, path: string, cookie: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, path);
  return await response.json() as T;
}

function activity(base: string, cookie: string, query = ""): Promise<ActivityView> {
  return getJson<ActivityView>(base, `/bff/activity${query}`, cookie);
}

async function kinds(base: string, cookie: string): Promise<string[]> {
  return (await activity(base, cookie)).items.map((item) => item.kind);
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

describe("activity route: authentication and strict input", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("requires a valid session", async () => {
    assert.equal((await fetch(`${running.base}/bff/activity`)).status, 401);
    const forged = { cookie: "solidchange_ma_session=00000000-0000-4000-8000-000000000000" };
    assert.equal((await fetch(`${running.base}/bff/activity`, { headers: forged })).status, 401);
    assert.equal((await fetch(`${running.base}/bff/activity?limit=5`)).status, 401);
  });

  it("returns a test-mode, non-executable envelope", async () => {
    const cookie = await devLogin(running.base);
    const response = await fetch(`${running.base}/bff/activity`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const view = await response.json() as ActivityView;
    assert.deepEqual(Object.keys(view).sort(), ["executable", "items", "mode"]);
    assert.equal(view.mode, "test");
    assert.equal(view.executable, false);
    assert.equal(view.items[0]?.kind, "session_login");
    assert.match(view.items[0]?.id ?? "", activityIdPattern);
  });

  it("accepts only an optional limit between 1 and 50", async () => {
    const cookie = await devLogin(running.base);
    for (let index = 0; index < 3; index += 1) await devLogin(running.base);
    assert.equal((await activity(running.base, cookie, "?limit=1")).items.length, 1);
    assert.equal((await activity(running.base, cookie, "?limit=2")).items.length, 2);
    assert.ok((await activity(running.base, cookie, "?limit=50")).items.length >= 4);
    for (const query of [
      "?limit=0",
      "?limit=51",
      "?limit=100",
      "?limit=-1",
      "?limit=05",
      "?limit=1.5",
      "?limit=1e1",
      "?limit=abc",
      "?limit=",
      "?limit",
      "?LIMIT=5",
      "?limit=5&limit=6",
      "?limit=5&",
      "?limit=5&kind=kyc_approved",
      "?subject=tg-0000000000000000",
      "?kind=kyc_approved",
      "?limit=%35"
    ]) {
      const response = await fetch(`${running.base}/bff/activity${query}`, { headers: { cookie } });
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
  });

  it("rejects X-Device-Id on the customer activity route", async () => {
    const cookie = await devLogin(running.base);
    const response = await fetch(`${running.base}/bff/activity`, {
      headers: { cookie, "x-device-id": "00000000-0000-4000-8000-000000000000" }
    });
    assert.equal(response.status, 400);
  });

  it("offers no way for the client to write activity", async () => {
    const cookie = await devLogin(running.base);
    const before = await kinds(running.base, cookie);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of ["/bff/activity", "/bff/activity/act_000000000000000000000000", "/bff/kyc/callbacks"]) {
        const response = await fetch(`${running.base}${path}`, {
          method,
          headers: { "content-type": "application/json", origin, cookie },
          body: JSON.stringify({ kind: "kyc_approved", at: 1 })
        });
        assert.equal(response.status, 404, `${method} ${path}`);
      }
    }
    assert.deepEqual(await kinds(running.base, cookie), before);
  });

  it("declares GET /bff/activity only and keeps the pinned POST list", () => {
    const activityRoutes = routeTable.filter((route) => route.path.startsWith("/bff/activity"));
    assert.deepEqual(activityRoutes, [{ method: "GET", path: "/bff/activity" }]);
    const postPaths = routeTable.filter((route) => route.method === "POST").map((route) => route.path);
    assert.deepEqual(postPaths.sort(), ["/bff/address-screening", "/bff/auth/dev-session", "/bff/auth/logout", "/bff/kyc/applications", "/bff/notifications/read", "/bff/session/telegram", "/bff/support/requests"]);
  });
});

describe("activity route: subject isolation", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("shows each subject only its own history", async () => {
    const alice = await telegramLogin(running.base, 7_001);
    const bob = await telegramLogin(running.base, 7_002);
    const quote = await fetch(`${running.base}/bff/quotes/preview?from=RUB&to=USDT&amount=1000`, { headers: { cookie: alice } });
    assert.equal(quote.status, 200);
    assert.deepEqual(await kinds(running.base, alice), ["quote_previewed", "session_login"]);
    assert.deepEqual(await kinds(running.base, bob), ["session_login"]);
    const aliceIds = new Set((await activity(running.base, alice)).items.map((item) => item.id));
    assert.ok((await activity(running.base, bob)).items.every((item) => !aliceIds.has(item.id)));
  });

  it("keeps history across sessions of the same subject but never across subjects", async () => {
    const first = await telegramLogin(running.base, 7_003);
    const second = await telegramLogin(running.base, 7_003);
    assert.deepEqual(await kinds(running.base, second), ["session_login", "session_login"]);
    assert.deepEqual(await kinds(running.base, first), ["session_login", "session_login"]);
    const dev = await devLogin(running.base);
    assert.ok(!(await kinds(running.base, dev)).includes("quote_previewed"));
  });

  it("records nothing for rejected quote requests", async () => {
    const cookie = await telegramLogin(running.base, 7_004);
    for (const query of ["from=RUB&to=USDT&amount=1e3", "from=RUB&to=RUB&amount=1", "from=XXX&to=USDT&amount=1"]) {
      const response = await fetch(`${running.base}/bff/quotes/preview?${query}`, { headers: { cookie } });
      assert.equal(response.status, 400, query);
    }
    assert.deepEqual(await kinds(running.base, cookie), ["session_login"]);
  });
});

describe("activity route: only trusted KYC transitions are recorded", () => {
  it("ignores forged, foreign and replayed callbacks and records the verified ones", async () => {
    const kyc = createKycService({ seed: "miniapp-activity-kyc", scenario: "approve", reviewTimeoutSeconds: 3_600, clock: () => now });
    const running = await start(config(), kyc);
    try {
      const cookie = await devLogin(running.base);
      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 202);
      assert.deepEqual(await kinds(running.base, cookie), ["kyc_submitted", "session_login"]);

      now += 600_000;
      const deliveries = kyc.drainDeliveries();
      assert.equal(deliveries.length, 2);
      const [review, approval] = deliveries;
      assert.ok(review && approval);
      const forged = Buffer.from(review.body.toString("utf8").replace("\"in_review\"", "\"approved\""), "utf8");
      assert.equal(kyc.receiveCallback({ headers: review.headers, body: forged }, review.deliverAt).verified, false);
      assert.equal(kyc.receiveCallback({ headers: {}, body: approval.body }, approval.deliverAt).verified, false);
      assert.equal(kyc.receiveCallback(approval, approval.deliverAt + 301).verified, false);

      const other = createKycService({ seed: "miniapp-activity-other", scenario: "approve", reviewTimeoutSeconds: 3_600, clock: () => now - 600_000 });
      await other.submit("dev-foreign");
      const foreign = other.drainDeliveries();
      for (const delivery of foreign) assert.equal(kyc.receiveCallback(delivery, delivery.deliverAt).verified, false);

      assert.deepEqual(await kinds(running.base, cookie), ["kyc_submitted", "session_login"]);
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "kyc-gated");

      assert.equal(kyc.receiveCallback(review, review.deliverAt).verified, true);
      assert.equal(kyc.receiveCallback(approval, approval.deliverAt).verified, true);
      assert.equal(kyc.receiveCallback(approval, approval.deliverAt).verified, false);
      assert.deepEqual(await kinds(running.base, cookie), ["kyc_approved", "kyc_in_review", "kyc_submitted", "session_login"]);
    } finally {
      await running.close();
    }
  });

  it("records rejection only when the verified provider decision says so", async () => {
    const kyc = createKycService({ seed: "miniapp-activity-reject", scenario: "reject", reviewTimeoutSeconds: 3_600, clock: () => now });
    const running = await start(config(), kyc);
    try {
      const cookie = await devLogin(running.base);
      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 202);
      for (let step = 0; step < 120; step += 1) {
        now += 10_000;
        if ((await getJson<KycVerificationView>(running.base, "/bff/kyc/status", cookie)).state === "rejected") break;
      }
      const seen = await kinds(running.base, cookie);
      assert.equal(seen[0], "kyc_rejected");
      assert.ok(!seen.includes("kyc_approved"));
    } finally {
      await running.close();
    }
  });
});

describe("activity route: end-to-end login → KYC → quote → screening", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("lists every server event newest-first with safe fields and exact decimal strings", async () => {
    const userId = 8_123_456;
    const cookie = await telegramLogin(running.base, userId);
    await approveKyc(running.base, cookie);
    assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "verified");

    const quoteResponse = await fetch(`${running.base}/bff/quotes/preview?from=RUB&to=USDT&amount=25000`, { headers: { cookie } });
    assert.equal(quoteResponse.status, 200);
    const quote = await quoteResponse.json() as QuotePreview;

    const screened = await post(running.base, "/bff/address-screening", { asset: "TON", network: "TON_TESTNET", address: tonTestnet }, { cookie });
    assert.equal(screened.status, 202);
    const screening = await screened.json() as AddressScreeningView;
    const pendingItem = (await activity(running.base, cookie)).items[0];
    assert.ok(pendingItem?.kind === "address_screened");
    const settled = await settle(running.base, cookie, screening.id);
    assert.equal((await post(running.base, "/bff/address-screening", { asset: "TON", network: "TON_TESTNET", address: tonTestnet }, { cookie })).status, 200);

    const response = await fetch(`${running.base}/bff/activity`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const text = await response.text();
    const view = JSON.parse(text) as ActivityView;
    assert.deepEqual(view.items.map((item) => item.kind), [
      "address_screened",
      "quote_previewed",
      "kyc_approved",
      "kyc_in_review",
      "kyc_submitted",
      "session_login"
    ]);
    const [screenItem, quoteItem] = view.items;
    assert.ok(screenItem?.kind === "address_screened");
    assert.deepEqual(screenItem, {
      id: screenItem.id,
      at: screenItem.at,
      kind: "address_screened",
      asset: "TON",
      network: "TON_TESTNET",
      status: settled.status,
      advisory: true,
      executable: false
    });
    assert.ok(quoteItem?.kind === "quote_previewed");
    assert.deepEqual(quoteItem, {
      id: quoteItem.id,
      at: quoteItem.at,
      kind: "quote_previewed",
      pair: `${quote.rate.base}/${quote.rate.quote}`,
      side: "buy",
      from: "RUB",
      to: "USDT",
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      fee: quote.fee,
      feeAsset: quote.feeAsset,
      rate: quote.rate,
      executable: false
    });
    for (const value of [quoteItem.amountIn, quoteItem.amountOut, quoteItem.fee, quoteItem.rate.value]) {
      assert.equal(typeof value, "string");
      assert.match(value, /^\d+(\.\d+)?$/);
      assert.ok(text.includes(`"${value}"`), value);
    }
    assert.doesNotMatch(text, /"(amountIn|amountOut|fee|value)":\d/);
    assert.ok(view.items.every((item) => item.at <= now));
    const times = view.items.map((item) => item.at);
    assert.deepEqual([...times].sort((a, b) => b - a), times);

    for (const secret of [tonTestnet, tronTestnet, screening.id, quote.id, String(userId), "Synthetic", "synthetic_user", syntheticToken]) {
      assert.equal(text.includes(secret), false, secret);
    }
    assert.doesNotMatch(text, /sim-|kytasm|kytevt|binding|provider_reference|applicant|tg-[0-9a-f]{16}|dev-[0-9a-f]{16}|SC-DEV-/);
    assert.equal(text.includes(applicantRefOf("tg-")), false);
    assert.doesNotMatch(text, /executable":true/);
  });
});

describe("activity: browser bundle and UI boundary", () => {
  const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

  function browserSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return path === join(sourceRoot, "server") ? [] : browserSources(path);
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
  }

  it("keeps provider simulators, node: modules and server code out of the activity UI", () => {
    const files = browserSources(sourceRoot);
    assert.ok(files.some((file) => file.endsWith(join("screens", "OperationsScreen.tsx"))));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((match) => match[1] ?? "");
      for (const specifier of specifiers) {
        assert.doesNotMatch(specifier, /^node:|provider-simulators|\/server\//, `${file}: ${specifier}`);
      }
    }
  });

  it("reads activity from the BFF only and offers no money-moving action", () => {
    const screen = readFileSync(join(sourceRoot, "app", "screens", "OperationsScreen.tsx"), "utf8");
    assert.match(screen, /api\.activity\(\)/);
    assert.match(screen, /t\("activity\.banner"\)/);
    assert.match(screen, /t\("activity\.emptyTitle"\)/);
    const catalog = readFileSync(join(sourceRoot, "app", "locales", "ru.ts"), "utf8");
    assert.match(catalog, /"activity\.banner": "Тестовый режим — операции не выполняются"/);
    assert.match(catalog, /"activity\.emptyTitle": "Событий пока нет"/);
    assert.doesNotMatch(screen, /syntheticData|operations=|openSheet|DisabledCta|cta"/);
    assert.doesNotMatch(screen, /Отправить|Перевести|Вывести|Пополнить|Обменять|Подтвердить|withdraw|transfer|deposit|execute|executable: true/i);
    const client = readFileSync(join(sourceRoot, "app", "api.ts"), "utf8");
    assert.match(client, /activity: \(\) => call<ActivityView>\("\/bff\/activity"\)/);
    assert.doesNotMatch(client, /"\/bff\/activity",/);
    assert.doesNotMatch(client, /x-device-id/i);
  });
});
