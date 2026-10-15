import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { platform } from "node:os";
import { getHeapStatistics } from "node:v8";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { startCustomerApi } from "@solidchange/customer-api/dev-server";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";
import { demoRepository } from "../../../backoffice/.server-dist/data/demo.js";
import { MemoryAuditStore } from "../../../backoffice/.server-dist/server/audit-store.js";
import { createBackofficeServer } from "../../../backoffice/.server-dist/server/server.js";
import {
  createActivityLog,
  maxActivityPerSubject,
  maxActivitySubjects
} from "../../../miniapp/.server-dist/server/activity.js";
import {
  createAddressScreeningService,
  maxNewScreeningsPerWindow,
  maxScreeningsPerSubject
} from "../../../miniapp/.server-dist/server/address-screening.js";
import { loadServerConfig } from "../../../miniapp/.server-dist/server/config.js";
import { signInitData } from "../../../miniapp/.server-dist/server/init-data.js";
import {
  createNotificationOutbox,
  defaultMaxPerSubject,
  defaultMaxTotal
} from "../../../miniapp/.server-dist/server/notifications.js";
import { createMiniappServer } from "../../../miniapp/.server-dist/server/server.js";
import { closeServer, cookieOf, listen, readJson } from "./stack.mjs";

// Bounded load against in-process servers: hundreds of concurrent mixed
// requests must only ever produce documented statuses (429/503 are allowed,
// 500 never), and every per-subject and global store bound must hold.

const miniappOrigin = "http://127.0.0.1:4183";
const backofficeOrigin = "http://127.0.0.1:5174";
const devTokenKey = randomBytes(32).toString("hex");
const botToken = `${randomInt(100_000, 999_999_999)}:${randomBytes(30).toString("base64url")}`;
const requestTimeoutMs = 15_000;
const runtimeBudgetMs = 60_000;
const rssGrowthBudgetBytes = 320 * 1024 * 1024;
const customerApiRateLimit = 40;
const maxSessionsPerSubject = 5;
const documentedStatuses = new Set([200, 201, 202, 429, 503]);
const documented503 = new Set(["activity_unavailable", "audit_integrity_unavailable", "cards_unavailable", "checks_unavailable", "deposits_unavailable", "kyc_unavailable", "profile_unavailable", "exchange_orders_unavailable", "trades_unavailable", "markets_unavailable", "notifications_unavailable", "payments_unavailable", "quote_unavailable", "screening_unavailable", "sessions_unavailable", "support_unavailable", "account_unavailable", "operations_unavailable", "wallet_unavailable", "quotes_unavailable", "withdrawals_unavailable"]);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// The gated wallet view every degraded /bff/wallet 200 answers, byte for
// byte (wave-72: a stray key or shifted scale sailed through unpinned).
const gatedWalletView = {
  kyc: "kyc-gated",
  totalRub: "0.00",
  availableRub: "0.00",
  holdRub: "0.00",
  assets: [
    { code: "RUB", available: "0.00", hold: "0.00", valueRub: "0.00" },
    { code: "USDT", available: "0.000000", hold: "0.000000", valueRub: "0.00" },
    { code: "TON", available: "0.000000000", hold: "0.000000000", valueRub: "0.00" }
  ],
  depositAddresses: []
};
const kycStates = new Set(["not_started", "submitted", "in_review", "approved", "rejected", "needs_more_data", "timed_out", "unavailable"]);

let startedAt;
let rssBefore;
let customerApi;
let limitedApi;
let miniapp;
let miniappBase;
let backoffice;
let backofficeBase;
let auditStore;
let outbox;
let addressScreening;
let activity;
let devSubject;

function rssBytes() {
  try {
    const match = readFileSync("/proc/self/status", "utf8").match(/^VmRSS:\s+(\d+) kB$/m);
    if (match) return Number(match[1]) * 1024;
  } catch {
    // Non-Linux hosts fall back to the V8 heap footprint.
  }
  return getHeapStatistics().total_heap_size;
}

function syntheticTronAddress() {
  const payload = Buffer.concat([Buffer.from([0x41]), randomBytes(20)]);
  const check = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
  let value = BigInt(`0x${Buffer.concat([payload, check.subarray(0, 4)]).toString("hex")}`);
  let text = "";
  while (value > 0n) {
    text = base58Alphabet[Number(value % 58n)] + text;
    value /= 58n;
  }
  return text;
}

function request(base, path, { method = "GET", cookie, body, origin = miniappOrigin, headers = {} } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "POST" ? { "content-type": "application/json", origin } : {}),
      ...headers
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
}

