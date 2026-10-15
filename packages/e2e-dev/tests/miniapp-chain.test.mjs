/**
 * e2e: the miniapp BFF read chain, end to end, against the live customer-api.
 *
 * operator-chain.test.mjs covers the backoffice arm; this file is the miniapp
 * mirror. A real dev BFF subprocess and a real customer-api subprocess boot
 * on loopback; three synthetic sessions sign in through the real login paths
 * — a verified dev session, a kyc-gated dev session (same subject), and a
 * telegram HMAC session on a second subject — and every read surface is
 * driven against what the chain actually serves today:
 *
 *   - the never-denied contract reads (session, capabilities, kyc, profile,
 *     support, auth, users) answer upstream and surface at the BFF as
 *     contract-adapted views bound to the session's mapped subject;
 *   - the synthetic kyc directory marks every subject unverified, so the
 *     KYC-gated reads deny upstream with CAPABILITY_DENIED and the BFF
 *     applies its documented degrade: in place to the gated fixtures on a
 *     refusal, and the <route>_unavailable family on any other failure;
 *   - BFF member reads exist only for operations, markets, checks,
 *     address-screening and support requests (there is no BFF exchange-order
 *     member route), and everything the stores do not own answers one
 *     uniform not_found;
 *   - subjects stay isolated on both layers, and the outage arm pins the
 *     documented per-route fallback while customer-api is down plus the
 *     recovery once it is back.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { get as httpGet } from "node:http";
import { after, before, describe, it } from "node:test";

import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import {
  mintSyntheticCustomerToken,
  mintSyntheticOperatorToken
} from "@solidchange/customer-api/synthetic-token";

import { createSyntheticAuthSessionDirectory } from "../../customer-api/src/auth-sessions.mjs";
import { createSyntheticKycApplicationDirectory } from "../../customer-api/src/kyc.mjs";
import { createSyntheticProfileDirectory } from "../../customer-api/src/profile.mjs";
import { createSyntheticSupportDirectory } from "../../customer-api/src/support.mjs";
import { createSyntheticUserDirectory } from "../../customer-api/src/users.mjs";
import { customerApiSubject } from "../../../miniapp/.server-dist/server/customer-api-client.js";
import { signInitData } from "../../../miniapp/.server-dist/server/init-data.js";
import { syntheticData } from "../../../miniapp/.server-dist/server/synthetic.js";

import {
  cookieOf,
  customerApiEntry,
  miniappEntry,
  readJson,
  startService,
  startServiceOnFreePort,
  stopService
} from "./stack.mjs";

const devTokenKey = randomBytes(32).toString("hex");
const botToken = `${randomInt(100_000, 999_999_999)}:${randomBytes(30).toString("base64url")}`;
const allowedOrigin = "http://127.0.0.1:4183";
const tronTestnet = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
const tronTestnetOther = "TKmJ2NCHa7qnFxj5KVNQ36Kfpri5L859h5";
const tonTestnet = "kQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RCIT";
const telegramUserId = 8_000_001;
const devTelegramUserId = 900_000_001;

const customerApiReady = /listening on http:\/\/127\.0\.0\.1:(\d+) auth=synthetic/;
const miniappReady = /Mini App dev BFF listening on http:\/\/127\.0\.0\.1:(\d+)/;

function bffSubject(source, telegramUserId) {
  if (source === "dev-synthetic") {
    return `dev-${createHash("sha256")
      .update(`solidchange-miniapp-dev-synthetic|${telegramUserId}`)
      .digest("hex")
      .slice(0, 16)}`;
  }
  return `tg-${createHash("sha256")
    .update(`solidchange-miniapp-dev|${telegramUserId}`)
    .digest("hex")
    .slice(0, 16)}`;
}
const devBffSubject = bffSubject("dev-synthetic", devTelegramUserId);
const telegramBffSubject = bffSubject("telegram", telegramUserId);
const devUpstreamSubject = customerApiSubject(devBffSubject);
const telegramUpstreamSubject = customerApiSubject(telegramBffSubject);

const grantedReads = [
  "customer.session.read",
  "customer.capabilities.read",
  "customer.kyc.read",
  "customer.profile.read",
  "customer.support.read",
  "customer.auth.read",
  "customer.users.read"
];
const apiAccessView = {
  status: "connected",
  granted: grantedReads,
  commandsEnabled: false
};
const healthView = {
  mode: "dev-synthetic",
  devLogin: true,
  telegramVerification: "configured",
  moneyMovement: "disabled"
};
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
// The KYC-gated collection reads all degrade in place to one emptied,
// mode/kyc-tagged list shape; /bff/operations is the exception (untagged).
const gatedCollections = [
  ["/bff/deposits", "deposits"],
  ["/bff/withdrawals", "withdrawals"],
  ["/bff/quotes", "quotes"],
  ["/bff/exchange-orders", "orders"],
  ["/bff/trades", "trades"],
  ["/bff/markets", "markets"],
  ["/bff/payments", "payments"],
  ["/bff/cards", "cards"]
];
// Every upstream read that sits behind a KYC-gated capability: with the
// synthetic directory all-unverified they answer one uniform denial.
const gatedUpstreamReads = [
  "/api/v1/customer/wallets",
  "/api/v1/customer/deposits",
  "/api/v1/customer/withdrawals",
  "/api/v1/customer/quotes",
  "/api/v1/customer/exchange-orders",
  "/api/v1/customer/trades",
  "/api/v1/customer/markets",
  "/api/v1/customer/payments",
  "/api/v1/customer/cards",
  "/api/v1/customer/checks",
  "/api/v1/customer/notifications",
  "/api/v1/customer/activity",
  "/api/v1/customer/operations",
  "/api/v1/customer/deposit-addresses",
  "/api/v1/customer/address-screenings"
];
const gatedUpstreamMemberReads = [
  "/api/v1/customer/operations/ope_000000000000000000000000",
  "/api/v1/customer/exchange-orders/ord_000000000000000000000000",
  "/api/v1/customer/address-screenings/scr_00000000000000000000000000000000",
  "/api/v1/customer/markets/USDT%2FRUB"
];

const userDirectory = createSyntheticUserDirectory();
const profileDirectory = createSyntheticProfileDirectory();
const kycDirectory = createSyntheticKycApplicationDirectory();
const authSessionDirectory = createSyntheticAuthSessionDirectory();
const supportDirectory = createSyntheticSupportDirectory();

async function expectedAccountView(subject) {
  const view = await userDirectory.viewFor(subject);
  return {
    mode: "test",
    id: view.user_id,
    subject: view.subject,
    status: view.status,
    flags: {
      termsAccepted: view.flags.terms_accepted,
      twoFactorEnabled: view.flags.two_factor_enabled,
      marketingOptIn: view.flags.marketing_opt_in
    },
    createdAt: Date.parse(view.created_at),
    updatedAt: Date.parse(view.updated_at)
  };
}

async function expectedKycView(subject) {
  const view = await kycDirectory.viewFor(subject, "unverified");
  const adapted = {
    mode: "test",
    provider: "simulator",
    state: view.status,
    sessionKyc: "kyc-gated",
    canSubmit: view.can_submit
  };
  if (view.submitted_at !== undefined) adapted.submittedAt = Date.parse(view.submitted_at);
  if (view.review_deadline !== undefined) adapted.reviewDeadline = Date.parse(view.review_deadline);
  return adapted;
}

async function expectedSessionsView(subject) {
  const view = await authSessionDirectory.listFor(subject);
  const sessions = view.sessions
    .filter((entry) => entry.state === "active")
    .map((entry) => ({
      handle: entry.session_id,
      client: entry.platform === "telegram-mini-app" ? "telegram" : "dev-login",
      createdAt: Date.parse(entry.created_at),
      lastSeenAt: Date.parse(entry.last_seen_at),
      current: entry.current,
      revocable: false
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        b.lastSeenAt - a.lastSeenAt ||
        b.createdAt - a.createdAt
    );
  return { mode: "test", sessions };
}

async function expectedSupportList(subject) {
  const { tickets } = await supportDirectory.listFor(subject);
  return {
    mode: "test",
    delivery: "disabled",
    requests: tickets.map((ticket) => ({
      id: ticket.ticket_id,
      mode: "test",
      delivery: "disabled",
      category: ticket.category,
      topic: ticket.topic,
      message: ticket.message,
      status: ticket.status,
      timeline: ticket.timeline.map((step) => ({ status: step.status, at: Date.parse(step.at) })),
      complaintAcknowledged: ticket.complaint_acknowledged,
      createdAt: Date.parse(ticket.created_at),
      expiresAt: Date.parse(ticket.expires_at)
    }))
  };
}

let customerApi;
let miniapp;
let miniappBase;
let upstreamBase;
let upstreamPort;
let devVerified;
let devGated;
let telegram;
let supportRequest;
let secondSupportView;
let outageSupportView;
let screeningView;
let secondScreeningView;
let checkReference;
let outageScreeningView;

const customerApiEnv = {
  CUSTOMER_API_HOST: "127.0.0.1",
  // The kernel assigns the port and the ready match reports it back — no
  // probe-release-bind window a sibling test file could steal. On the
  // outage restart the same port is rebound explicitly because the BFF's
  // configured upstream URL points at it.
  CUSTOMER_API_PORT: "0",
  CUSTOMER_API_DEV_AUTH: "synthetic",
  CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey,
  // The BFF's own upstream traffic and the direct contract probes all share
  // the loopback-IP bucket; keep the fixed window comfortably above the
  // file's total call count.
  CUSTOMER_API_RATE_LIMIT_PER_MINUTE: "5000"
};

async function startCustomerApi() {
  customerApi = await startService(customerApiEntry, customerApiEnv, customerApiReady);
  upstreamPort = customerApi.match[1];
  upstreamBase = `http://127.0.0.1:${upstreamPort}`;
}

async function postMiniapp(path, body, headers = {}) {
  return fetch(`${miniappBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin, ...headers },
    body: JSON.stringify(body)
  });
}

async function devSession(kyc) {
  const response = await postMiniapp("/bff/auth/dev-session", { kyc });
  const view = await readJson(response);
  assert.equal(response.status, 201);
  return { cookie: cookieOf(response), view };
}

async function telegramSession(userId) {
  const initData = signInitData(
    new Map([
      ["auth_date", String(Math.floor(Date.now() / 1_000))],
      ["user", JSON.stringify({ id: userId, first_name: "Synthetic" })]
    ]),
    botToken
  );
  const response = await postMiniapp("/bff/session/telegram", { initData });
  const view = await readJson(response);
  assert.equal(response.status, 201);
  return { cookie: cookieOf(response), view };
}

function bffGet(path, cookie, headers = {}) {
  return fetch(`${miniappBase}${path}`, { headers: { cookie, ...headers } });
}

async function okGet(path, cookie) {
  const response = await bffGet(path, cookie);
  const body = await readJson(response);
  assert.equal(response.status, 200, `GET ${path}`);
  return body;
}

async function deniedGet(path, cookie, status, error) {
  const response = await bffGet(path, cookie);
  const body = await readJson(response);
  assert.deepEqual(body, { error });
  assert.equal(response.status, status);
}

function upstreamHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "x-request-id": generateUuidV7(),
    "x-client-version": "miniapp-chain-e2e",
    "x-platform": "telegram-mini-app"
  };
}

function mintCustomer(subject) {
  return mintSyntheticCustomerToken({
    key: devTokenKey,
    subject,
    expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
  });
}

function mintOperator(subject) {
  return mintSyntheticOperatorToken({
    key: devTokenKey,
    subject: `syn_oper_${subject}`,
    expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
  });
}

async function upstreamGet(path, token = mintCustomer(devUpstreamSubject), headers = {}) {
  return fetch(`${upstreamBase}${path}`, { headers: { ...upstreamHeaders(token), ...headers } });
}

async function upstreamDenied(path, token) {
  const response = await upstreamGet(path, token);
  const body = await readJson(response);
  assert.equal(body.code, "CAPABILITY_DENIED");
  assert.equal(typeof body.request_id, "string");
  return response.status;
}

before(async () => {
  await startCustomerApi();
  miniapp = await startServiceOnFreePort(
    miniappEntry,
    {
      MINIAPP_BFF_HOST: "127.0.0.1",
      MINIAPP_BFF_PORT: "",
      MINIAPP_ALLOWED_ORIGINS: allowedOrigin,
      MINIAPP_ALLOW_DEV_LOGIN: "true",
      MINIAPP_TELEGRAM_BOT_TOKEN: botToken,
      MINIAPP_QUOTE_SOURCE: "provider-simulator",
      MINIAPP_KYC_SCENARIO: "approve",
      MINIAPP_KYT_SCENARIO: "medium",
      MINIAPP_CUSTOMER_API_URL: upstreamBase,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
    },
    miniappReady,
    "MINIAPP_BFF_PORT"
  );
  miniappBase = `http://127.0.0.1:${miniapp.match[1]}`;
  devVerified = await devSession("verified");
  devGated = await devSession("kyc-gated");
  telegram = await telegramSession(telegramUserId);
});

after(async () => {
  await Promise.all([stopService(customerApi), stopService(miniapp)]);
});

describe("miniapp chain through the live customer-api", () => {
  it("serves the never-denied reads derived from the live upstream", async () => {
    // The dev-session cookie is the documented smt_ opaque token, and the
    // session view the login returned is the one /bff/session serves back.
    assert.match(devVerified.cookie, /^solidchange_ma_session=smt_[0-9a-f]{64}$/);
    assert.match(devGated.cookie, /^solidchange_ma_session=smt_[0-9a-f]{64}$/);
    assert.match(telegram.cookie, /^solidchange_ma_session=smt_[0-9a-f]{64}$/);
    assert.deepEqual(await okGet("/bff/session", devVerified.cookie), devVerified.view);
    // The session view is one literal shape — the same six keys on every
    // login path, self-referential comparisons do not substitute for them.
    for (const [view, source, kyc] of [
      [devVerified.view, "dev-synthetic", "verified"],
      [devGated.view, "dev-synthetic", "kyc-gated"],
      [telegram.view, "telegram", "kyc-gated"]
    ]) {
      assert.deepEqual(Object.keys(view).sort(), [
        "authenticated",
        "customerRef",
        "displayName",
        "expiresAt",
        "kyc",
        "source"
      ]);
      assert.equal(view.authenticated, true);
      assert.equal(view.source, source);
      assert.equal(view.kyc, kyc);
      assert.equal(view.displayName, "Тестовый клиент");
      assert.match(view.customerRef, /^SC-DEV-[0-9A-F]{5}$/);
      assert.ok(view.expiresAt > Date.now());
    }
    assert.equal(telegram.view.source, "telegram");
    assert.equal(telegram.view.kyc, "kyc-gated");

    // Never-denied reads reach the live upstream and come back adapted and
    // bound to the session's mapped syn_cust_* subject.
    assert.deepEqual(
      await okGet("/bff/account", devVerified.cookie),
      await expectedAccountView(devUpstreamSubject)
    );
    assert.deepEqual(
      await okGet("/bff/kyc/status", devVerified.cookie),
      await expectedKycView(devUpstreamSubject)
    );
    assert.deepEqual(
      await okGet("/bff/sessions", devVerified.cookie),
      await expectedSessionsView(devUpstreamSubject)
    );
    const support = await okGet("/bff/support/requests", devVerified.cookie);
    assert.deepEqual(support, await expectedSupportList(devUpstreamSubject));
    assert.ok(support.requests.length > 0);
    assert.match(support.requests[0].id, /^tck_[0-9a-f]{24}$/);

    // The profile keeps the local fixture blocks while the identity fields
    // are overlaid from the served contract profile.
    const profile = await okGet("/bff/profile", devVerified.cookie);
    const upstreamProfile = await profileDirectory.viewFor(devUpstreamSubject);
    const localProfile = syntheticData.profile(
      "verified",
      devVerified.view.displayName,
      devVerified.view.customerRef
    );
    assert.deepEqual(profile, {
      ...localProfile,
      displayName: upstreamProfile.display_name,
      customerRef: upstreamProfile.customer_ref,
      apiAccess: apiAccessView
    });
    // The overlaid identity is genuinely upstream's, not the session's.
    assert.notEqual(profile.customerRef, devVerified.view.customerRef);
    assert.equal(profile.kyc.state, "verified");

    // The same reads answer 200 directly on the upstream surface — these
    // are the contract payloads the BFF adapters consume.
    const sessionUpstream = await readJson(await upstreamGet("/api/v1/customer/session"));
    assert.equal(sessionUpstream.subject, devUpstreamSubject);
    assert.equal(sessionUpstream.actor_type, "customer");
    assert.deepEqual(sessionUpstream.scopes, [
      "customer.session.read",
      "customer.capabilities.read"
    ]);
    const capabilities = await readJson(await upstreamGet("/api/v1/customer/capabilities"));
    assert.deepEqual(capabilities, {
      capabilities: grantedReads,
      commands_enabled: false
    });
    const kycUpstream = await readJson(await upstreamGet("/api/v1/customer/kyc"));
    assert.equal(kycUpstream.session_kyc, "unverified");
    const profileUpstream = await readJson(await upstreamGet("/api/v1/customer/profile"));
    assert.equal(profileUpstream.display_name, profile.displayName);
    const authUpstream = await readJson(await upstreamGet("/api/v1/customer/auth"));
    assert.ok(authUpstream.sessions.some((entry) => entry.current));
    const usersUpstream = await readJson(await upstreamGet("/api/v1/customer/users"));
    assert.equal(usersUpstream.user_id, (await expectedAccountView(devUpstreamSubject)).id);
    const supportUpstream = await readJson(await upstreamGet("/api/v1/customer/support"));
    assert.equal(supportUpstream.tickets[0].ticket_id, support.requests[0].id);
    assert.deepEqual(await okGet("/bff/health", devVerified.cookie), healthView);
  });

  it("serves the documented gated degrade on the KYC-gated surfaces", async () => {
    // The upstream capability gate denies these reads for every subject
    // (the synthetic kyc directory is all-unverified), and the BFF degrades
    // each refusal in place — the gated fixtures are the contract, not
    // fabricated data and never an error to the client.
    assert.deepEqual(await okGet("/bff/wallet", devVerified.cookie), gatedWalletView);
    for (const [path, key] of gatedCollections) {
      assert.deepEqual(await okGet(path, devVerified.cookie), {
        mode: "test",
        kyc: "kyc-gated",
        [key]: []
      });
    }
    assert.deepEqual(await okGet("/bff/operations", devVerified.cookie), { operations: [] });
    assert.deepEqual(await okGet("/bff/address-screening", devVerified.cookie), {
      mode: "test",
      screenings: []
    });

    // Checks keeps its five-row gated fixture instead of an empty list.
    const checks = await okGet("/bff/checks", devVerified.cookie);
    assert.equal(checks.mode, "test");
    assert.equal(checks.checks.length, 5);
    checkReference = checks.checks[0].reference;
    for (const row of checks.checks) {
      assert.match(row.reference, /^chk_[0-9a-f]{24}$/);
      assert.equal(row.mode, "test");
      assert.equal(row.claimRule, "personal");
      assert.equal(row.executable, false);
      assert.equal(row.executionUnavailableReason, "dev_test_version");
      assert.match(row.direction, /^(sent|received)$/);
      assert.ok(Array.isArray(row.timeline) && row.timeline.length > 0);
      assert.equal(typeof row.createdAt, "number");
      assert.equal(typeof row.expiresAt, "number");
      assert.equal(row.expiresAt - row.createdAt, 259_200 * 1_000);
    }

    // Notifications and activity degrade to the local stores: the two dev
    // logins share one subject, so both entries are session_login drafts —
    // nothing upstream-shaped leaks through the refusal path.
    const notifications = await okGet("/bff/notifications", devVerified.cookie);
    assert.equal(notifications.mode, "test");
    assert.equal(notifications.delivery, "disabled");
    assert.equal(notifications.unread, 2);
    assert.equal(notifications.notifications.length, 2);
    for (const item of notifications.notifications) {
      assert.match(item.id, /^ntf_[0-9a-f]{24}$/);
      assert.equal(item.channel, "telegram-draft");
      assert.equal(item.template, "session_login");
      assert.equal(item.locale, "ru");
      assert.equal(item.mode, "test");
      assert.equal(item.delivered, false);
      assert.equal(item.read, false);
      assert.equal(typeof item.createdAt, "number");
    }
    const activity = await okGet("/bff/activity", devVerified.cookie);
    assert.equal(activity.mode, "test");
    assert.equal(activity.executable, false);
    assert.equal(activity.items.length, 2);
    for (const item of activity.items) {
      assert.match(item.id, /^act_[0-9a-f]{24}$/);
      assert.equal(item.kind, "session_login");
      assert.equal(item.source, "dev-synthetic");
    }
    // `limit` is the feed's declared query input: served values are honored
    // (not merely validated) — a handler that silently ignores it fails here.
    const limited = await okGet("/bff/activity?limit=1", devVerified.cookie);
    assert.equal(limited.mode, "test");
    assert.equal(limited.items.length, 1);
    assert.equal(limited.items[0].kind, "session_login");
    const unbounded = await okGet("/bff/activity?limit=50", devVerified.cookie);
    assert.equal(unbounded.items.length, 2);
    await deniedGet("/bff/activity?limit=51", devVerified.cookie, 400, "invalid_request");

    // Same reads, straight against upstream: one uniform capability denial.
    for (const path of gatedUpstreamReads) {
      assert.equal(await upstreamDenied(path), 403, path);
    }
    for (const path of gatedUpstreamMemberReads) {
      assert.equal(await upstreamDenied(path), 403, path);
    }
  });

  it("pins roster coherence on the member reads that exist", async () => {
    // Address screening is the subject-scoped local store behind a member
    // read: POST -> member == created view == the row the list serves.
    const screeningResponse = await postMiniapp(
      "/bff/address-screening",
      { asset: "USDT", network: "TRON_TESTNET", address: tronTestnet },
      { cookie: devVerified.cookie }
    );
    screeningView = await readJson(screeningResponse);
    assert.equal(screeningResponse.status, 202);
    assert.match(screeningView.id, /^scr_[0-9a-f]{32}$/);
    assert.equal(screeningView.mode, "test");
    assert.equal(screeningView.asset, "USDT");
    assert.equal(screeningView.network, "TRON_TESTNET");
    assert.equal(screeningView.status, "pending");
    assert.equal(screeningView.advisory, true);
    assert.equal(screeningView.executable, false);
    assert.equal(typeof screeningView.submittedAt, "number");
    assert.ok(screeningView.deadline > screeningView.submittedAt);
    assert.deepEqual(
      await okGet(`/bff/address-screening/${screeningView.id}`, devVerified.cookie),
      screeningView
    );
    assert.deepEqual(await okGet("/bff/address-screening", devVerified.cookie), {
      mode: "test",
      screenings: [screeningView]
    });
    // Identical input resubmits idempotently: same deterministic id, the
    // stored view back, 200 not 202, and the list still holds one row.
    const resubmit = await postMiniapp(
      "/bff/address-screening",
      { asset: "USDT", network: "TRON_TESTNET", address: tronTestnet },
      { cookie: devVerified.cookie }
    );
    assert.equal(resubmit.status, 200);
    assert.deepEqual(await readJson(resubmit), screeningView);
    assert.deepEqual(await okGet("/bff/address-screening", devVerified.cookie), {
      mode: "test",
      screenings: [screeningView]
    });
    // A different target mints a different id and joins the same list.
    const secondScreening = await postMiniapp(
      "/bff/address-screening",
      { asset: "USDT", network: "TON_TESTNET", address: tonTestnet },
      { cookie: devVerified.cookie }
    );
    assert.equal(secondScreening.status, 202);
    secondScreeningView = await readJson(secondScreening);
    assert.notEqual(secondScreeningView.id, screeningView.id);
    assert.equal(secondScreeningView.network, "TON_TESTNET");
    assert.deepEqual(
      (await okGet("/bff/address-screening", devVerified.cookie)).screenings.map(
        (entry) => entry.id
      ),
      [screeningView.id, secondScreeningView.id]
    );
    // Hostile targets fail closed with their own codes, not a lumped 400.
    for (const [body, error] of [
      [{ asset: "BTC", network: "TRON_TESTNET", address: tronTestnet }, "invalid_target"],
      [{ asset: "USDT", network: "BTC_TESTNET", address: tronTestnet }, "invalid_target"],
      [{ asset: "USDT", network: "TRON_TESTNET", address: "not-an-address" }, "invalid_address"],
      [{ asset: "USDT", network: "TRON_TESTNET", address: "" }, "invalid_address"]
    ]) {
      const denied = await postMiniapp("/bff/address-screening", body, {
        cookie: devVerified.cookie
      });
      assert.equal(denied.status, 400);
      assert.deepEqual(await readJson(denied), { error });
    }

    // Support member reads are local-desk only: the POST creates the record,
    // the member route serves it back verbatim, and the upstream-roster
    // ticket id is NOT in the local member namespace.
    const supportResponse = await postMiniapp(
      "/bff/support/requests",
      { category: "question", topic: "chain e2e", message: "synthetic" },
      { cookie: devVerified.cookie }
    );
    supportRequest = await readJson(supportResponse);
    assert.equal(supportResponse.status, 201);
    assert.match(supportRequest.id, /^sup_[0-9a-f]{24}$/);
    // The create view echoes the request verbatim — category, topic and
    // message come straight from the stored ticket, not a shaped stub.
    assert.equal(supportRequest.mode, "test");
    assert.equal(supportRequest.delivery, "disabled");
    assert.equal(supportRequest.category, "question");
    assert.equal(supportRequest.topic, "chain e2e");
    assert.equal(supportRequest.message, "synthetic");
    assert.equal(supportRequest.status, "received");
    assert.deepEqual(supportRequest.timeline.map((entry) => entry.status), ["received"]);
    assert.equal(supportRequest.timeline[0].at, supportRequest.createdAt);
    assert.equal(supportRequest.complaintAcknowledged, false);
    assert.equal(supportRequest.expiresAt - supportRequest.createdAt, 86_400_000);
    assert.deepEqual(
      await okGet(`/bff/support/requests/${supportRequest.id}`, devVerified.cookie),
      supportRequest
    );
    // A second request gets its own stored row: the member read of the
    // second id answers the second ticket, never the first entry.
    const secondSupport = await postMiniapp(
      "/bff/support/requests",
      { category: "complaint", topic: "second topic", message: "different body" },
      { cookie: devVerified.cookie }
    );
    secondSupportView = await readJson(secondSupport);
    assert.equal(secondSupport.status, 201);
    assert.notEqual(secondSupportView.id, supportRequest.id);
    assert.equal(secondSupportView.category, "complaint");
    assert.equal(secondSupportView.topic, "second topic");
    assert.equal(secondSupportView.message, "different body");
    assert.equal(secondSupportView.complaintAcknowledged, true);
    assert.deepEqual(
      await okGet(`/bff/support/requests/${secondSupportView.id}`, devVerified.cookie),
      secondSupportView
    );
    // Hostile fields fail closed with their own codes.
    for (const [body, error] of [
      [{ category: "bogus", topic: "t", message: "m" }, "invalid_category"],
      [{ category: "question", topic: "", message: "m" }, "invalid_topic"],
      [{ category: "question", topic: "t", message: "" }, "invalid_message"],
      [
        { category: "question", topic: "t", message: "m", activityId: "act_0" },
        "invalid_reference"
      ]
    ]) {
      const denied = await postMiniapp("/bff/support/requests", body, {
        cookie: devVerified.cookie
      });
      assert.equal(denied.status, 400);
      assert.deepEqual(await readJson(denied), { error });
    }
    // The list unions the local desk drafts first with the upstream-roster
    // rows after them: local writes stay immediately visible, and upstream
    // tck_* ids resolve through the same collection on the member read.
    const expectedUpstream = await expectedSupportList(devUpstreamSubject);
    const list = await okGet("/bff/support/requests", devVerified.cookie);
    assert.deepEqual(list.requests.slice(-expectedUpstream.requests.length), expectedUpstream.requests);
    const localIds = list.requests.slice(0, list.requests.length - expectedUpstream.requests.length).map((row) => row.id);
    assert.deepEqual(localIds, [secondSupportView.id, supportRequest.id]);
    assert.equal(list.delivery, "disabled");
    const upstreamTicket = expectedUpstream.requests[0].id;
    assert.deepEqual(
      await okGet(`/bff/support/requests/${upstreamTicket}`, devVerified.cookie),
      expectedUpstream.requests[0]
    );

    // The checks surface serves the five deterministic fixtures verbatim:
    // every stable field is pinned literally (any drift in the fixture or
    // the derivation — amounts, fees, statuses, the comment — is a defect),
    // and the clock-derived anchors follow the fixture offsets exactly.
    // Row 2's status is the gated derivation both sessions see here (the
    // degraded collection is always the kyc-gated one in this stack).
    const checks = await okGet("/bff/checks", devVerified.cookie);
    const fixtureRows = [
      {
        reference: "chk_7f3a9c1e5d2b4f8a0e6c1d3b",
        mode: "test",
        direction: "sent",
        status: "created",
        asset: "USDT",
        amount: "25.000000",
        fee: "0.075000",
        total: "25.075000",
        claimRule: "personal",
        comment: "Возврат долга",
        executable: false,
        executionUnavailableReason: "dev_test_version"
      },
      {
        reference: "chk_2b8d4f6a0c1e3b5d7f9a2c4e",
        mode: "test",
        direction: "received",
        status: "awaiting_recipient_kyc",
        asset: "USDT",
        amount: "10.000000",
        fee: "0.030000",
        total: "10.030000",
        claimRule: "personal",
        executable: false,
        executionUnavailableReason: "dev_test_version"
      },
      {
        reference: "chk_5e7a9c2e4d6b8f0a1c3e5d7b",
        mode: "test",
        direction: "received",
        status: "claimed",
        asset: "TON",
        amount: "4.000000000",
        fee: "0.012000000",
        total: "4.012000000",
        claimRule: "personal",
        executable: false,
        executionUnavailableReason: "dev_test_version"
      },
      {
        reference: "chk_9d1b3f5a7c9e1d3f5a7b9c1e",
        mode: "test",
        direction: "sent",
        status: "cancelled",
        asset: "USDT",
        amount: "15.000000",
        fee: "0.045000",
        total: "15.045000",
        claimRule: "personal",
        executable: false,
        executionUnavailableReason: "dev_test_version"
      },
      {
        reference: "chk_4c6e8a0d2f4b6d8f0a2c4e6a",
        mode: "test",
        direction: "sent",
        status: "expired",
        asset: "USDT",
        amount: "7.500000",
        fee: "0.022500",
        total: "7.522500",
        claimRule: "personal",
        executable: false,
        executionUnavailableReason: "dev_test_version"
      }
    ];
    assert.equal(checks.mode, "test");
    assert.equal(checks.checks.length, fixtureRows.length);
    // Fixture offsets from the shared clock: 3h, 5h, 30h, 50h, 90h ago;
    // terminal steps land +5h, +10h, +72h after creation; every row carries
    // the same 72h TTL.
    const createdAgo = [3, 5, 30, 50, 90].map((hours) => hours * 3_600_000);
    const statusAfter = [undefined, undefined, 5 * 3_600_000, 10 * 3_600_000, 72 * 3_600_000];
    const timelineSteps = [1, 1, 2, 2, 2];
    const terminalStatuses = [undefined, undefined, "claimed", "cancelled", "expired"];
    for (const [index, row] of checks.checks.entries()) {
      const { createdAt, expiresAt, timeline, ...stable } = row;
      assert.deepEqual(stable, fixtureRows[index]);
      assert.equal(expiresAt - createdAt, 259_200_000);
      assert.equal(timeline.length, timelineSteps[index]);
      assert.equal(timeline[0].status, "created");
      assert.equal(timeline[0].at, createdAt);
      if (index > 0) {
        assert.equal(
          createdAt - checks.checks[index - 1].createdAt,
          createdAgo[index - 1] - createdAgo[index]
        );
      }
      if (statusAfter[index] !== undefined) {
        assert.equal(timeline[1].status, terminalStatuses[index]);
        assert.equal(timeline[1].at - createdAt, statusAfter[index]);
      }
      // The member read serves the same fixture row recomputed on its own
      // clock tick: stable fields identical, timestamps shifted by the
      // inter-request drift but the offsets preserved.
      const member = await okGet(`/bff/checks/${row.reference}`, devVerified.cookie);
      const { createdAt: mCreated, expiresAt: mExpires, timeline: mTimeline, ...mStable } = member;
      assert.deepEqual(mStable, stable);
      assert.equal(mExpires - mCreated, 259_200_000);
      assert.equal(mTimeline.length, timelineSteps[index]);
      assert.equal(mTimeline[0].status, "created");
      assert.equal(mTimeline[0].at, mCreated);
      if (statusAfter[index] !== undefined) {
        assert.equal(mTimeline[1].status, terminalStatuses[index]);
        assert.equal(mTimeline[1].at - mCreated, statusAfter[index]);
      }
    }

    // Every other member probe answers the same uniform not_found — wrong
    // prefix, wrong shape, never-minted well-formed ids, an upstream-roster
    // ticket id, and the exchange-order member route that does not exist
    // at the BFF (the upstream member read stays reachable only upstream).
    for (const path of [
      "/bff/operations/not-an-id",
      "/bff/operations/ope_000000000000000000000000",
      "/bff/operations/op-89104",
      "/bff/exchange-orders/ord_000000000000000000000000",
      "/bff/markets/USDT%2FRUB",
      "/bff/markets/BOGUS",
      "/bff/markets/USDT/RUB",
      "/bff/checks/chk_000000000000000000000000",
      "/bff/checks/not-a-check",
      "/bff/address-screening/scr_00000000000000000000000000000000",
      "/bff/address-screening/not-a-screening",
      "/bff/address-screening/sup_000000000000000000000000",
      "/bff/support/requests/sup_000000000000000000000000"
    ]) {
      await deniedGet(path, devVerified.cookie, 404, "not_found");
    }
  });

  it("serves the quote preview per the documented availability contract", async () => {
    // Preview is synthetic either way; a verified session consults the
    // upstream wallet for the availability flag — denied means the balance
    // reads as zero, so insufficientBalance stays honest.
    const preview = await okGet(
      "/bff/quotes/preview?from=RUB&to=USDT&amount=5000",
      devVerified.cookie
    );
    assert.match(preview.id, /^quote_[0-9a-f]{32}$/);
    assert.equal(preview.from, "RUB");
    assert.equal(preview.to, "USDT");
    assert.equal(preview.amountIn, "5000.00");
    assert.deepEqual(Object.keys(preview.rate).sort(), ["base", "quote", "value"]);
    assert.equal(preview.rate.base, "USDT");
    assert.equal(preview.rate.quote, "RUB");
    assert.equal(preview.insufficientBalance, true);
    assert.equal(preview.kycRequired, false);
    assert.equal(preview.executable, false);
    assert.equal(preview.executionUnavailableReason, "dev_test_version");
    assert.equal(preview.ttlSeconds, 30);
    // The preview is arithmetic, not decoration: the fee is ~30bps of the
    // RUB leg, amountOut follows netIn through the quoted rate, the input
    // total stays intact, and the bucket-aligned issue time precedes
    // serverTime by less than one TTL window.
    assert.equal(preview.feeAsset, "RUB");
    assert.equal(preview.feeBps, 30);
    assert.equal(preview.spreadBps, 50);
    assert.equal(preview.total, preview.amountIn);
    assert.match(preview.netIn, /^[0-9]+\.[0-9]{2}$/);
    assert.match(preview.amountOut, /^[0-9]+\.[0-9]+$/);
    assert.match(preview.rate.value, /^[0-9]+\.[0-9]+$/);
    const feeBps = (Number(preview.fee) / Number(preview.netIn)) * 10_000;
    assert.ok(feeBps > 28 && feeBps < 32, `fee ${preview.fee} vs netIn ${preview.netIn}`);
    const expectedOut = Number(preview.netIn) / Number(preview.rate.value);
    assert.ok(
      Math.abs(Number(preview.amountOut) - expectedOut) / expectedOut < 0.05,
      `amountOut ${preview.amountOut} vs netIn/rate ${expectedOut}`
    );
    assert.equal(preview.expiresAt - preview.issuedAt, preview.ttlSeconds * 1_000);
    assert.ok(preview.serverTime >= preview.issuedAt);
    assert.ok(preview.serverTime - preview.issuedAt < 120_000);
    // The reverse pair must carry the same contract (a one-pair special
    // case is a classic drift).
    const reverse = await okGet(
      "/bff/quotes/preview?from=USDT&to=RUB&amount=55.55",
      devVerified.cookie
    );
    assert.equal(reverse.from, "USDT");
    assert.equal(reverse.to, "RUB");
    assert.equal(reverse.rate.base, "USDT");
    assert.equal(reverse.rate.quote, "RUB");
    assert.equal(reverse.feeAsset, "RUB");
    assert.equal(reverse.total, reverse.amountIn);
    const reverseOut = Number(reverse.amountIn) * Number(reverse.rate.value);
    assert.ok(
      Math.abs(Number(reverse.amountOut) - reverseOut) / reverseOut < 0.05,
      `reverse amountOut ${reverse.amountOut} vs amountIn*rate ${reverseOut}`
    );
    const gatedPreview = await okGet(
      "/bff/quotes/preview?from=RUB&to=USDT&amount=5000",
      devGated.cookie
    );
    assert.equal(gatedPreview.kycRequired, true);
    assert.equal(gatedPreview.insufficientBalance, true);
    assert.equal(gatedPreview.executable, false);
    assert.equal(gatedPreview.executionUnavailableReason, "dev_test_version");
    // The three declared keys are all required; anything else, a hostile
    // value, or a same-currency pair fails closed with its own code.
    for (const [path, error] of [
      ["/bff/quotes/preview?from=RUB&to=USDT", "invalid_amount"],
      ["/bff/quotes/preview?from=RUB&amount=5", "invalid_pair"],
      ["/bff/quotes/preview?to=USDT&amount=5", "invalid_pair"],
      ["/bff/quotes/preview?from=RUB&to=RUB&amount=5", "invalid_pair"],
      ["/bff/quotes/preview?from=rub&to=USDT&amount=5", "invalid_pair"],
      ["/bff/quotes/preview?from=RUB&to=USDT&amount=bogus", "invalid_amount"],
      ["/bff/quotes/preview?from=RUB&to=USDT&amount=-5", "invalid_amount"],
      ["/bff/quotes/preview?from=RUB&to=USDT&amount=0", "invalid_amount"],
      ["/bff/quotes/preview?from=RUB&to=USDT&amount=5&extra=1", "invalid_request"]
    ]) {
      await deniedGet(path, devVerified.cookie, 400, error);
    }
    // A verified session can never re-apply for KYC.
    const reapply = await postMiniapp("/bff/kyc/applications", {}, { cookie: devVerified.cookie });
    assert.equal(reapply.status, 409);
    assert.deepEqual(await readJson(reapply), { error: "kyc_already_verified" });
  });

  it("serves the check preview per the documented availability contract", async () => {
    // Same availability contract as the quote preview: a verified session
    // consults the upstream wallet — denied means available reads as zero,
    // so insufficientBalance stays honest; decimals stay canonical strings.
    const preview = await okGet(
      "/bff/checks/preview?asset=USDT&amount=10",
      devVerified.cookie
    );
    assert.match(preview.id, /^CHK-[0-9A-F]{12}$/);
    assert.equal(preview.mode, "test");
    assert.equal(preview.asset, "USDT");
    assert.equal(preview.amount, "10.000000");
    assert.equal(preview.fee, "0.030000");
    assert.equal(preview.feeAsset, "USDT");
    assert.equal(preview.feeBps, 30);
    assert.equal(preview.total, "10.030000");
    assert.equal(preview.claimRule, "personal");
    assert.equal(preview.insufficientBalance, true);
    assert.equal(preview.kycRequired, false);
    assert.equal(preview.executable, false);
    assert.equal(preview.executionUnavailableReason, "dev_test_version");
    assert.equal(preview.ttlSeconds, 259_200);
    assert.equal(preview.expiresAt - preview.issuedAt, preview.ttlSeconds * 1_000);
    assert.equal(typeof preview.issuedAt, "number");
    assert.equal(typeof preview.serverTime, "number");
    const gatedPreview = await okGet(
      "/bff/checks/preview?asset=USDT&amount=10",
      devGated.cookie
    );
    assert.equal(gatedPreview.kycRequired, true);
    // Non-enum assets and unparseable or non-positive amounts fail closed —
    // each with its own code, not a lumped 400.
    await deniedGet("/bff/checks/preview?asset=BTC&amount=1", devVerified.cookie, 400, "invalid_asset");
    await deniedGet("/bff/checks/preview?asset=USDT&amount=0", devVerified.cookie, 400, "invalid_amount");
    await deniedGet(
      "/bff/checks/preview?asset=USDT&amount=bogus",
      devVerified.cookie,
      400,
      "invalid_amount"
    );
    // Both declared keys are required; hostile forms of either fail closed
    // with their own code, and nothing extra is tolerated.
    for (const [path, error] of [
      ["/bff/checks/preview?asset=USDT", "invalid_amount"],
      ["/bff/checks/preview?amount=5", "invalid_asset"],
      ["/bff/checks/preview?asset=usdt&amount=5", "invalid_asset"],
      ["/bff/checks/preview?asset=USDT&amount=", "invalid_amount"],
      ["/bff/checks/preview?asset=USDT&amount=5.5.5", "invalid_amount"],
      ["/bff/checks/preview?asset=USDT&amount=-3", "invalid_amount"],
      ["/bff/checks/preview?asset=USDT&amount=%205", "invalid_amount"],
      ["/bff/checks/preview?asset=USDT&amount=5&extra=1", "invalid_request"]
    ]) {
      await deniedGet(path, devVerified.cookie, 400, error);
    }
  });

  it("drives the local write lifecycle: kyc submit, read-outbox, session revocation, logout", async () => {
    // KYC onboarding on an unverified (telegram) subject: the first submit
    // creates the application — 202 and the stored view — and an immediate
    // resubmit returns 200 with the same view, never a second record.
    const submit = await postMiniapp("/bff/kyc/applications", {}, { cookie: telegram.cookie });
    const submitView = await readJson(submit);
    assert.equal(submit.status, 202);
    assert.equal(submitView.mode, "test");
    assert.equal(submitView.provider, "simulator");
    assert.equal(submitView.state, "submitted");
    assert.equal(submitView.sessionKyc, "kyc-gated");
    assert.equal(submitView.canSubmit, false);
    assert.equal(typeof submitView.submittedAt, "number");
    assert.equal(typeof submitView.reviewDeadline, "number");
    assert.ok(submitView.reviewDeadline > submitView.submittedAt);
    const resubmit = await postMiniapp("/bff/kyc/applications", {}, { cookie: telegram.cookie });
    assert.equal(resubmit.status, 200);
    assert.deepEqual(await readJson(resubmit), submitView);
    // The local submission owns the read path: /bff/kyc/status answers the
    // stored application verbatim rather than the upstream directory view.
    assert.deepEqual(await okGet("/bff/kyc/status", telegram.cookie), submitView);

    // The dev subject's outbox has unread entries from the earlier probes;
    // marking them by id flips unread to 0 exactly, re-marking is a 0-op,
    // and ids that are well-formed but not this subject's mark nothing.
    const outbox = await okGet("/bff/notifications", devVerified.cookie);
    assert.ok(outbox.unread > 0);
    assert.ok(outbox.notifications.every((entry) => entry.read === false));
    const ids = outbox.notifications.map((entry) => entry.id).join(",");
    const mark = await postMiniapp("/bff/notifications/read", { ids }, { cookie: devVerified.cookie });
    assert.equal(mark.status, 200);
    assert.deepEqual(await readJson(mark), { marked: outbox.unread, unread: 0 });
    const after = await okGet("/bff/notifications", devVerified.cookie);
    assert.equal(after.unread, 0);
    assert.ok(after.notifications.every((entry) => entry.read === true));
    const remark = await postMiniapp("/bff/notifications/read", { ids }, { cookie: devVerified.cookie });
    assert.equal(remark.status, 200);
    assert.deepEqual(await readJson(remark), { marked: 0, unread: 0 });
    // Member-bound: the dev subject's ids under the telegram session mark
    // nothing, and a never-minted well-formed id is the same no-op.
    const tgBefore = await okGet("/bff/notifications", telegram.cookie);
    const foreign = await postMiniapp("/bff/notifications/read", { ids }, { cookie: telegram.cookie });
    assert.equal(foreign.status, 200);
    assert.deepEqual(await readJson(foreign), { marked: 0, unread: tgBefore.unread });
    const phantom = await postMiniapp(
      "/bff/notifications/read",
      { ids: `ntf_${"0".repeat(24)}` },
      { cookie: devVerified.cookie }
    );
    assert.equal(phantom.status, 200);
    assert.deepEqual(await readJson(phantom), { marked: 0, unread: 0 });
    // Hostile id lists fail closed on the uniform body grammar.
    for (const body of [
      { ids: "" },
      { ids: "not-an-id" },
      { ids: `ntf_${"a".repeat(24)},ntf_${"a".repeat(24)}` },
      { ids: Array.from({ length: 21 }, (_, i) => `ntf_${String(i).padStart(24, "0")}`).join(",") }
    ]) {
      const denied = await postMiniapp("/bff/notifications/read", body, {
        cookie: devVerified.cookie
      });
      assert.equal(denied.status, 400);
      assert.deepEqual(await readJson(denied), { error: "invalid_request" });
    }

    // Single-session revoke is unreachable on a configured stack by design:
    // the served roster belongs to the upstream directory and its `sess_*`
    // handles fail the local `ses_*` grammar — the route still fails closed
    // both on the upstream-shape handle and on a well-formed local handle
    // that binds no live record.
    const upstreamHandle = (await okGet("/bff/sessions", devVerified.cookie)).sessions[0]
      .handle;
    assert.match(upstreamHandle, /^sess_[0-9a-f]{24}$/);
    for (const handle of [upstreamHandle, `ses_${"0".repeat(32)}`]) {
      const denied = await postMiniapp(
        "/bff/sessions/revoke",
        { handle },
        { cookie: devVerified.cookie }
      );
      assert.equal(denied.status, handle === upstreamHandle ? 400 : 404);
    }
    // revoke-others is the reachable revocation on this stack: mint a
    // sibling dev session on the same subject, evict it, and its cookie
    // dies while the caller's lives on.
    const sibling = await devSession("verified");
    const revokeOthers = await postMiniapp(
      "/bff/sessions/revoke-others",
      {},
      { cookie: devVerified.cookie }
    );
    assert.equal(revokeOthers.status, 200);
    const dead = await bffGet("/bff/session", sibling.cookie);
    assert.equal(dead.status, 401);
    assert.equal((await bffGet("/bff/session", devVerified.cookie)).status, 200);
    // Every dev login shares the one synthetic dev subject — devGated was a
    // sibling and was evicted too; re-mint it for the remaining tests.
    devGated = await devSession("kyc-gated");
    assert.equal(devGated.view.kyc, "kyc-gated");
    // The same eviction works on the telegram subject's siblings.
    const tgSecond = await telegramSession(8_000_002);
    const tgThird = await telegramSession(8_000_002);
    const tgRevokeOthers = await postMiniapp(
      "/bff/sessions/revoke-others",
      {},
      { cookie: tgSecond.cookie }
    );
    assert.equal(tgRevokeOthers.status, 200);
    const evicted = await bffGet("/bff/session", tgThird.cookie);
    assert.equal(evicted.status, 401);
    // Logout kills exactly the calling session.
    const doomed = await devSession("verified");
    const logout = await postMiniapp("/bff/auth/logout", {}, { cookie: doomed.cookie });
    assert.equal(logout.status, 200);
    const loggedOut = await bffGet("/bff/session", doomed.cookie);
    assert.equal(loggedOut.status, 401);
    assert.equal((await bffGet("/bff/session", devVerified.cookie)).status, 200);
  });
});

describe("miniapp chain fail-closed paths", () => {
  it("rejects unauthenticated and wrong-family credentials at both layers", async () => {
    for (const path of [
      "/bff/session",
      "/bff/account",
      "/bff/wallet",
      "/bff/notifications",
      "/bff/support/requests"
    ]) {
      const response = await fetch(`${miniappBase}${path}`);
      const body = await readJson(response);
      assert.deepEqual(body, { error: "unauthenticated" });
      assert.equal(response.status, 401);
    }
    // A forged session bearer — exactly the store's smt_<64hex> shape but
    // never minted — denies identically to an absent one: the store resolves
    // the token digest, not the bearer shape.
    for (const path of ["/bff/session", "/bff/account"]) {
      await deniedGet(path, `solidchange_ma_session=smt_${"0".repeat(64)}`, 401, "unauthenticated");
    }
    // X-Device-Id is operator-only: the BFF edge and the upstream customer
    // surface both refuse it, each with its own error family.
    const deviceAtBff = await bffGet("/bff/session", devVerified.cookie, {
      "x-device-id": randomUUID()
    });
    assert.equal(deviceAtBff.status, 400);
    assert.deepEqual(await readJson(deviceAtBff), { error: "invalid_request" });
    const deviceUpstream = await upstreamGet(
      "/api/v1/customer/session",
      mintCustomer(devUpstreamSubject),
      { "x-device-id": randomUUID() }
    );
    assert.equal(deviceUpstream.status, 400);
    assert.equal((await readJson(deviceUpstream)).code, "VALIDATION_FAILED");
    // Operator-family tokens are bound to the operator audience; a tampered
    // customer token fails the same authentication check.
    for (const token of [
      mintOperator("chainprobe"),
      `${mintCustomer(devUpstreamSubject)}x`
    ]) {
      const response = await upstreamGet("/api/v1/customer/session", token);
      const body = await readJson(response);
      assert.equal(response.status, 401);
      assert.equal(body.code, "AUTHENTICATION_REQUIRED");
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
    }
    // Signature and lifetime are the whole synthetic-token contract: an
    // expired token, a beyond-TTL token and a well-formed token signed under
    // a different key all fail as unauthenticated with the Bearer challenge.
    const now = Math.floor(Date.now() / 1_000);
    for (const token of [
      mintSyntheticCustomerToken({ key: devTokenKey, subject: devUpstreamSubject, expiresAtSeconds: now - 1 }),
      mintSyntheticCustomerToken({ key: devTokenKey, subject: devUpstreamSubject, expiresAtSeconds: now + 7_200 }),
      mintSyntheticCustomerToken({ key: randomBytes(32).toString("hex"), subject: devUpstreamSubject, expiresAtSeconds: now + 300 })
    ]) {
      const response = await upstreamGet("/api/v1/customer/session", token);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.equal((await readJson(response)).code, "AUTHENTICATION_REQUIRED");
    }
    // The declared request headers are part of the contract: absent or
    // malformed x-request-id / x-client-version / x-platform fail closed as
    // VALIDATION_FAILED before authn — they are not tolerated decoration.
    for (const [name, value] of [
      ["x-request-id", null],
      ["x-request-id", "not-a-uuidv7"],
      ["x-client-version", null],
      ["x-client-version", ""],
      ["x-platform", null],
      ["x-platform", "not-a-platform"]
    ]) {
      const headers = upstreamHeaders(mintCustomer(devUpstreamSubject));
      if (value === null) {
        delete headers[name];
      } else {
        headers[name] = value;
      }
      const response = await fetch(`${upstreamBase}/api/v1/customer/session`, { headers });
      assert.equal(response.status, 400, name);
      assert.equal((await readJson(response)).code, "VALIDATION_FAILED", name);
    }
    // Cross-site fetches and origin-less writes stay refused.
    const crossSite = await bffGet("/bff/session", devVerified.cookie, {
      "sec-fetch-site": "cross-site"
    });
    assert.equal(crossSite.status, 403);
    assert.deepEqual(await readJson(crossSite), { error: "fetch_site_rejected" });
    // The telegram login and the authenticated writes answer a missing or
    // non-allowlisted origin with origin_rejected...
    const noOrigin = await fetch(`${miniappBase}/bff/session/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(noOrigin.status, 403);
    assert.deepEqual(await readJson(noOrigin), { error: "origin_rejected" });
    const wrongOrigin = await postMiniapp(
      "/bff/session/telegram",
      { initData: "bogus" },
      { origin: "https://evil.example.com" }
    );
    assert.equal(wrongOrigin.status, 403);
    assert.deepEqual(await readJson(wrongOrigin), { error: "origin_rejected" });
    const noOriginWrite = await fetch(`${miniappBase}/bff/support/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: devVerified.cookie },
      body: "{}"
    });
    assert.equal(noOriginWrite.status, 403);
    assert.deepEqual(await readJson(noOriginWrite), { error: "origin_rejected" });
    // ...while the dev-login route hides itself entirely on a bad origin.
    const hiddenDevLogin = await postMiniapp(
      "/bff/auth/dev-session",
      { kyc: "verified" },
      { origin: "https://evil.example.com" }
    );
    assert.equal(hiddenDevLogin.status, 404);
    assert.deepEqual(await readJson(hiddenDevLogin), { error: "not_found" });
  });

  it("rejects tampered query input on the routes that declare none", async () => {
    // Every GET surface outside the declared query-input set answers any
    // non-empty query with the member reads' 400 — the uniform pin the
    // wave-68 route-table audit landed.
    for (const path of [
      "/bff/session?bogus=1",
      "/bff/account?bogus=1",
      "/bff/profile?bogus=1",
      "/bff/kyc/status?bogus=1",
      "/bff/wallet?bogus=1",
      "/bff/deposits?bogus=1",
      "/bff/withdrawals?bogus=1",
      "/bff/operations?bogus=1",
      "/bff/quotes?bogus=1",
      "/bff/exchange-orders?bogus=1",
      "/bff/trades?bogus=1",
      "/bff/markets?bogus=1",
      "/bff/payments?bogus=1",
      "/bff/cards?bogus=1",
      "/bff/health?bogus=1",
      "/bff/notifications?bogus=1",
      "/bff/sessions?bogus=1",
      "/bff/support/requests?bogus=1",
      `/bff/support/requests/${supportRequest.id}?bogus=1`,
      "/bff/address-screening?bogus=1",
      `/bff/address-screening/${screeningView.id}?bogus=1`,
      "/bff/operations/ope_000000000000000000000000?bogus=1",
      "/bff/markets/USDT%2FRUB?bogus=1",
      "/bff/checks?bogus=1",
      `/bff/checks/${checkReference}?bogus=1`,
      "/bff/activity?limit=0",
      "/bff/activity?limit=bogus",
      "/bff/activity?bogus=1",
      "/bff/quotes/preview?bogus=1",
      "/bff/checks/preview?bogus=1",
      "/bff/quotes/preview?from=RUB&to=USDT&amount=5000&bogus=1"
    ]) {
      await deniedGet(path, devVerified.cookie, 400, "invalid_request");
    }
    // GET on a POST-only route answers the same never-registered 404 as a
    // path that does not exist at all — it never asks for a session.
    for (const path of [
      "/bff/auth/dev-session",
      "/bff/auth/logout",
      "/bff/session/telegram",
      "/bff/sessions/revoke",
      "/bff/sessions/revoke-others",
      "/bff/kyc/applications",
      "/bff/notifications/read"
    ]) {
      await deniedGet(path, devVerified.cookie, 404, "not_found");
    }
    // POST on a GET-only route is the mirror image: a well-formed write
    // never reaches the read handlers, whatever the path.
    for (const path of [
      "/bff/session",
      "/bff/account",
      "/bff/profile",
      "/bff/kyc/status",
      "/bff/wallet",
      "/bff/checks",
      `/bff/checks/${checkReference}`,
      "/bff/checks/preview?asset=USDT&amount=5",
      "/bff/quotes/preview?from=RUB&to=USDT&amount=5",
      "/bff/activity?limit=1",
      "/bff/notifications",
      "/bff/sessions",
      "/bff/markets/USDT%2FRUB",
      "/bff/operations",
      "/bff/deposits"
    ]) {
      const response = await postMiniapp(path, { probe: "x" }, { cookie: devVerified.cookie });
      assert.equal(response.status, 404, `POST ${path}`);
      assert.deepEqual(await readJson(response), { error: "not_found" });
    }
    // PUT/DELETE are not in either method family — same never-registered
    // 404, still before any session work.
    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const response = await fetch(`${miniappBase}/bff/checks`, {
        method,
        headers: { cookie: devVerified.cookie, origin: allowedOrigin }
      });
      assert.equal(response.status, 404, `${method} /bff/checks`);
      assert.deepEqual(await readJson(response), { error: "not_found" });
    }
    // The activity limit grammar is strict-canonical, not Number()-lax:
    // negatives, fractions, blanks, padding and duplicates all reject.
    for (const path of [
      "/bff/activity?limit=-1",
      "/bff/activity?limit=5.5",
      "/bff/activity?limit=",
      "/bff/activity?limit=%205",
      "/bff/activity?limit=05",
      "/bff/activity?limit=1e2",
      "/bff/activity?limit=5&limit=6",
      "/bff/activity?limit",
      "/bff/activity?=x"
    ]) {
      await deniedGet(path, devVerified.cookie, 400, "invalid_request");
    }
    // Upstream the same tampering fails the route match outright.
    for (const path of [
      "/api/v1/customer/session?bogus=1",
      "/api/v1/customer/operations?bogus=1",
      "/api/v1/customer/operations/ope_000000000000000000000000?bogus=1",
      "/api/v1/customer/notifications?bogus=1",
      "/api/v1/customer/activity?limit=5",
      "/api/v1/customer/checks?kind=sent",
      "/api/v1/customer/checks?cursor=1",
      "/api/v1/customer/account?=x",
      "/api/v1/customer/wallets?limit=1"
    ]) {
      assert.equal(await upstreamDenied(path), 404, path);
    }
    // A trailing "?" on the wire is still undeclared query input: fetch()
    // normalization differs across undici versions (some strip it before the
    // request leaves), so the pin goes through a raw HTTP request with the
    // exact request target in `path` — never re-parsed. The upstream answers
    // the same fail-closed 404 + CAPABILITY_DENIED as every
    // undeclared-query read.
    const rawQuestion = await new Promise((resolve, reject) => {
      const base = new URL(upstreamBase);
      const req = httpGet(
        {
          hostname: base.hostname,
          port: base.port,
          path: "/api/v1/customer/activity?",
          method: "GET",
          headers: upstreamHeaders(mintCustomer(devUpstreamSubject))
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        }
      );
      req.on("error", reject);
    });
    assert.equal(rawQuestion.body.code, "CAPABILITY_DENIED");
    assert.equal(rawQuestion.status, 404);
    // The check command surface stays contract-only: a well-formed POST —
    // valid token, declared headers, Idempotency-Key, JSON body — can never
    // reach a handler, on the collection, the preview, or either member
    // command. The same holds for any other GET-only customer operation.
    for (const path of [
      "/api/v1/customer/checks",
      "/api/v1/customer/checks/preview",
      "/api/v1/customer/checks/chk_000000000000000000000000/claim",
      "/api/v1/customer/checks/chk_000000000000000000000000/cancel",
      "/api/v1/customer/account",
      "/api/v1/customer/activity",
      "/api/v1/customer/notifications/read",
      "/api/v1/customer/wallets"
    ]) {
      const requestId = generateUuidV7();
      const response = await fetch(`${upstreamBase}${path}`, {
        method: "POST",
        headers: {
          ...upstreamHeaders(mintCustomer(devUpstreamSubject)),
          "x-request-id": requestId,
          "idempotency-key": randomBytes(16).toString("hex"),
          "content-type": "application/json"
        },
        body: "{}"
      });
      const body = await readJson(response);
      assert.equal(response.status, 404, `POST ${path}`);
      assert.equal(body.code, "CAPABILITY_DENIED");
      assert.equal(body.request_id, requestId);
    }
  });

  it("keeps the gated reads gated for an unverified session at both layers", async () => {
    // The gated session gets the identical documented degrade — same gated
    // fixtures the verified session sees through a denied upstream read.
    assert.deepEqual(await okGet("/bff/session", devGated.cookie), devGated.view);
    assert.equal(devGated.view.kyc, "kyc-gated");
    assert.equal(devGated.view.customerRef, devVerified.view.customerRef);
    assert.deepEqual(await okGet("/bff/wallet", devGated.cookie), gatedWalletView);
    for (const [path, key] of gatedCollections) {
      assert.deepEqual(await okGet(path, devGated.cookie), {
        mode: "test",
        kyc: "kyc-gated",
        [key]: []
      });
    }
    // Address screening is the one read surface that hard-gates on the
    // session kyc flag rather than degrading — every probe shape.
    for (const path of [
      "/bff/address-screening",
      `/bff/address-screening/${screeningView.id}`,
      "/bff/address-screening/not-a-screening"
    ]) {
      await deniedGet(path, devGated.cookie, 403, "kyc_required");
    }
    const gatedPost = await postMiniapp(
      "/bff/address-screening",
      { asset: "USDT", network: "TRON_TESTNET", address: tronTestnetOther },
      { cookie: devGated.cookie }
    );
    assert.equal(gatedPost.status, 403);
    assert.deepEqual(await readJson(gatedPost), { error: "kyc_required" });
    // Its upstream token meets the same uniform capability wall.
    for (const path of gatedUpstreamReads) {
      assert.equal(await upstreamDenied(path, mintCustomer(telegramUpstreamSubject)), 403, path);
    }
    // Wrong-prefix member ids deny identically to well-formed ones.
    assert.equal(await upstreamDenied("/api/v1/customer/operations/not-an-id"), 403);
    assert.equal(
      await upstreamDenied("/api/v1/customer/exchange-orders/not-an-order"),
      403
    );
    assert.equal(await upstreamDenied("/api/v1/customer/markets/BOGUS"), 404);
  });

  it("keeps subjects isolated at both layers", async () => {
    // The telegram session maps onto a different syn_cust_* subject: its
    // never-denied views are derived from a different upstream roster.
    const tgAccount = await okGet("/bff/account", telegram.cookie);
    assert.deepEqual(tgAccount, await expectedAccountView(telegramUpstreamSubject));
    assert.notEqual(tgAccount.id, (await expectedAccountView(devUpstreamSubject)).id);
    assert.notEqual(tgAccount.subject, devUpstreamSubject);
    const tgProfile = await okGet("/bff/profile", telegram.cookie);
    const tgUpstreamProfile = await profileDirectory.viewFor(telegramUpstreamSubject);
    assert.equal(tgProfile.displayName, tgUpstreamProfile.display_name);
    assert.equal(tgProfile.customerRef, tgUpstreamProfile.customer_ref);
    const devUpstreamProfile = await profileDirectory.viewFor(devUpstreamSubject);
    assert.notEqual(tgProfile.customerRef, devUpstreamProfile.customer_ref);
    assert.deepEqual(tgProfile.apiAccess, apiAccessView);
    // The telegram subject's local submission from the lifecycle test owns
    // its read path — the status answers the stored application, not the
    // upstream directory verdict.
    const tgKyc = await okGet("/bff/kyc/status", telegram.cookie);
    assert.equal(tgKyc.mode, "test");
    assert.equal(tgKyc.provider, "simulator");
    assert.equal(tgKyc.state, "submitted");
    assert.equal(tgKyc.sessionKyc, "kyc-gated");
    assert.equal(tgKyc.canSubmit, false);
    assert.equal(typeof tgKyc.submittedAt, "number");
    assert.equal(typeof tgKyc.reviewDeadline, "number");
    assert.ok(tgKyc.reviewDeadline > tgKyc.submittedAt);
    assert.deepEqual(
      await okGet("/bff/sessions", telegram.cookie),
      await expectedSessionsView(telegramUpstreamSubject)
    );
    assert.deepEqual(
      await okGet("/bff/support/requests", telegram.cookie),
      await expectedSupportList(telegramUpstreamSubject)
    );
    // Local stores are subject-scoped: the dev subject's screening and
    // support records do not exist for the telegram subject — and the
    // screening member read still hits the session kyc gate first.
    await deniedGet(
      `/bff/support/requests/${supportRequest.id}`,
      telegram.cookie,
      404,
      "not_found"
    );
    await deniedGet(
      `/bff/address-screening/${screeningView.id}`,
      telegram.cookie,
      403,
      "kyc_required"
    );
    const tgNotifications = await okGet("/bff/notifications", telegram.cookie);
    // session_login from before() plus kyc_submitted from the write-lifecycle
    // test's local onboarding submit — the outbox accrues per subject.
    assert.equal(tgNotifications.unread, 2);
    assert.equal(tgNotifications.notifications.length, 2);
    assert.deepEqual(
      tgNotifications.notifications.map((entry) => entry.template).sort(),
      ["kyc_submitted", "session_login"]
    );
    // Upstream binds every read to the minted token's subject.
    const tgSession = await readJson(
      await upstreamGet("/api/v1/customer/session", mintCustomer(telegramUpstreamSubject))
    );
    assert.equal(tgSession.subject, telegramUpstreamSubject);
    const tgUsers = await readJson(
      await upstreamGet("/api/v1/customer/users", mintCustomer(telegramUpstreamSubject))
    );
    assert.equal(tgUsers.user_id, tgAccount.id);
    assert.notEqual(tgUsers.user_id, (await expectedAccountView(devUpstreamSubject)).id);
    // A member probe under another subject's token denies identically —
    // the capability gate fires before any ownership check could leak.
    for (const path of gatedUpstreamMemberReads) {
      assert.equal(
        await upstreamDenied(path, mintCustomer(telegramUpstreamSubject)),
        403,
        path
      );
    }
  });

  it("keeps session issuance closed under hostile input at both entry points", async () => {
    // dev-session origin and fetch-site rules: a missing Origin self-hides
    // with the same never-registered 404 a bad origin already gets, and a
    // cross-site POST is refused before origin parsing.
    const noOrigin = await fetch(`${miniappBase}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kyc: "verified" })
    });
    assert.equal(noOrigin.status, 404);
    assert.deepEqual(await readJson(noOrigin), { error: "not_found" });
    const crossPost = await fetch(`${miniappBase}/bff/auth/dev-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: allowedOrigin,
        "sec-fetch-site": "cross-site"
      },
      body: JSON.stringify({ kyc: "verified" })
    });
    assert.equal(crossPost.status, 403);
    assert.deepEqual(await readJson(crossPost), { error: "fetch_site_rejected" });

    // dev-session body grammar: the kyc enum is closed, the key allowlist
    // is closed, values must be strings, duplicates reject, the media type
    // is exact, and the 4KiB bound holds — each with its own status/code.
    const devBody = async (raw, headers = {}) =>
      fetch(`${miniappBase}/bff/auth/dev-session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: allowedOrigin, ...headers },
        body: raw
      });
    const okEmpty = await devBody("{}");
    assert.equal(okEmpty.status, 201);
    assert.equal((await readJson(okEmpty)).kyc, "verified");
    for (const [raw, status, error] of [
      [JSON.stringify({ kyc: "bogus" }), 400, "invalid_request"],
      [JSON.stringify({ kyc: "VERIFIED" }), 400, "invalid_request"],
      [JSON.stringify({ kyc: "" }), 400, "invalid_request"],
      [JSON.stringify({ kyc: "verified", extra: "1" }), 400, "invalid_request"],
      [JSON.stringify({ kyc: 123 }), 400, "invalid_request"],
      [JSON.stringify({ kyc: null }), 400, "invalid_request"],
      [JSON.stringify(["verified"]), 400, "invalid_request"],
      ["{", 400, "invalid_request"],
      ['{"kyc":"verified","kyc":"kyc-gated"}', 400, "invalid_request"],
      [JSON.stringify({ pad: "x".repeat(4_200) }), 400, "invalid_request"]
    ]) {
      const denied = await devBody(raw);
      assert.equal(denied.status, status, raw.slice(0, 60));
      assert.deepEqual(await readJson(denied), { error });
    }
    for (const contentType of [
      "text/plain",
      "application/json; charset=latin1",
      "application/json; charset=utf-8; boundary=x",
      "application/vnd.api+json"
    ]) {
      const denied = await devBody("{}", { "content-type": contentType });
      assert.equal(denied.status, 415, contentType);
      assert.deepEqual(await readJson(denied), { error: "unsupported_media_type" });
    }

    // Telegram login carries the full verify battery: every rejection
    // class answers 401 with its own reason — a minted session can only
    // come from a signature under the configured token.
    const authDateNow = String(Math.floor(Date.now() / 1_000));
    const userJson = JSON.stringify({ id: 8_000_009, first_name: "Hostile" });
    const signed = (fields) =>
      signInitData(new Map(fields), botToken);
    const wrongToken = signInitData(
      new Map([
        ["auth_date", authDateNow],
        ["user", userJson]
      ]),
      `${randomInt(100_000, 999_999_999)}:${randomBytes(30).toString("base64url")}`
    );
    const tampered = signed([
      ["auth_date", authDateNow],
      ["user", userJson]
    ]).replace("first_name", "first_nam3");
    const stale = signed([
      ["auth_date", String(Math.floor(Date.now() / 1_000) - 3_600)],
      ["user", userJson]
    ]);
    const future = signed([
      ["auth_date", String(Math.floor(Date.now() / 1_000) + 3_600)],
      ["user", userJson]
    ]);
    const notAnObject = signed([
      ["auth_date", authDateNow],
      ["user", JSON.stringify("just-a-string")]
    ]);
    const missingId = signed([
      ["auth_date", authDateNow],
      ["user", JSON.stringify({ first_name: "No Id" })]
    ]);
    const noUser = signed([["auth_date", authDateNow]]);
    const noHash = `auth_date=${authDateNow}&user=${encodeURIComponent(userJson)}`;
    const dupUser = `${signed([
      ["auth_date", authDateNow],
      ["user", userJson]
    ])}&user=${encodeURIComponent(userJson)}`;
    for (const [initData, reason] of [
      [wrongToken, "invalid_hash"],
      [tampered, "invalid_hash"],
      [stale, "stale_auth_date"],
      [future, "future_auth_date"],
      [notAnObject, "invalid_user"],
      [missingId, "invalid_user"],
      [noUser, "invalid_user"],
      [noHash, "missing_hash"],
      [dupUser, "duplicate_key"]
    ]) {
      const denied = await postMiniapp("/bff/session/telegram", { initData });
      assert.equal(denied.status, 401, reason);
      assert.deepEqual(await readJson(denied), { error: "init_data_rejected", reason });
    }
    // None of the forged attempts minted a session cookie.
    const forged = await postMiniapp("/bff/session/telegram", { initData: wrongToken });
    assert.equal(forged.status, 401);
    assert.equal(forged.headers.get("set-cookie"), null);
  });
});

describe("miniapp chain degrade and recovery", () => {
  it("fails closed per the documented contract while customer-api is down", async () => {
    await stopService(customerApi);
    try {
      // Verified session: every route that consults upstream answers its
      // own <route>_unavailable — never fabricated data and never a
      // cross-route error shape.
      for (const [path, error] of [
        ["/bff/account", "account_unavailable"],
        ["/bff/profile", "profile_unavailable"],
        ["/bff/kyc/status", "kyc_unavailable"],
        ["/bff/sessions", "sessions_unavailable"],
        ["/bff/support/requests", "support_unavailable"],
        ["/bff/wallet", "wallet_unavailable"],
        ["/bff/deposits", "deposits_unavailable"],
        ["/bff/withdrawals", "withdrawals_unavailable"],
        ["/bff/operations", "operations_unavailable"],
        ["/bff/operations/ope_000000000000000000000000", "operations_unavailable"],
        ["/bff/notifications", "notifications_unavailable"],
        ["/bff/activity", "activity_unavailable"],
        ["/bff/quotes", "quotes_unavailable"],
        ["/bff/quotes/preview?from=RUB&to=USDT&amount=5000", "quote_unavailable"],
        ["/bff/exchange-orders", "exchange_orders_unavailable"],
        ["/bff/trades", "trades_unavailable"],
        ["/bff/markets", "markets_unavailable"],
        ["/bff/markets/USDT%2FRUB", "markets_unavailable"],
        ["/bff/payments", "payments_unavailable"],
        ["/bff/cards", "cards_unavailable"],
        ["/bff/checks", "checks_unavailable"],
        [`/bff/checks/${checkReference}`, "checks_unavailable"],
        ["/bff/checks/preview?asset=USDT&amount=10", "checks_unavailable"],
        ["/bff/address-screening", "screening_unavailable"],
        [`/bff/address-screening/${screeningView.id}`, "screening_unavailable"]
      ]) {
        await deniedGet(path, devVerified.cookie, 503, error);
      }
      // Local-only surfaces and pre-flight guards survive the outage: the
      // session view, health, the local support member read, and every
      // member probe whose id never reaches upstream.
      assert.deepEqual(await okGet("/bff/session", devVerified.cookie), devVerified.view);
      assert.deepEqual(await okGet("/bff/health", devVerified.cookie), healthView);
      assert.deepEqual(
        await okGet(`/bff/support/requests/${supportRequest.id}`, devVerified.cookie),
        supportRequest
      );
      await deniedGet("/bff/operations/not-an-id", devVerified.cookie, 404, "not_found");
      await deniedGet("/bff/markets/BOGUS", devVerified.cookie, 404, "not_found");
      await deniedGet(
        "/bff/address-screening/not-a-screening",
        devVerified.cookie,
        404,
        "not_found"
      );
      await deniedGet(
        "/bff/exchange-orders/ord_000000000000000000000000",
        devVerified.cookie,
        404,
        "not_found"
      );
      // Local writes stay local — the screening and support stores do not
      // consult upstream even on the verified session.
      const outageScreening = await postMiniapp(
        "/bff/address-screening",
        { asset: "USDT", network: "TRON_TESTNET", address: tronTestnetOther },
        { cookie: devVerified.cookie }
      );
      outageScreeningView = await readJson(outageScreening);
      assert.equal(outageScreening.status, 202);
      const outageSupport = await postMiniapp(
        "/bff/support/requests",
        { category: "question", topic: "outage", message: "synthetic" },
        { cookie: devVerified.cookie }
      );
      assert.equal(outageSupport.status, 201);
      outageSupportView = await readJson(outageSupport);
      // The read-mark POST consults upstream on the verified session and
      // fails closed with the sibling *_unavailable shape.
      const markRead = await postMiniapp(
        "/bff/notifications/read",
        { ids: "ntf_000000000000000000000000" },
        { cookie: devVerified.cookie }
      );
      assert.equal(markRead.status, 503);
      assert.deepEqual(await readJson(markRead), { error: "notifications_unavailable" });
      // The gated session never calls upstream on the gated surfaces, so it
      // keeps its documented degrade — while the never-denied reads still
      // 503 because they consult upstream for every session.
      assert.deepEqual(await okGet("/bff/wallet", devGated.cookie), gatedWalletView);
      assert.deepEqual(await okGet("/bff/operations", devGated.cookie), { operations: [] });
      const gatedNotifications = await okGet("/bff/notifications", devGated.cookie);
      assert.equal(gatedNotifications.mode, "test");
      assert.equal(gatedNotifications.delivery, "disabled");
      for (const [path, error] of [
        ["/bff/account", "account_unavailable"],
        ["/bff/profile", "profile_unavailable"],
        ["/bff/kyc/status", "kyc_unavailable"],
        ["/bff/support/requests", "support_unavailable"]
      ]) {
        await deniedGet(path, devGated.cookie, 503, error);
      }
      await deniedGet("/bff/address-screening", devGated.cookie, 403, "kyc_required");
    } finally {
      // Rebind the same port the BFF is configured to reach.
      customerApiEnv.CUSTOMER_API_PORT = upstreamPort;
      await startCustomerApi();
    }
    // Recovery: the same cookies — no re-login — and the live-upstream
    // surfaces answer exactly what they served before the kill.
    assert.deepEqual(
      await okGet("/bff/account", devVerified.cookie),
      await expectedAccountView(devUpstreamSubject)
    );
    assert.deepEqual(
      await okGet("/bff/kyc/status", devVerified.cookie),
      await expectedKycView(devUpstreamSubject)
    );
    assert.deepEqual(
      await okGet("/bff/sessions", devVerified.cookie),
      await expectedSessionsView(devUpstreamSubject)
    );
    const recoveredSupport = await okGet("/bff/support/requests", devVerified.cookie);
    const recoveredUpstream = await expectedSupportList(devUpstreamSubject);
    assert.deepEqual(
      recoveredSupport.requests.slice(-recoveredUpstream.requests.length),
      recoveredUpstream.requests
    );
    assert.deepEqual(
      recoveredSupport.requests.slice(0, recoveredSupport.requests.length - recoveredUpstream.requests.length).map((row) => row.id),
      [outageSupportView.id, secondSupportView.id, supportRequest.id]
    );
    const profile = await okGet("/bff/profile", devVerified.cookie);
    assert.deepEqual(profile.apiAccess, apiAccessView);
    assert.equal(
      profile.customerRef,
      (await profileDirectory.viewFor(devUpstreamSubject)).customer_ref
    );
    assert.deepEqual(await okGet("/bff/wallet", devVerified.cookie), gatedWalletView);
    assert.deepEqual(await okGet("/bff/operations", devVerified.cookie), { operations: [] });
    // Both locally-created screenings are back on the degraded list and on
    // their member reads once upstream refusals degrade in place again.
    const recovered = await okGet("/bff/address-screening", devVerified.cookie);
    assert.equal(recovered.mode, "test");
    assert.deepEqual(
      recovered.screenings.map((entry) => entry.id).sort(),
      [screeningView.id, secondScreeningView.id, outageScreeningView.id].sort()
    );
    assert.deepEqual(
      await okGet(`/bff/address-screening/${outageScreeningView.id}`, devVerified.cookie),
      outageScreeningView
    );
    // Every route that answered *_unavailable during the outage recovers
    // fully — no stale-degraded 503 survives on any of them. The gated
    // collections return their in-place degrade views (the upstream read
    // denies again), the previews answer full contracts, and the member
    // reads resolve their own namespaces again.
    for (const [path, key] of gatedCollections) {
      assert.deepEqual(await okGet(path, devVerified.cookie), {
        mode: "test",
        kyc: "kyc-gated",
        [key]: []
      }, path);
    }
    const recoveredChecks = await okGet("/bff/checks", devVerified.cookie);
    assert.equal(recoveredChecks.mode, "test");
    assert.equal(recoveredChecks.checks.length, 5);
    assert.equal(
      (await okGet(`/bff/checks/${checkReference}`, devVerified.cookie)).reference,
      checkReference
    );
    const recoveredNotifications = await okGet("/bff/notifications", devVerified.cookie);
    assert.equal(recoveredNotifications.mode, "test");
    assert.equal(typeof recoveredNotifications.unread, "number");
    const recoveredActivity = await okGet("/bff/activity?limit=5", devVerified.cookie);
    assert.equal(recoveredActivity.mode, "test");
    assert.equal(recoveredActivity.executable, false);
    const recoveredQuote = await okGet(
      "/bff/quotes/preview?from=RUB&to=USDT&amount=5000",
      devVerified.cookie
    );
    assert.equal(recoveredQuote.feeBps, 30);
    assert.equal(recoveredQuote.insufficientBalance, true);
    assert.equal(recoveredQuote.executable, false);
    const recoveredCheckPreview = await okGet(
      "/bff/checks/preview?asset=USDT&amount=10",
      devVerified.cookie
    );
    assert.equal(recoveredCheckPreview.mode, "test");
    assert.equal(recoveredCheckPreview.amount, "10.000000");
    await deniedGet(
      "/bff/operations/ope_000000000000000000000000",
      devVerified.cookie,
      404,
      "not_found"
    );
    await deniedGet("/bff/markets/USDT%2FRUB", devVerified.cookie, 404, "not_found");
  });
});
