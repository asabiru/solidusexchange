import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
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
const rssGrowthBudgetBytes = 256 * 1024 * 1024;
const customerApiRateLimit = 40;
const maxSessionsPerSubject = 5;
const documentedStatuses = new Set([200, 201, 202, 429, 503]);
const documented503 = new Set(["audit_integrity_unavailable", "deposits_unavailable", "kyc_unavailable", "profile_unavailable", "quote_unavailable", "screening_unavailable", "support_unavailable", "withdrawals_unavailable"]);
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
    for (let offset = 0; offset < userIds.length; offset += 400) {
      const batch = await Promise.all(userIds.slice(offset, offset + 400).map((id) => telegramLogin(id)));
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

    const total = 600;
    const burst = Array.from({ length: total }, (_, index) => {
      const cookie = cookies[index % cookies.length];
      switch (index % 12) {
        case 0:
          return outcome("kyc-status", request(miniappBase, "/bff/kyc/status", { cookie }));
        case 1:
          return outcome("quote", request(miniappBase, `/bff/quotes/preview?from=RUB&to=USDT&amount=${1_000 + index}`, { cookie }));
        case 2:
          return outcome("notifications", request(miniappBase, "/bff/notifications", { cookie }));
        case 3:
          return outcome("kyc-submit", request(miniappBase, "/bff/kyc/applications", { method: "POST", cookie }));
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
        default:
          return outcome("withdrawals", request(miniappBase, "/bff/withdrawals", { cookie: devCookie }));
      }
    });
    const results = await Promise.all(burst);
    assert.equal(results.length, total);
    assertDocumented(results);

    // /bff/kyc/status consults upstream for gated sessions too
    // (customer.kyc.read is never denied), so the burst's extra upstream
    // calls saturate the customer-api rate limit and some reads degrade to
    // the documented 503 kyc_unavailable instead of 200.
    const kycStatuses = countBy(results, "kyc-status");
    assert.equal((kycStatuses[200] ?? 0) + (kycStatuses[503] ?? 0), total / 12);
    assert.ok((kycStatuses[503] ?? 0) > 0, "customer-api rate limit applies to kyc status");
    for (const result of results.filter((entry) => entry.kind === "kyc-status" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "kyc_unavailable" });
    }
    assert.deepEqual(countBy(results, "quote"), { 200: total / 12 });
    assert.deepEqual(countBy(results, "verified-quote"), { 200: total / 12 });
    assert.deepEqual(countBy(results, "notifications"), { 200: total / 12 });
    // /bff/profile consults upstream for gated sessions too
    // (customer.profile.read is never denied), so under the saturated
    // customer-api rate limit some reads degrade to the documented 503
    // profile_unavailable instead of 200.
    const profiles = countBy(results, "profile");
    assert.equal((profiles[200] ?? 0) + (profiles[503] ?? 0), total / 12);
    assert.ok((profiles[503] ?? 0) > 0, "customer-api rate limit applies to profile");
    for (const result of results.filter((entry) => entry.kind === "profile" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "profile_unavailable" });
    }
    // /bff/support/requests consults upstream for gated sessions too
    // (customer.support.read is never denied), so under the saturated
    // customer-api rate limit some reads degrade to the documented 503
    // support_unavailable instead of 200.
    const supports = countBy(results, "support");
    assert.equal((supports[200] ?? 0) + (supports[503] ?? 0), total / 12);
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
    assert.equal((deposits[200] ?? 0) + (deposits[503] ?? 0), total / 12);
    assert.ok((deposits[503] ?? 0) > 0, "customer-api rate limit applies to deposits");
    for (const result of results.filter((entry) => entry.kind === "deposits" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "deposits_unavailable" });
    }
    // /bff/withdrawals shares the same upstream KYC gate
    // (customer.withdrawals.read), so it degrades and rate-limits exactly
    // like deposits.
    const withdrawals = countBy(results, "withdrawals");
    assert.equal((withdrawals[200] ?? 0) + (withdrawals[503] ?? 0), total / 12);
    assert.ok((withdrawals[503] ?? 0) > 0, "customer-api rate limit applies to withdrawals");
    for (const result of results.filter((entry) => entry.kind === "withdrawals" && entry.status === 503)) {
      assert.deepEqual(result.body, { error: "withdrawals_unavailable" });
    }
    assert.deepEqual(countBy(results, "activity"), { 200: total / 12 });
    const submits = countBy(results, "kyc-submit");
    assert.equal((submits[200] ?? 0) + (submits[202] ?? 0), total / 12);

    for (const result of results) {
      if (result.kind === "quote") assert.equal(result.body.kycRequired, true);
      if (result.kind === "quote" || result.kind === "verified-quote") assert.equal(result.body.executable, false);
      if (result.kind === "notifications") assert.ok(result.body.notifications.length <= defaultMaxPerSubject);
      if (result.kind === "activity") {
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
    }

    assert.deepEqual(countBy(results, "screening"), {
      202: maxNewScreeningsPerWindow,
      429: total / 12 - maxNewScreeningsPerWindow
    });
    assert.equal(addressScreening.size(devSubject), maxScreeningsPerSubject);
    assert.equal(activity.size(devSubject), maxActivityPerSubject);
    assert.ok(activity.subjects() <= maxActivitySubjects);

    const reports = countBy(results, "report");
    assert.ok((reports[200] ?? 0) >= 1, JSON.stringify(reports));
    assert.equal((reports[200] ?? 0) + (reports[503] ?? 0), total / 12);
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