async function outcome(kind, pending) {
  const response = await pending;
  const text = await response.text();
  return { kind, status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
}

function assertDocumented(results) {
  for (const result of results) {
    assert.ok(documentedStatuses.has(result.status), `${result.kind}: ${result.status}`);
    if (result.status === 503) {
      assert.ok(documented503.has(result.body?.error), `${result.kind}: ${JSON.stringify(result.body)}`);
    }
    if (result.status === 429) {
      assert.ok(
        result.body?.error === "screening_rate_limited" || result.body?.code === "RATE_LIMITED",
        `${result.kind}: ${JSON.stringify(result.body)}`
      );
    }
  }
}

function countBy(results, kind) {
  const counts = {};
  for (const result of results) {
    if (result.kind === kind) counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  return counts;
}

function telegramLogin(userId) {
  const initData = signInitData(
    new Map([
      ["auth_date", String(Math.floor(Date.now() / 1_000))],
      ["user", JSON.stringify({ id: userId, first_name: "Synthetic" })]
    ]),
    botToken
  );
  return request(miniappBase, "/bff/session/telegram", { method: "POST", body: { initData } });
}

function telegramSubject(userId) {
  return `tg-${createHash("sha256").update(`solidchange-miniapp-dev|${userId}`).digest("hex").slice(0, 16)}`;
}

function customerApiHeaders(subject) {
  return {
    authorization: `Bearer ${mintSyntheticCustomerToken({
      key: devTokenKey,
      subject,
      expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
    })}`,
    "x-request-id": generateUuidV7(),
    "x-client-version": "e2e-dev-load",
    "x-platform": "web"
  };
}

before(async () => {
  startedAt = Date.now();
  rssBefore = rssBytes();
  const apiConfig = { host: "127.0.0.1", port: 0, authMode: "synthetic-dev", devTokenKey };
  customerApi = await startCustomerApi({ ...apiConfig, rateLimitPerMinute: customerApiRateLimit });
  limitedApi = await startCustomerApi({ ...apiConfig, rateLimitPerMinute: customerApiRateLimit });

  const config = loadServerConfig({
    MINIAPP_ALLOW_DEV_LOGIN: "true",
    MINIAPP_ALLOWED_ORIGINS: miniappOrigin,
    MINIAPP_TELEGRAM_BOT_TOKEN: botToken,
    MINIAPP_QUOTE_SOURCE: "provider-simulator",
    MINIAPP_KYC_SCENARIO: "approve",
    MINIAPP_KYT_SCENARIO: "low",
    MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${customerApi.address.port}`,
    MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
  });
  outbox = createNotificationOutbox({ clock: Date.now });
  addressScreening = createAddressScreeningService({
    seed: config.kytSeed,
    scenario: config.kytScenario,
    screeningTimeoutSeconds: config.kytScreeningTimeoutSeconds,
    clock: Date.now
  });
  activity = createActivityLog({ clock: Date.now });
  miniapp = createMiniappServer(config, { notifications: outbox, addressScreening, activity });
  miniappBase = await listen(miniapp);

  auditStore = new MemoryAuditStore(demoRepository.auditSource(), 30);
  backoffice = createBackofficeServer(
    {
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [backofficeOrigin],
      allowDevLogin: true,
      sessionTtlSeconds: 900,
      audit: { storage: "memory", retentionDays: 30 },
      stepUp: { provider: "synthetic-dev", challengeTtlSeconds: 300, grantTtlSeconds: 60, maxAttempts: 3 },
      signing: { backend: "ephemeral-dev", rotationSeconds: 900, retainedVerificationKeys: 2 }
    },
    auditStore
  );
  backofficeBase = await listen(backoffice);
});

after(async () => {
  await closeServer(miniapp);
  await closeServer(backoffice);
  await closeServer(customerApi.server);
  await closeServer(limitedApi.server);
});

describe("bounded load on the dev stack", () => {
  let cookies;
  let devCookie;
  let operatorCookie;

  it("creates hundreds of concurrent sessions while the outbox and activity log stay bounded", async () => {
    const userIds = Array.from({ length: defaultMaxTotal + 200 }, (_, index) => 2_000_000 + index);
    cookies = [];
    // Windows RSTs a SYN burst of this size against the loopback backlog;
    // the bound invariant is identical, only the per-wave concurrency drops.
    const burstSize = platform() === "win32" ? 100 : 400;
    for (let offset = 0; offset < userIds.length; offset += burstSize) {
      const batch = await Promise.all(userIds.slice(offset, offset + burstSize).map((id) => telegramLogin(id)));
      for (const response of batch) {
        assert.equal(response.status, 201);
        cookies.push(cookieOf(response));
        await response.body?.cancel();
      }
      assert.ok(outbox.size() <= defaultMaxTotal, `outbox ${outbox.size()}`);
      assert.ok(activity.subjects() <= maxActivitySubjects, `activity ${activity.subjects()}`);
    }
    assert.equal(outbox.size(), defaultMaxTotal);
    assert.equal(activity.subjects(), maxActivitySubjects);
    cookies = cookies.slice(-300);
  });

  it("caps live sessions per subject at five under concurrent logins", async () => {
    const hotUser = 1_500_000;
    const logins = await Promise.all(Array.from({ length: 60 }, () => telegramLogin(hotUser)));
    const hotCookies = [];
    for (const response of logins) {
      assert.equal(response.status, 201);
      hotCookies.push(cookieOf(response));
      await response.body?.cancel();
    }
    const checks = await Promise.all(hotCookies.map((cookie) => outcome("session", request(miniappBase, "/bff/session", { cookie }))));
    assert.deepEqual(countBy(checks, "session"), { 200: maxSessionsPerSubject, 401: 60 - maxSessionsPerSubject });
    for (const check of checks.filter((entry) => entry.status === 401)) {
      assert.deepEqual(check.body, { error: "unauthenticated" });
    }
    const live = hotCookies[checks.findIndex((entry) => entry.status === 200)];
    const view = await outcome("notifications", request(miniappBase, "/bff/notifications", { cookie: live }));
    assert.equal(view.status, 200);
    assert.equal(view.body.notifications.length, defaultMaxPerSubject);
    assert.equal(view.body.unread, defaultMaxPerSubject);
    assert.ok(outbox.size() <= defaultMaxTotal);
    assert.equal(activity.size(telegramSubject(hotUser)), maxActivityPerSubject);
    const history = await outcome("activity", request(miniappBase, "/bff/activity", { cookie: live }));
    assert.equal(history.status, 200);
    assert.equal(history.body.items.length, maxActivityPerSubject);
    assert.equal(history.body.executable, false);
  });

  it("serves a mixed concurrent burst with only documented statuses", async () => {
    const devLogin = await request(miniappBase, "/bff/auth/dev-session", { method: "POST", body: { kyc: "verified" } });
    assert.equal(devLogin.status, 201);
    devCookie = cookieOf(devLogin);
    await devLogin.body?.cancel();
    devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const operator = await request(backofficeBase, "/bff/auth/dev-session", {
      method: "POST",
      body: { role: "compliance-lead" },
      origin: backofficeOrigin
    });
    assert.equal(operator.status, 200);
    operatorCookie = cookieOf(operator);
    await operator.body?.cancel();
    const auditBefore = (await auditStore.snapshot()).status.length;

    const total = 1_008;
    const fire = (index) => {
      const cookie = cookies[index % cookies.length];
      switch (index % 24) {
        case 0:
          return outcome("kyc-status", request(miniappBase, "/bff/kyc/status", { cookie }));
        case 1:
          return outcome("quote", request(miniappBase, `/bff/quotes/preview?from=RUB&to=USDT&amount=${1_000 + index}`, { cookie }));
        case 2:
          return outcome("notifications", request(miniappBase, "/bff/notifications", { cookie }));
        case 3:
          // Spread the submit arm across its 42 firings as 42 distinct
          // subjects directly rather than relying on the shared pick's
          // modular spread, so the required creates below are never
          // under-counted by an arm-count change.
          return outcome(
            "kyc-submit",
            request(miniappBase, "/bff/kyc/applications", {
              method: "POST",
              cookie: cookies[Math.floor(index / 24) % cookies.length]
            })
          );
        case 4:
          return outcome("profile", request(miniappBase, "/bff/profile", { cookie }));
        case 5:
          return outcome(
            "screening",
            request(miniappBase, "/bff/address-screening", {
              method: "POST",
              cookie: devCookie,
              body: { asset: "USDT", network: "TRON_TESTNET", address: syntheticTronAddress() }
            })
          );
        case 6:
          return outcome("report", request(backofficeBase, "/bff/api/reports/kyc-queue-daily", { cookie: operatorCookie }));
        case 7:
          return outcome(
            "activity",
            request(miniappBase, index % 2 === 0 ? "/bff/activity" : "/bff/activity?limit=10", { cookie: devCookie })
          );
        case 8:
          return outcome("support", request(miniappBase, "/bff/support/requests", { cookie }));
        case 9:
          return outcome("verified-quote", request(miniappBase, "/bff/quotes/preview?from=USDT&to=RUB&amount=25", { cookie: devCookie }));
        case 10:
          return outcome("deposits", request(miniappBase, "/bff/deposits", { cookie: devCookie }));
        case 11:
          return outcome("withdrawals", request(miniappBase, "/bff/withdrawals", { cookie: devCookie }));
        case 12:
          return outcome("exchange-orders", request(miniappBase, "/bff/exchange-orders", { cookie: devCookie }));
        case 13:
          return outcome("payments", request(miniappBase, "/bff/payments", { cookie: devCookie }));
        case 14:
          return outcome("cards", request(miniappBase, "/bff/cards", { cookie: devCookie }));
        case 15:
          return outcome("sessions", request(miniappBase, "/bff/sessions", { cookie }));
        case 16:
          return outcome("account", request(miniappBase, "/bff/account", { cookie }));
        case 17:
          return outcome("checks", request(miniappBase, "/bff/checks", { cookie: devCookie }));
        case 18:
          return outcome("operations", request(miniappBase, "/bff/operations", { cookie: devCookie }));
        case 19:
          return outcome(
            "screening-list",
            request(miniappBase, "/bff/address-screening", { cookie: devCookie })
          );
        case 20:
          return outcome("wallet", request(miniappBase, "/bff/wallet", { cookie: devCookie }));
        case 21:
          return outcome("trades", request(miniappBase, "/bff/trades", { cookie: devCookie }));
        case 22:
          return outcome("markets", request(miniappBase, "/bff/markets", { cookie: devCookie }));
        default:
          return outcome("quotes", request(miniappBase, "/bff/quotes", { cookie: devCookie }));
      }
    };
    // Windows RSTs thousand-socket waves on the loopback: fire each arm
    // lazily inside fixed-size waves — same arm mix, same totals, same
    // documented statuses.
    const waveSize = platform() === "win32" ? 96 : total;
    const results = [];
    for (let offset = 0; offset < total; offset += waveSize) {
      results.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(waveSize, total - offset) }, (_, i) => fire(offset + i))
        ))
      );
    }
    assert.equal(results.length, total);
    assertDocumented(results);

    // /bff/kyc/status consults upstream for gated sessions too
    // (customer.kyc.read is never denied), so the burst's extra upstream
    // calls saturate the customer-api rate limit and some reads degrade to
    // the documented 503 kyc_unavailable instead of 200.
    const kycStatuses = countBy(results, "kyc-status");
    assert.equal((kycStatuses[200] ?? 0) + (kycStatuses[503] ?? 0), total / 24);
    assert.ok((kycStatuses[200] ?? 0) > 0, "customer-api answered at least one kyc status read");
    assert.ok((kycStatuses[503] ?? 0) > 0, "customer-api rate limit applies to kyc status");
    for (const result of results.filter((entry) => entry.kind === "kyc-status" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "kyc_unavailable" });
    }
    // Gated quote previews never consult upstream, but a subject verified
    // mid-burst judges affordability against the served wallets, so under
    // the saturated rate limit those previews degrade to the documented
    // 503 quote_unavailable like every other upstream read.
    const quotePreviews = countBy(results, "quote");
    assert.equal((quotePreviews[200] ?? 0) + (quotePreviews[503] ?? 0), total / 24);
    assert.ok((quotePreviews[200] ?? 0) > 0, "at least one quote preview answered");
    for (const result of results.filter((entry) => entry.kind === "quote" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "quote_unavailable" });
    }
    // The verified dev session's preview always consults the served wallets
    // upstream, so it degrades and rate-limits exactly like the other
    // verified reads.
    const verifiedQuotes = countBy(results, "verified-quote");
    assert.equal((verifiedQuotes[200] ?? 0) + (verifiedQuotes[503] ?? 0), total / 24);
    assert.ok((verifiedQuotes[200] ?? 0) > 0, "customer-api answered at least one wallets read");
    assert.ok((verifiedQuotes[503] ?? 0) > 0, "customer-api rate limit applies to wallets reads");
    for (const result of results.filter((entry) => entry.kind === "verified-quote" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "quote_unavailable" });
    }
    // Gated notification reads stay on the local outbox; a subject verified
    // mid-burst consults the contract feed upstream and can degrade to the
    // documented 503 notifications_unavailable under the saturated limit.
    const notificationReads = countBy(results, "notifications");
    assert.equal((notificationReads[200] ?? 0) + (notificationReads[503] ?? 0), total / 24);
    assert.ok((notificationReads[200] ?? 0) > 0, "at least one notifications read answered");
    for (const result of results.filter((entry) => entry.kind === "notifications" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "notifications_unavailable" });
    }
    // /bff/sessions consults upstream for gated sessions too
    // (customer.auth.read is never denied), so under the saturated
    // customer-api rate limit some reads degrade to the documented 503
    // sessions_unavailable instead of 200.
    const sessions = countBy(results, "sessions");
    assert.equal((sessions[200] ?? 0) + (sessions[503] ?? 0), total / 24);
    assert.ok((sessions[200] ?? 0) > 0, "customer-api answered at least one sessions read");
    assert.ok((sessions[503] ?? 0) > 0, "customer-api rate limit applies to sessions");
    for (const result of results.filter((entry) => entry.kind === "sessions" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "sessions_unavailable" });
    }
    // /bff/account consults upstream for gated sessions too
    // (customer.users.read is never denied), so under the saturated
    // customer-api rate limit some reads degrade to the documented 503
    // account_unavailable instead of 200.
    const accounts = countBy(results, "account");
    assert.equal((accounts[200] ?? 0) + (accounts[503] ?? 0), total / 24);
    assert.ok((accounts[200] ?? 0) > 0, "customer-api answered at least one account read");
    assert.ok((accounts[503] ?? 0) > 0, "customer-api rate limit applies to account");
    for (const result of results.filter((entry) => entry.kind === "account" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "account_unavailable" });
    }
    // 200s carry the adapted account record fields through.
    for (const result of results.filter((entry) => entry.kind === "account" && entry.status === 200)) {
      assert.equal(result.body.mode, "test");
      assert.match(result.body.id, /^usr_[0-9a-f]{24}$/);
      assert.match(result.body.subject, /^syn_cust_[a-z0-9]{8,32}$/);
    }
    // /bff/profile consults upstream for gated sessions too
    // (customer.profile.read is never denied), so under the saturated
    // customer-api rate limit some reads degrade to the documented 503
    // profile_unavailable instead of 200.
    const profiles = countBy(results, "profile");
    assert.equal((profiles[200] ?? 0) + (profiles[503] ?? 0), total / 24);
    assert.ok((profiles[200] ?? 0) > 0, "customer-api answered at least one profile read");
    assert.ok((profiles[503] ?? 0) > 0, "customer-api rate limit applies to profile");
    for (const result of results.filter((entry) => entry.kind === "profile" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "profile_unavailable" });
    }
    // /bff/support/requests consults upstream for gated sessions too
    // (customer.support.read is never denied), so under the saturated
    // customer-api rate limit some reads degrade to the documented 503
    // support_unavailable instead of 200.
    const supports = countBy(results, "support");
    assert.equal((supports[200] ?? 0) + (supports[503] ?? 0), total / 24);
    assert.ok((supports[200] ?? 0) > 0, "customer-api answered at least one support read");
    assert.ok((supports[503] ?? 0) > 0, "customer-api rate limit applies to support");
    for (const result of results.filter((entry) => entry.kind === "support" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "support_unavailable" });
    }
    // /bff/deposits consults upstream only for the verified dev session
    // (customer.deposits.read is KYC-gated): the upstream's synthetic KYC
    // directory refuses every subject, so successful reads degrade to the
    // gated view (200) while rate-limited reads answer the documented 503
    // deposits_unavailable.
    const deposits = countBy(results, "deposits");
    assert.equal((deposits[200] ?? 0) + (deposits[503] ?? 0), total / 24);
    assert.ok((deposits[200] ?? 0) > 0, "customer-api answered at least one deposits read");
    assert.ok((deposits[503] ?? 0) > 0, "customer-api rate limit applies to deposits");
    for (const result of results.filter((entry) => entry.kind === "deposits" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "deposits_unavailable" });
    }
    // /bff/withdrawals shares the same upstream KYC gate
    // (customer.withdrawals.read), so it degrades and rate-limits exactly
    // like deposits.
    const withdrawals = countBy(results, "withdrawals");
    assert.equal((withdrawals[200] ?? 0) + (withdrawals[503] ?? 0), total / 24);
    assert.ok((withdrawals[200] ?? 0) > 0, "customer-api answered at least one withdrawals read");
    assert.ok((withdrawals[503] ?? 0) > 0, "customer-api rate limit applies to withdrawals");
    for (const result of results.filter((entry) => entry.kind === "withdrawals" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "withdrawals_unavailable" });
    }
    // /bff/quotes shares the same upstream KYC gate (customer.quotes.read),
    // so it degrades and rate-limits exactly like deposits and withdrawals.
    const quotes = countBy(results, "quotes");
    assert.equal((quotes[200] ?? 0) + (quotes[503] ?? 0), total / 24);
    assert.ok((quotes[200] ?? 0) > 0, "customer-api answered at least one quotes read");
    assert.ok((quotes[503] ?? 0) > 0, "customer-api rate limit applies to quotes");
    for (const result of results.filter((entry) => entry.kind === "quotes" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "quotes_unavailable" });
    }
    // /bff/exchange-orders shares the same upstream KYC gate
    // (customer.exchange-orders.read), so it degrades and rate-limits
    // exactly like deposits, withdrawals and quotes.
    const orders = countBy(results, "exchange-orders");
    assert.equal((orders[200] ?? 0) + (orders[503] ?? 0), total / 24);
    assert.ok((orders[200] ?? 0) > 0, "customer-api answered at least one exchange-orders read");
    assert.ok((orders[503] ?? 0) > 0, "customer-api rate limit applies to exchange-orders");
    for (const result of results.filter((entry) => entry.kind === "exchange-orders" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "exchange_orders_unavailable" });
    }
    // /bff/trades shares the same upstream KYC gate (customer.trades.read),
    // so it degrades and rate-limits exactly like exchange-orders.
    const trades = countBy(results, "trades");
    assert.equal((trades[200] ?? 0) + (trades[503] ?? 0), total / 24);
    assert.ok((trades[200] ?? 0) > 0, "customer-api answered at least one trades read");
    assert.ok((trades[503] ?? 0) > 0, "customer-api rate limit applies to trades");
    for (const result of results.filter((entry) => entry.kind === "trades" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "trades_unavailable" });
    }
    // /bff/markets shares the same upstream KYC gate (customer.markets.read),
    // so it degrades and rate-limits exactly like trades.
    const markets = countBy(results, "markets");
    assert.equal((markets[200] ?? 0) + (markets[503] ?? 0), total / 24);
    assert.ok((markets[200] ?? 0) > 0, "customer-api answered at least one markets read");
    assert.ok((markets[503] ?? 0) > 0, "customer-api rate limit applies to markets");
    for (const result of results.filter((entry) => entry.kind === "markets" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "markets_unavailable" });
    }
    // /bff/payments shares the same upstream KYC gate
    // (customer.payments.read), so it degrades and rate-limits exactly like
    // deposits, withdrawals, quotes and exchange-orders.
    const payments = countBy(results, "payments");
    assert.equal((payments[200] ?? 0) + (payments[503] ?? 0), total / 24);
    assert.ok((payments[200] ?? 0) > 0, "customer-api answered at least one payments read");
    assert.ok((payments[503] ?? 0) > 0, "customer-api rate limit applies to payments");
    for (const result of results.filter((entry) => entry.kind === "payments" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "payments_unavailable" });
    }
    // /bff/cards shares the same upstream KYC gate (customer.cards.read),
    // so it degrades and rate-limits exactly like payments.
    const cards = countBy(results, "cards");
    assert.equal((cards[200] ?? 0) + (cards[503] ?? 0), total / 24);
    assert.ok((cards[200] ?? 0) > 0, "customer-api answered at least one cards read");
    assert.ok((cards[503] ?? 0) > 0, "customer-api rate limit applies to cards");
    for (const result of results.filter((entry) => entry.kind === "cards" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "cards_unavailable" });
    }
    // /bff/checks shares the same upstream KYC gate (customer.checks.read),
    // so it degrades to the local gated list and rate-limits exactly like
    // cards — the burst now carries this kind in the shared 40/min budget.
    const checks = countBy(results, "checks");
    assert.equal((checks[200] ?? 0) + (checks[503] ?? 0), total / 24);
    assert.ok((checks[200] ?? 0) > 0, "customer-api answered at least one checks read");
    assert.ok((checks[503] ?? 0) > 0, "customer-api rate limit applies to checks");
    for (const result of results.filter((entry) => entry.kind === "checks" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "checks_unavailable" });
    }
    // /bff/address-screening shares the same upstream KYC gate
    // (customer.address-screenings.read): refused upstream it degrades in
    // place to the subject's locally-tracked screenings — the POST submit
    // stays local — and rate-limits to the documented screening_unavailable.
    const screeningList = countBy(results, "screening-list");
    assert.equal((screeningList[200] ?? 0) + (screeningList[503] ?? 0), total / 24);
    assert.ok((screeningList[200] ?? 0) > 0, "screening list degraded to local records at least once");
    assert.ok((screeningList[503] ?? 0) > 0, "customer-api rate limit applies to the screening list");
    for (const result of results.filter((entry) => entry.kind === "screening-list" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "screening_unavailable" });
    }
    // /bff/wallet shares the gate (customer.wallets.read): a refusal degrades
    // to the gated view with the depositAddresses section empty, and a rate
    // limit answers the documented wallet_unavailable.
    const wallets = countBy(results, "wallet");
    assert.equal((wallets[200] ?? 0) + (wallets[503] ?? 0), total / 24);
    assert.ok((wallets[200] ?? 0) > 0, "wallet degraded to the gated view at least once");
    assert.ok((wallets[503] ?? 0) > 0, "customer-api rate limit applies to the wallet read");
    for (const result of results.filter((entry) => entry.kind === "wallet" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "wallet_unavailable" });
    }
    // /bff/activity shares the same upstream KYC gate
    // (customer.activity.read): the verified dev session consults upstream,
    // so the feed answers the contract view or the sibling
    // activity_unavailable under the shared rate budget — gated sessions
    // keep the local log without an upstream call.
    const activityFeed = countBy(results, "activity");
    assert.equal((activityFeed[200] ?? 0) + (activityFeed[503] ?? 0), total / 24);
    assert.ok((activityFeed[200] ?? 0) > 0, "customer-api answered at least one activity read");
    assert.ok((activityFeed[503] ?? 0) > 0, "customer-api rate limit applies to activity");
    for (const result of results.filter((entry) => entry.kind === "activity" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "activity_unavailable" });
    }
    // /bff/operations shares the same upstream KYC gate
    // (customer.operations.read), so it answers the contract view or the
    // sibling operations_unavailable under the shared rate budget exactly
    // like activity — gated sessions keep the local synthetic view.
    const operationsFeed = countBy(results, "operations");
    assert.equal((operationsFeed[200] ?? 0) + (operationsFeed[503] ?? 0), total / 24);
    assert.ok((operationsFeed[200] ?? 0) > 0, "customer-api answered at least one operations read");
    assert.ok((operationsFeed[503] ?? 0) > 0, "customer-api rate limit applies to operations");
    for (const result of results.filter((entry) => entry.kind === "operations" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "operations_unavailable" });
    }
    const submits = countBy(results, "kyc-submit");
    assert.equal((submits[200] ?? 0) + (submits[202] ?? 0), total / 24);
    // The burst drives 25 distinct telegram subjects through two submissions
    // each: the first must create (202), so at least 25 creates must appear —
    // a submit path that silently never creates would report all 200s.
    assert.ok((submits[202] ?? 0) >= 25, `kyc submits must create: ${JSON.stringify(submits)}`);

    for (const result of results) {
      if (result.kind === "quote" && result.status === 200) {
        // Gated subjects always need KYC and hold nothing to spend.
        assert.equal(result.body.kycRequired, true);
        assert.equal(result.body.insufficientBalance, true);
      }
      if (result.kind === "verified-quote" && result.status === 200) {
        // The verified dev session skips the KYC flag but upstream wallets
        // are refused, so affordability always degrades to insufficient.
        assert.equal(result.body.kycRequired, false);
        assert.equal(result.body.insufficientBalance, true);
      }
      if ((result.kind === "quote" || result.kind === "verified-quote") && result.status === 200) {
        assert.equal(result.body.executable, false);
        assert.equal(result.body.executionUnavailableReason, "dev_test_version");
      }
      if (result.kind === "kyc-status" && result.status === 200) {
        // Upstream-contract view (customer.kyc.read is granted to gated
        // sessions): the adapter pins these fields — not the local view.
        assert.equal(result.body.mode, "test");
        assert.equal(result.body.provider, "simulator");
        assert.equal(result.body.sessionKyc, "kyc-gated");
        assert.ok(kycStates.has(result.body.state), `kyc state ${result.body.state}`);
        assert.equal(typeof result.body.canSubmit, "boolean");
      }
      if (result.kind === "kyc-submit" && (result.status === 200 || result.status === 202)) {
        assert.equal(result.body.mode, "test");
        assert.equal(result.body.provider, "simulator");
        assert.equal(result.body.state, "submitted");
        assert.equal(result.body.sessionKyc, "kyc-gated");
        assert.equal(result.body.canSubmit, false);
      }
      if (result.kind === "report" && result.status === 200) {
        // The signed envelope plus the draft-report payload fields.
        assert.deepEqual(
          Object.keys(result.body).sort(),
          ["issuedAt", "keyId", "keyVersion", "payload", "requestId", "resource", "signature", "signatureVersion"]
        );
        assert.equal(result.body.resource, "report:kyc-queue-daily");
        assert.equal(result.body.payload.id, "kyc-queue-daily");
        assert.equal(result.body.payload.status, "draft");
        assert.equal(result.body.payload.not_for_submission, true);
        assert.equal(result.body.payload.environment, "dev-synthetic");
        assert.equal(result.body.payload.decisionAuthority, "none");
      }
      if (result.kind === "wallet" && result.status === 200) {
        assert.deepEqual(Object.keys(result.body).sort(), ["assets", "availableRub", "depositAddresses", "holdRub", "kyc", "totalRub"]);
        assert.ok(["verified", "kyc-gated"].includes(result.body.kyc));
        assert.deepEqual(result.body.assets.map((entry) => entry.code), ["RUB", "USDT", "TON"]);
        if (result.body.kyc === "kyc-gated") {
          assert.deepEqual(result.body, gatedWalletView);
        }
      }
      if (result.kind === "checks" && result.status === 200) {
        assert.equal(result.body.mode, "test");
        assert.ok(Array.isArray(result.body.checks));
        for (const entry of result.body.checks) {
          assert.equal(entry.mode, "test");
          assert.ok(["sent", "received"].includes(entry.direction));
          assert.ok(["RUB", "USDT", "TON"].includes(entry.asset));
          assert.equal(entry.executable, false);
          assert.equal(entry.executionUnavailableReason, "dev_test_version");
          assert.ok(entry.expiresAt > entry.createdAt);
        }
      }
      for (const [kind, listKey] of [["deposits", "deposits"], ["withdrawals", "withdrawals"], ["exchange-orders", "orders"], ["trades", "trades"], ["markets", "markets"], ["payments", "payments"], ["cards", "cards"], ["quotes", "quotes"]]) {
        if (result.kind === kind && result.status === 200) {
          // Served upstream view or the in-place gated degrade: the key set
          // never gains or loses a member either way.
          assert.deepEqual(Object.keys(result.body).sort(), ["kyc", "mode", listKey].sort(), kind);
          assert.equal(result.body.mode, "test");
          assert.ok(["verified", "kyc-gated"].includes(result.body.kyc), kind);
          assert.ok(Array.isArray(result.body[listKey]), kind);
          if (result.body.kyc === "kyc-gated") assert.equal(result.body[listKey].length, 0, kind);
        }
      }
      if (result.kind === "operations" && result.status === 200) {
        assert.deepEqual(Object.keys(result.body), ["operations"]);
        assert.ok(Array.isArray(result.body.operations));
      }
      if (result.kind === "screening" && result.status === 202) {
        assert.equal(result.body.mode, "test");
        assert.match(result.body.id, /^scr_[0-9a-f]{32}$/);
        assert.equal(result.body.advisory, true);
        assert.equal(result.body.executable, false);
      }
      if (result.kind === "screening" && result.status === 429) {
        assert.deepEqual(result.body, { error: "screening_rate_limited" });
      }
      if (result.kind === "screening-list" && result.status === 200) {
        assert.equal(result.body.mode, "test");
        assert.ok(Array.isArray(result.body.screenings));
        for (const entry of result.body.screenings) {
          assert.equal(entry.mode, "test");
          assert.match(entry.id, /^scr_[0-9a-f]{32}$/);
        }
      }
      if (result.kind === "notifications" && result.status === 200) {
        assert.equal(result.body.mode, "test");
        assert.equal(result.body.delivery, "disabled");
        assert.ok(result.body.notifications.length <= defaultMaxPerSubject);
        assert.equal(result.body.unread, result.body.notifications.length);
        for (const entry of result.body.notifications) {
          assert.equal(entry.channel, "telegram-draft");
          assert.equal(entry.delivered, false);
        }
      }
      if (result.kind === "activity" && result.status === 200) {
        assert.equal(result.body.mode, "test");
        assert.ok(result.body.items.length <= maxActivityPerSubject);
        assert.equal(result.body.executable, false);
      }
      if (result.kind === "profile" && result.status === 200) {
        assert.ok(["connected", "unavailable"].includes(result.body.apiAccess.status));
      }
      if (result.kind === "support" && result.status === 200) {
        assert.equal(result.body.mode, "test");
        assert.equal(result.body.delivery, "disabled");
        for (const request of result.body.requests) {
          assert.match(request.id, /^tck_[0-9a-f]{24}$/);
        }
      }
      if (result.kind === "sessions" && result.status === 200) {
        assert.equal(result.body.mode, "test");
        assert.equal(result.body.sessions.filter((entry) => entry.current).length, 1);
        for (const entry of result.body.sessions) {
          assert.match(entry.handle, /^sess_[0-9a-f]{24}$/);
        }
      }
    }

    assert.deepEqual(countBy(results, "screening"), {
      202: maxNewScreeningsPerWindow,
      429: total / 24 - maxNewScreeningsPerWindow
    });
    assert.equal(addressScreening.size(devSubject), maxScreeningsPerSubject);
    // Degraded previews record no activity, so under the saturated upstream
    // rate limit the dev subject may stay below its activity cap — the bound
    // is the invariant, reaching the cap is not guaranteed.
    assert.ok(activity.size(devSubject) <= maxActivityPerSubject);
    assert.ok(activity.subjects() <= maxActivitySubjects);

    // The audit store is in-memory here, so every operator report read must
    // succeed — a single 503 means the audited route failed closed.
    const reports = countBy(results, "report");
    assert.deepEqual(reports, { 200: total / 24 });
    assert.equal((await auditStore.snapshot()).status.length - auditBefore, reports[200] ?? 0);
    assert.ok(outbox.size() <= defaultMaxTotal);
  });

  it("enforces the customer-api rate limit exactly under a concurrent burst", async () => {
    const subject = `syn_cust_${randomBytes(8).toString("hex")}`;
    const results = await Promise.all(
      Array.from({ length: customerApiRateLimit * 3 }, () =>
        outcome(
          "customer-api",
          request(`http://127.0.0.1:${limitedApi.address.port}`, "/api/v1/customer/session", {
            headers: customerApiHeaders(subject)
          })
        )
      )
    );
    assertDocumented(results);
    assert.deepEqual(countBy(results, "customer-api"), {
      200: customerApiRateLimit,
      429: customerApiRateLimit * 2
    });
    for (const result of results.filter((entry) => entry.status === 429)) {
      assert.ok(Number(result.headers.get("retry-after")) >= 1);
    }
  });

  it("keeps RSS growth and total runtime within budget", () => {
    const growth = rssBytes() - rssBefore;
    assert.ok(growth < rssGrowthBudgetBytes, `RSS grew by ${Math.round(growth / 1_048_576)} MiB`);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < runtimeBudgetMs, `load run took ${elapsed} ms`);
  });
});
