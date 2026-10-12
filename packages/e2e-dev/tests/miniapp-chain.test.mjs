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
  freePort,
  miniappEntry,
  readJson,
  startService,
  stopService
} from "./stack.mjs";

const devTokenKey = randomBytes(32).toString("hex");
const botToken = `${randomInt(100_000, 999_999_999)}:${randomBytes(30).toString("base64url")}`;
const allowedOrigin = "http://127.0.0.1:4183";
const tronTestnet = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
const tronTestnetOther = "TKmJ2NCHa7qnFxj5KVNQ36Kfpri5L859h5";
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
      current: entry.current
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
let devVerified;
let devGated;
let telegram;
let supportRequest;
let screeningView;
let checkReference;
let outageScreeningView;

const customerApiEnv = {
  CUSTOMER_API_HOST: "127.0.0.1",
  CUSTOMER_API_PORT: "",
  CUSTOMER_API_DEV_AUTH: "synthetic",
  CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey,
  // The BFF's own upstream traffic and the direct contract probes all share
  // the loopback-IP bucket; keep the fixed window comfortably above the
  // file's total call count.
  CUSTOMER_API_RATE_LIMIT_PER_MINUTE: "5000"
};

async function startCustomerApi() {
  customerApi = await startService(customerApiEntry, customerApiEnv, customerApiReady);
  upstreamBase = `http://127.0.0.1:${customerApi.match[1]}`;
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
  customerApiEnv.CUSTOMER_API_PORT = String(await freePort());
  await startCustomerApi();
  const miniappPort = await freePort();
  miniapp = await startService(
    miniappEntry,
    {
      MINIAPP_BFF_HOST: "127.0.0.1",
      MINIAPP_BFF_PORT: String(miniappPort),
      MINIAPP_ALLOWED_ORIGINS: allowedOrigin,
      MINIAPP_ALLOW_DEV_LOGIN: "true",
      MINIAPP_TELEGRAM_BOT_TOKEN: botToken,
      MINIAPP_QUOTE_SOURCE: "provider-simulator",
      MINIAPP_KYC_SCENARIO: "approve",
      MINIAPP_KYT_SCENARIO: "medium",
      MINIAPP_CUSTOMER_API_URL: upstreamBase,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
    },
    miniappReady
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
    assert.equal(devVerified.view.authenticated, true);
    assert.equal(devVerified.view.source, "dev-synthetic");
    assert.equal(devVerified.view.kyc, "verified");
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
    assert.equal(screeningView.status, "pending");
    assert.equal(screeningView.advisory, true);
    assert.equal(screeningView.executable, false);
    assert.deepEqual(
      await okGet(`/bff/address-screening/${screeningView.id}`, devVerified.cookie),
      screeningView
    );
    assert.deepEqual(await okGet("/bff/address-screening", devVerified.cookie), {
      mode: "test",
      screenings: [screeningView]
    });

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
    assert.equal(supportRequest.status, "received");
    assert.deepEqual(
      await okGet(`/bff/support/requests/${supportRequest.id}`, devVerified.cookie),
      supportRequest
    );
    // The list stays upstream-owned: the local desk row never merges in.
    assert.deepEqual(
      await okGet("/bff/support/requests", devVerified.cookie),
      await expectedSupportList(devUpstreamSubject)
    );
    const upstreamTicket = (await expectedSupportList(devUpstreamSubject)).requests[0].id;
    await deniedGet(`/bff/support/requests/${upstreamTicket}`, devVerified.cookie, 404, "not_found");

    // The checks member read resolves the served (gated) collection: the
    // fixture reference returns the same row the list serves — identical
    // on every stable field, with the clock-derived timestamps following
    // the same offsets (the fixture recomputes them per call).
    const checks = await okGet("/bff/checks", devVerified.cookie);
    const checkRow = checks.checks[0];
    const checkMember = await okGet(`/bff/checks/${checkReference}`, devVerified.cookie);
    const stable = ({ createdAt, expiresAt, timeline, ...rest }) => rest;
    assert.deepEqual(stable(checkMember), stable(checkRow));
    assert.equal(checkMember.timeline.length, checkRow.timeline.length);
    assert.equal(
      checkMember.expiresAt - checkMember.createdAt,
      checkRow.expiresAt - checkRow.createdAt
    );
    assert.equal(checkMember.timeline[0].at, checkMember.createdAt);

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
      "/bff/support/requests/sup_000000000000000000000000",
      `/bff/support/requests/${upstreamTicket}`
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
    assert.equal(typeof preview.ttlSeconds, "number");
    const gatedPreview = await okGet(
      "/bff/quotes/preview?from=RUB&to=USDT&amount=5000",
      devGated.cookie
    );
    assert.equal(gatedPreview.kycRequired, true);
    assert.equal(gatedPreview.executable, false);
    // A verified session can never re-apply for KYC.
    const reapply = await postMiniapp("/bff/kyc/applications", {}, { cookie: devVerified.cookie });
    assert.equal(reapply.status, 409);
    assert.deepEqual(await readJson(reapply), { error: "kyc_already_verified" });
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
    // Upstream the same tampering fails the route match outright.
    for (const path of [
      "/api/v1/customer/session?bogus=1",
      "/api/v1/customer/operations?bogus=1",
      "/api/v1/customer/operations/ope_000000000000000000000000?bogus=1",
      "/api/v1/customer/notifications?bogus=1"
    ]) {
      assert.equal(await upstreamDenied(path), 404, path);
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
    assert.deepEqual(
      await okGet("/bff/kyc/status", telegram.cookie),
      await expectedKycView(telegramUpstreamSubject)
    );
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
    assert.equal(tgNotifications.unread, 1);
    assert.equal(tgNotifications.notifications.length, 1);
    assert.equal(tgNotifications.notifications[0].template, "session_login");
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
    assert.deepEqual(
      await okGet("/bff/support/requests", devVerified.cookie),
      await expectedSupportList(devUpstreamSubject)
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
      [screeningView.id, outageScreeningView.id].sort()
    );
    assert.deepEqual(
      await okGet(`/bff/address-screening/${outageScreeningView.id}`, devVerified.cookie),
      outageScreeningView
    );
  });
});
