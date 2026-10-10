import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";
import { createSyntheticAuthSessionDirectory } from "../../customer-api/src/auth-sessions.mjs";
import { createSyntheticCheckDirectory, validChecksView } from "../../customer-api/src/checks.mjs";
import { createSyntheticKycApplicationDirectory } from "../../customer-api/src/kyc.mjs";
import { createSyntheticProfileDirectory } from "../../customer-api/src/profile.mjs";
import { createSyntheticSupportDirectory } from "../../customer-api/src/support.mjs";
import { createSyntheticUserDirectory } from "../../customer-api/src/users.mjs";
import { loadServerConfig } from "../../../miniapp/.server-dist/server/config.js";
import { customerApiSubject } from "../../../miniapp/.server-dist/server/customer-api-client.js";
import { signInitData } from "../../../miniapp/.server-dist/server/init-data.js";
import { createMiniappServer } from "../../../miniapp/.server-dist/server/server.js";
import {
  backofficeEntry,
  customerApiEntry,
  freePort,
  readJson,
  startService,
  stopService,
  verifyEnvelope
} from "./stack.mjs";

// Cross-service smoke test of the synthetic dev stack: customer-api
// (subprocess, synthetic HMAC auth), the Mini App BFF (inside the test runner,
// wired to that customer-api and to the deterministic provider simulators) and the
// backoffice BFF (subprocess, dev mode). Keys and ports are fresh per run.

const miniappOrigin = "http://127.0.0.1:4183";
const backofficeOrigin = "http://127.0.0.1:5174";
const devTokenKey = randomBytes(32).toString("hex");
const botToken = `${randomInt(100_000, 999_999_999)}:${randomBytes(30).toString("base64url")}`;
// Public synthetic TRON testnet address already used by the Mini App fixtures.
const tronTestnet = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
const screeningBody = { asset: "USDT", network: "TRON_TESTNET", address: tronTestnet };
const screeningKeys = [
  "advisory",
  "asset",
  "deadline",
  "executable",
  "id",
  "mode",
  "network",
  "status",
  "submittedAt"
];
const quoteKeys = [
  "amountIn",
  "amountOut",
  "executable",
  "executionUnavailableReason",
  "expiresAt",
  "fee",
  "feeAsset",
  "feeBps",
  "from",
  "id",
  "insufficientBalance",
  "issuedAt",
  "kycRequired",
  "netIn",
  "rate",
  "serverTime",
  "spreadBps",
  "to",
  "total",
  "ttlSeconds"
];
const moneyRoutes = [
  "/bff/orders",
  "/bff/withdrawals",
  "/bff/deposits",
  "/bff/payouts",
  "/bff/settlements",
  "/bff/ledger/entries",
  "/bff/custody/sign",
  "/bff/transactions/broadcast",
  "/bff/kyt/callbacks",
  "/bff/address-screening/callbacks"
];

let now = Date.now();
let customerApi;
let customerApiBase;
let miniapp;
let miniappBase;
let backoffice;
let backofficeBase;

function cookieOf(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "session cookie expected");
  return cookie.split(";")[0];
}

function postMiniapp(path, body, headers = {}) {
  return fetch(`${miniappBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: miniappOrigin, ...headers },
    body: JSON.stringify(body)
  });
}

async function getMiniapp(path, cookie, headers = {}) {
  const response = await fetch(`${miniappBase}${path}`, { headers: { cookie, ...headers } });
  assert.equal(response.status, 200, path);
  return readJson(response);
}

function customerApiHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    "x-request-id": generateUuidV7(),
    "x-client-version": "e2e-dev-smoke",
    "x-platform": "web",
    ...extra
  };
}

function postBackoffice(path, body, cookie) {
  return fetch(`${backofficeBase}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: backofficeOrigin,
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

async function operatorSession(role) {
  const response = await postBackoffice("/bff/auth/dev-session", { role });
  assert.equal(response.status, 200, role);
  const cookie = cookieOf(response);
  const envelope = await readJson(response);
  assert.equal(envelope.resource, "auth/dev-session");
  assert.equal(envelope.payload.authenticated, true);
  assert.equal(await verified(envelope), true);
  return cookie;
}

async function signingKeys() {
  const response = await fetch(`${backofficeBase}/bff/api/signing-keys`);
  assert.equal(response.status, 200);
  const keyset = await readJson(response);
  assert.equal(keyset.formatVersion, 1);
  assert.equal(keyset.backend, "ephemeral-dev");
  return keyset;
}

async function verified(envelope) {
  return verifyEnvelope(envelope, await signingKeys());
}

async function signedGet(path, cookie, resource) {
  const response = await fetch(`${backofficeBase}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, path);
  const envelope = await readJson(response);
  assert.equal(envelope.resource, resource);
  assert.equal(await verified(envelope), true, `${path} signature`);
  return envelope.payload;
}

async function deniedGet(path, cookie) {
  const response = await fetch(`${backofficeBase}${path}`, { headers: { cookie } });
  assert.equal(response.status, 403, path);
  assert.deepEqual(await readJson(response), { error: "capability_denied" });
}

function assertProviderEvidence(evidence) {
  assert.equal(evidence.source, "provider-simulator");
  assert.equal(evidence.evidence_only, true);
  assert.equal(evidence.environment, "dev-simulator");
  assert.equal(evidence.decisionAuthority, "none");
  assert.equal(evidence.decisionPath, "maker-checker-approval");
  assert.ok(Array.isArray(evidence.cases) && evidence.cases.length > 0);
}

before(async () => {
  customerApi = await startService(
    customerApiEntry,
    {
      CUSTOMER_API_HOST: "127.0.0.1",
      CUSTOMER_API_PORT: "0",
      CUSTOMER_API_DEV_AUTH: "synthetic",
      CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
    },
    /listening on http:\/\/127\.0\.0\.1:(\d+) auth=synthetic/
  );
  customerApiBase = `http://127.0.0.1:${customerApi.match[1]}`;

  const config = loadServerConfig({
    MINIAPP_ALLOW_DEV_LOGIN: "true",
    MINIAPP_ALLOWED_ORIGINS: miniappOrigin,
    MINIAPP_TELEGRAM_BOT_TOKEN: botToken,
    MINIAPP_QUOTE_SOURCE: "provider-simulator",
    MINIAPP_KYC_SCENARIO: "approve",
    MINIAPP_KYT_SCENARIO: "medium",
    MINIAPP_CUSTOMER_API_URL: customerApiBase,
    MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey
  });
  miniapp = createMiniappServer(config, { clock: () => now });
  await new Promise((resolve) => miniapp.listen(0, "127.0.0.1", resolve));
  miniappBase = `http://127.0.0.1:${miniapp.address().port}`;

  const backofficePort = await freePort();
  backoffice = await startService(
    backofficeEntry,
    {
      BACKOFFICE_BFF_HOST: "127.0.0.1",
      BACKOFFICE_BFF_PORT: String(backofficePort),
      BACKOFFICE_ALLOWED_ORIGINS: backofficeOrigin,
      BACKOFFICE_ALLOW_DEV_LOGIN: "true"
    },
    /Backoffice BFF listening on http:\/\/127\.0\.0\.1:(\d+)/
  );
  backofficeBase = `http://127.0.0.1:${backoffice.match[1]}`;
});

after(async () => {
  if (miniapp) await new Promise((resolve) => miniapp.close(() => resolve()));
  await Promise.all([stopService(customerApi), stopService(backoffice)]);
});

describe("customer journey through the Mini App BFF", () => {
  let cookie;
  let loginAndKyc;

  it("starts a dev session that is kyc-gated with wallet and quotes gated", async () => {
    const login = await postMiniapp("/bff/auth/dev-session", { kyc: "kyc-gated" });
    assert.equal(login.status, 201);
    cookie = cookieOf(login);
    const session = await readJson(login);
    assert.equal(session.source, "dev-synthetic");
    assert.equal(session.kyc, "kyc-gated");

    const wallet = await getMiniapp("/bff/wallet", cookie);
    assert.equal(wallet.kyc, "kyc-gated");
    const quote = await getMiniapp("/bff/quotes/preview?from=RUB&to=USDT&amount=5000", cookie);
    assert.deepEqual(Object.keys(quote).sort(), quoteKeys);
    assert.equal(quote.kycRequired, true);
    assert.equal(quote.executable, false);
    assert.equal(quote.executionUnavailableReason, "dev_test_version");
    const screening = await postMiniapp("/bff/address-screening", screeningBody, { cookie });
    assert.equal(screening.status, 403);
    assert.deepEqual(await readJson(screening), { error: "kyc_required" });
  });

  it("submits KYC and reaches verified via signed simulator callbacks", async () => {
    const submitted = await postMiniapp("/bff/kyc/applications", {}, { cookie });
    assert.equal(submitted.status, 202);
    const application = await readJson(submitted);
    assert.equal(application.mode, "test");
    assert.equal(application.provider, "simulator");
    assert.equal(application.state, "submitted");
    assert.equal(application.sessionKyc, "kyc-gated");
    assert.equal(application.canSubmit, false);
    assert.equal((await getMiniapp("/bff/session", cookie)).kyc, "kyc-gated");

    // The local simulator journey still promotes the session flag — every
    // authed request drains pending callbacks, so poll /bff/session until it
    // reports verified (advance the clock between polls).
    const seen = [];
    for (let step = 0; step < 120 && seen.at(-1) !== "verified"; step += 1) {
      now += 10_000;
      const session = await getMiniapp("/bff/session", cookie);
      if (seen.at(-1) !== session.kyc) seen.push(session.kyc);
    }
    assert.deepEqual(seen, ["kyc-gated", "verified"], seen.join(" -> "));
    // /bff/kyc/status answers through the customer-api contract for gated and
    // verified sessions alike (customer.kyc.read is never denied upstream).
    // The upstream's synthetic directory marks every subject unverified, so the
    // adapted view reports that deterministic application status with
    // sessionKyc "kyc-gated" — the upstream verdict — even though the local
    // session flag just promoted to verified.
    const devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const upstreamView = await createSyntheticKycApplicationDirectory().viewFor(
      customerApiSubject(devSubject),
      "unverified"
    );
    assert.equal(upstreamView.session_kyc, "unverified");
    const statusView = await getMiniapp("/bff/kyc/status", cookie);
    // The upstream directory is deterministic for this subject: its "rejected"
    // application always carries submitted_at and never a review_deadline, so
    // the adapted key set is pinned exactly — an upstream view that drops
    // submitted_at or adds an unexpected field must fail here.
    assert.deepEqual(Object.keys(statusView).sort(), [
      "canSubmit", "mode", "provider", "sessionKyc", "state", "submittedAt"
    ]);
    assert.equal(statusView.mode, "test");
    assert.equal(statusView.provider, "simulator");
    assert.equal(statusView.sessionKyc, "kyc-gated");
    assert.equal(statusView.state, upstreamView.status);
    assert.equal(statusView.canSubmit, upstreamView.can_submit);
    // The BFF session is verified, but the customer-api's own synthetic KYC
    // directory marks every subject unverified, so customer.wallets.read is
    // refused upstream and the wallet surface degrades to its gated form.
    const wallet = await getMiniapp("/bff/wallet", cookie);
    assert.equal(wallet.kyc, "kyc-gated");
    assert.equal(wallet.availableRub, "0.00");
    assert.equal(wallet.holdRub, "0.00");
    // customer.deposits.read is KYC-gated upstream like customer.wallets.read:
    // refused for every subject, so /bff/deposits degrades in place to the
    // same emptied view a gated session sees.
    const deposits = await getMiniapp("/bff/deposits", cookie);
    assert.equal(deposits.mode, "test");
    assert.equal(deposits.kyc, "kyc-gated");
    assert.equal(deposits.deposits.length, 0);
    // customer.withdrawals.read carries the same upstream KYC gate, so
    // /bff/withdrawals degrades in place to the emptied gated list too.
    const withdrawals = await getMiniapp("/bff/withdrawals", cookie);
    assert.equal(withdrawals.mode, "test");
    assert.equal(withdrawals.kyc, "kyc-gated");
    assert.equal(withdrawals.withdrawals.length, 0);
    // customer.quotes.read carries the same upstream KYC gate, so /bff/quotes
    // degrades in place to the emptied gated list too.
    const quotes = await getMiniapp("/bff/quotes", cookie);
    assert.equal(quotes.mode, "test");
    assert.equal(quotes.kyc, "kyc-gated");
    assert.equal(quotes.quotes.length, 0);
    // customer.exchange-orders.read carries the same upstream KYC gate, so
    // /bff/exchange-orders degrades in place to the emptied gated list too.
    const orders = await getMiniapp("/bff/exchange-orders", cookie);
    assert.equal(orders.mode, "test");
    assert.equal(orders.kyc, "kyc-gated");
    assert.equal(orders.orders.length, 0);
    // customer.payments.read carries the same upstream KYC gate, so
    // /bff/payments degrades in place to the emptied gated list too.
    const payments = await getMiniapp("/bff/payments", cookie);
    assert.equal(payments.mode, "test");
    assert.equal(payments.kyc, "kyc-gated");
    assert.equal(payments.payments.length, 0);
    // customer.cards.read carries the same upstream KYC gate, so /bff/cards
    // degrades in place to the emptied gated list too.
    const cards = await getMiniapp("/bff/cards", cookie);
    assert.equal(cards.mode, "test");
    assert.equal(cards.kyc, "kyc-gated");
    assert.equal(cards.cards.length, 0);
    // customer.checks.read carries the same upstream KYC gate, so
    // /bff/checks degrades in place to the local check book's gated list —
    // the fixture entries with the KYC-adjusted statuses, never upstream
    // data.
    const checks = await getMiniapp("/bff/checks", cookie);
    assert.equal(checks.mode, "test");
    assert.deepEqual(Object.keys(checks).sort(), ["checks", "mode"]);
    assert.equal(checks.checks.length, 5);
    for (const check of checks.checks) {
      assert.match(check.reference, /^chk_[0-9a-f]{24}$/);
      assert.equal(check.mode, "test");
      assert.equal(check.claimRule, "personal");
      assert.equal(check.executable, false);
      assert.equal(check.executionUnavailableReason, "dev_test_version");
    }
    // customer.notifications.read is refused upstream too, so the
    // notifications feed degrades in place to the local outbox drafts this
    // session's KYC journey recorded (newest first: kyc_approved).
    const feed = await getMiniapp("/bff/notifications", cookie);
    assert.equal(feed.mode, "test");
    assert.equal(feed.delivery, "disabled");
    assert.equal(feed.notifications.length >= 1, true);
    assert.equal(feed.notifications[0].template, "kyc_approved");
    assert.equal(feed.unread, feed.notifications.filter((draft) => !draft.read).length);
    for (const draft of feed.notifications) {
      assert.match(draft.id, /^ntf_[0-9a-f]{24}$/);
      assert.equal(draft.channel, "telegram-draft");
      assert.equal(draft.mode, "test");
      assert.equal(draft.delivered, false);
    }
  });

  it("serves the profile through customer-api synthetic auth", async () => {
    // /bff/profile consults the customer-api contract for every session
    // (customer.profile.read is never denied upstream): the synthetic
    // directory's display_name and customer_ref overlay the app view, while
    // locale and registered_at have no app counterpart and are dropped.
    const devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const upstreamView = await createSyntheticProfileDirectory().viewFor(customerApiSubject(devSubject));
    const profile = await getMiniapp("/bff/profile", cookie);
    assert.deepEqual(Object.keys(profile).sort(), [
      "apiAccess", "customerRef", "displayName", "fees", "kyc", "limits", "security"
    ]);
    assert.equal(profile.displayName, upstreamView.display_name);
    assert.equal(profile.customerRef, upstreamView.customer_ref);
    assert.equal(profile.kyc.state, "verified");
    assert.equal(profile.apiAccess.status, "connected");
    // The upstream's synthetic KYC directory reports every subject
    // "unverified", so the granted set is exactly the seven never-denied reads
    // in CAPABILITY_POLICY order — a customer-api that over-granted
    // KYC-gated or financial capabilities here must fail this pin.
    assert.deepEqual(profile.apiAccess.granted, [
      "customer.session.read",
      "customer.capabilities.read",
      "customer.kyc.read",
      "customer.profile.read",
      "customer.support.read",
      "customer.auth.read",
      "customer.users.read"
    ]);
    assert.equal(profile.apiAccess.commandsEnabled, false);
  });

  it("serves the support request list through customer-api synthetic auth", async () => {
    // /bff/support/requests consults the customer-api contract for every
    // session (customer.support.read is never denied upstream): the synthetic
    // directory's tickets adapt onto the app's request shape — tck_* ids,
    // camelCase fields, ISO times parsed to milliseconds.
    const devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const upstreamView = await createSyntheticSupportDirectory().listFor(customerApiSubject(devSubject));
    const requests = await getMiniapp("/bff/support/requests", cookie);
    assert.deepEqual(Object.keys(requests).sort(), ["delivery", "mode", "requests"]);
    assert.equal(requests.mode, "test");
    assert.equal(requests.delivery, "disabled");
    assert.deepEqual(
      requests.requests,
      upstreamView.tickets.map((ticket) => ({
        id: ticket.ticket_id,
        mode: "test",
        delivery: "disabled",
        category: ticket.category,
        topic: ticket.topic,
        message: ticket.message,
        status: ticket.status,
        timeline: ticket.timeline.map((entry) => ({ status: entry.status, at: Date.parse(entry.at) })),
        complaintAcknowledged: ticket.complaint_acknowledged,
        createdAt: Date.parse(ticket.created_at),
        expiresAt: Date.parse(ticket.expires_at)
      }))
    );
  });

  it("serves the device session list through customer-api synthetic auth", async () => {
    // /bff/sessions consults the customer-api contract for every session
    // (customer.auth.read is never denied upstream): the synthetic
    // directory's active sessions adapt onto the app's device list — sess_*
    // handles, telegram/dev-login clients, millisecond timestamps — while
    // ended lifecycle states drop out of the surface.
    const devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const upstreamView = await createSyntheticAuthSessionDirectory().listFor(customerApiSubject(devSubject));
    const view = await getMiniapp("/bff/sessions", cookie);
    assert.deepEqual(Object.keys(view).sort(), ["mode", "sessions"]);
    assert.equal(view.mode, "test");
    const expected = upstreamView.sessions
      .filter((session) => session.state === "active")
      .map((session) => ({
        handle: session.session_id,
        client: session.platform === "telegram-mini-app" ? "telegram" : "dev-login",
        createdAt: Date.parse(session.created_at),
        lastSeenAt: Date.parse(session.last_seen_at),
        current: session.current
      }))
      .sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt || b.createdAt - a.createdAt
      );
    assert.deepEqual(view.sessions, expected);
    assert.equal(view.sessions.filter((entry) => entry.current).length, 1);
  });

  it("serves the account record through customer-api synthetic auth", async () => {
    // /bff/account consults the customer-api contract for every session
    // (customer.users.read is never denied upstream): the synthetic
    // directory's account record adapts onto the app's account view — usr_*
    // handle, syn_cust_* subject linkage, lifecycle status and the three
    // consent flags — with the snake_case contract fields mapped to the
    // app's camelCase shape.
    const devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const upstreamView = await createSyntheticUserDirectory().viewFor(customerApiSubject(devSubject));
    const view = await getMiniapp("/bff/account", cookie);
    assert.deepEqual(Object.keys(view).sort(), [
      "createdAt",
      "flags",
      "id",
      "mode",
      "status",
      "subject",
      "updatedAt"
    ]);
    assert.deepEqual(view, {
      mode: "test",
      id: upstreamView.user_id,
      subject: upstreamView.subject,
      status: upstreamView.status,
      flags: {
        termsAccepted: upstreamView.flags.terms_accepted,
        twoFactorEnabled: upstreamView.flags.two_factor_enabled,
        marketingOptIn: upstreamView.flags.marketing_opt_in
      },
      createdAt: Date.parse(upstreamView.created_at),
      updatedAt: Date.parse(upstreamView.updated_at)
    });
  });

  it("keeps the checks surface on the local book while customer.checks.read is denied upstream", async () => {
    // customer.checks.read is KYC-gated and the upstream KYC directory marks
    // every subject unverified, so the verified dev session's upstream read
    // is refused: /bff/checks degrades in place to the local check book's
    // gated list. The upstream directory still answers a deterministic,
    // contract-valid view for the same subject — nothing here leaks into
    // the app surface.
    const devSubject = `dev-${createHash("sha256").update("solidchange-miniapp-dev-synthetic|900000001").digest("hex").slice(0, 16)}`;
    const upstreamView = await createSyntheticCheckDirectory().viewFor(customerApiSubject(devSubject));
    assert.equal(validChecksView(upstreamView), true);
    assert.ok(upstreamView.checks.length >= 1);
    assert.deepEqual(upstreamView, await createSyntheticCheckDirectory().viewFor(customerApiSubject(devSubject)));
    const view = await getMiniapp("/bff/checks", cookie);
    assert.equal(view.mode, "test");
    assert.equal(view.checks.length, 5);
    const upstreamIds = new Set(upstreamView.checks.map((check) => check.check_id));
    for (const check of view.checks) {
      assert.equal(upstreamIds.has(check.reference), false);
    }
  });

  it("screens a testnet address through signed KYT simulator callbacks as advisory only", async () => {
    const submitted = await postMiniapp("/bff/address-screening", screeningBody, { cookie });
    assert.equal(submitted.status, 202);
    const text = await submitted.text();
    assert.equal(text.includes(tronTestnet), false);
    const created = JSON.parse(text);
    assert.deepEqual(Object.keys(created).sort(), screeningKeys);
    assert.deepEqual(
      [created.mode, created.asset, created.network, created.status, created.advisory, created.executable],
      ["test", "USDT", "TRON_TESTNET", "pending", true, false]
    );

    let view = created;
    for (let step = 0; step < 200 && view.status === "pending"; step += 1) {
      now += 5_000;
      view = await getMiniapp(`/bff/address-screening/${created.id}`, cookie);
    }
    assert.equal(view.status, "medium");
    assert.equal(view.id, created.id);
    assert.equal(view.advisory, true);
    assert.equal(view.executable, false);

    const repeat = await postMiniapp("/bff/address-screening", screeningBody, { cookie });
    assert.equal(repeat.status, 200);
    assert.equal((await readJson(repeat)).id, created.id);
    const device = await fetch(`${miniappBase}/bff/address-screening/${created.id}`, {
      headers: { cookie, "x-device-id": "synthetic-device" }
    });
    assert.equal(device.status, 400);
  });

  it("previews buy and sell quotes that are never executable", async () => {
    // RUB -> USDT is routed to the simulator's buy side with quote_amount as the budget.
    const buy = await getMiniapp("/bff/quotes/preview?from=RUB&to=USDT&amount=5000", cookie);
    const sell = await getMiniapp("/bff/quotes/preview?from=USDT&to=RUB&amount=50", cookie);
    for (const quote of [buy, sell]) {
      assert.deepEqual(Object.keys(quote).sort(), quoteKeys);
      assert.equal(quote.kycRequired, false);
      assert.equal(quote.executable, false);
      assert.equal(quote.executionUnavailableReason, "dev_test_version");
    }
    assert.deepEqual([buy.from, buy.to], ["RUB", "USDT"]);
    assert.ok(Number(buy.amountIn) > 0 && Number(buy.amountIn) <= 5000, buy.amountIn);
    assert.ok(Number(buy.amountOut) > 0, buy.amountOut);
    assert.deepEqual([sell.from, sell.to, sell.amountIn], ["USDT", "RUB", "50.000000"]);
    assert.ok(Number(sell.amountOut) > 0, sell.amountOut);
  });

  it("lists login and KYC drafts and marks them read for the owner only", async () => {
    const view = await getMiniapp("/bff/notifications", cookie);
    const templates = view.notifications.map((entry) => entry.template);
    for (const template of ["session_login", "kyc_submitted", "kyc_approved"]) {
      assert.ok(templates.includes(template), `${template} in ${templates.join(",")}`);
    }
    assert.equal(view.mode, "test");
    assert.equal(view.delivery, "disabled");
    assert.equal(view.unread, view.notifications.length);
    for (const entry of view.notifications) {
      assert.equal(entry.channel, "telegram-draft");
      assert.equal(entry.mode, "test");
      assert.equal(entry.delivered, false);
      assert.equal(entry.read, false);
    }
    loginAndKyc = view.notifications.map((entry) => entry.id);

    const authDate = String(Math.floor(now / 1_000));
    const initData = signInitData(
      new Map([
        ["auth_date", authDate],
        ["user", JSON.stringify({ id: randomInt(1_000_000, 9_000_000), first_name: "Synthetic" })]
      ]),
      botToken
    );
    const foreignLogin = await postMiniapp("/bff/session/telegram", { initData });
    assert.equal(foreignLogin.status, 201);
    const foreign = cookieOf(foreignLogin);
    const foreignScreening = await fetch(`${miniappBase}/bff/address-screening/scr_${"0".repeat(32)}`, {
      headers: { cookie: foreign }
    });
    assert.equal(foreignScreening.status, 403);
    const foreignView = await getMiniapp("/bff/notifications", foreign);
    assert.deepEqual(
      foreignView.notifications.map((entry) => entry.template),
      ["session_login"]
    );
    for (const id of loginAndKyc) {
      assert.equal(foreignView.notifications.some((entry) => entry.id === id), false);
    }
    const foreignRead = await postMiniapp("/bff/notifications/read", { ids: loginAndKyc.join(",") }, { cookie: foreign });
    assert.equal(foreignRead.status, 200);
    assert.deepEqual(await readJson(foreignRead), { marked: 0, unread: 1 });
    const stillUnread = await getMiniapp("/bff/notifications", cookie);
    assert.equal(stillUnread.notifications.every((entry) => entry.read === false), true);

    const read = await postMiniapp("/bff/notifications/read", { ids: loginAndKyc.join(",") }, { cookie });
    assert.equal(read.status, 200);
    assert.deepEqual(await readJson(read), { marked: loginAndKyc.length, unread: 0 });
    const after = await getMiniapp("/bff/notifications", cookie);
    assert.equal(after.unread, 0);
    assert.equal(after.notifications.every((entry) => entry.read === true), true);
  });

  it("exposes no money-moving routes to customers", async () => {
    for (const path of moneyRoutes) {
      const response = await postMiniapp(path, {}, { cookie });
      assert.equal(response.status, 404, path);
    }
  });
});

describe("customer negative paths", () => {
  const subject = `syn_cust_${randomBytes(6).toString("hex")}`;
  let cookie;

  before(async () => {
    const login = await postMiniapp("/bff/auth/dev-session", { kyc: "verified" });
    assert.equal(login.status, 201);
    cookie = cookieOf(login);
  });

  it("rejects POST without Origin with 403", async () => {
    for (const path of [
      "/bff/session/telegram",
      "/bff/kyc/applications",
      "/bff/notifications/read",
      "/bff/address-screening",
      "/bff/auth/logout",
      "/bff/sessions/revoke",
      "/bff/sessions/revoke-others"
    ]) {
      const response = await fetch(`${miniappBase}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: "{}"
      });
      assert.equal(response.status, 403, path);
      assert.deepEqual(await readJson(response), { error: "origin_rejected" });
    }
    const hiddenDevLogin = await fetch(`${miniappBase}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(hiddenDevLogin.status, 404);
    assert.equal(hiddenDevLogin.headers.get("set-cookie"), null);
    assert.equal((await getMiniapp("/bff/session", cookie)).kyc, "verified");
  });

  it("rejects extra body keys with 400", async () => {
    const attempts = [
      ["/bff/kyc/applications", { status: "approved" }],
      ["/bff/notifications/read", { ids: "", all: true }],
      ["/bff/address-screening", { ...screeningBody, executable: true }],
      ["/bff/auth/dev-session", { kyc: "kyc-gated", subject: "other" }]
    ];
    for (const [path, body] of attempts) {
      const response = await postMiniapp(path, body, { cookie });
      assert.equal(response.status, 400, path);
      assert.equal((await readJson(response)).error, "invalid_request", path);
    }
    assert.equal((await getMiniapp("/bff/session", cookie)).kyc, "verified");
  });

  it("rejects X-Device-Id on customer routes", async () => {
    const deviceId = { "x-device-id": "synthetic-device" };
    const list = await fetch(`${miniappBase}/bff/notifications`, { headers: { cookie, ...deviceId } });
    assert.equal(list.status, 400);
    assert.deepEqual(await readJson(list), { error: "invalid_request" });
    const read = await postMiniapp("/bff/notifications/read", { ids: "" }, { cookie, ...deviceId });
    assert.equal(read.status, 400);
    assert.deepEqual(await readJson(read), { error: "invalid_request" });
    const screening = await postMiniapp("/bff/address-screening", screeningBody, { cookie, ...deviceId });
    assert.equal(screening.status, 400);
    assert.deepEqual(await readJson(screening), { error: "invalid_request" });

    // Every customer route rejects the operator header at the edge, so the
    // BFF never forwards it; customer-api refuses a direct call either way.
    const profile = await fetch(`${miniappBase}/bff/profile`, { headers: { cookie, ...deviceId } });
    assert.equal(profile.status, 400);
    assert.deepEqual(await readJson(profile), { error: "invalid_request" });

    const token = mintSyntheticCustomerToken({
      key: devTokenKey,
      subject: subject,
      expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
    });
    const direct = await fetch(`${customerApiBase}/api/v1/customer/session`, {
      headers: customerApiHeaders(token, deviceId)
    });
    assert.equal(direct.status, 400);
    assert.equal((await readJson(direct)).code, "VALIDATION_FAILED");
  });

  it("customer-api accepts a synthetic token and rejects a tampered one", async () => {
    const token = mintSyntheticCustomerToken({
      key: devTokenKey,
      subject: subject,
      expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
    });
    const accepted = await fetch(`${customerApiBase}/api/v1/customer/session`, {
      headers: customerApiHeaders(token)
    });
    assert.equal(accepted.status, 200);
    const session = await readJson(accepted);
    assert.equal(session.subject, subject);
    assert.equal(session.actor_type, "customer");

    const last = token.at(-1) === "A" ? "B" : "A";
    for (const tampered of [`${token.slice(0, -1)}${last}`, token.replace(".", ".x")]) {
      const rejected = await fetch(`${customerApiBase}/api/v1/customer/session`, {
        headers: customerApiHeaders(tampered)
      });
      assert.equal(rejected.status, 401);
      assert.equal(rejected.headers.get("www-authenticate"), "Bearer");
      assert.equal((await readJson(rejected)).code, "AUTHENTICATION_REQUIRED");
    }
    const foreignKey = mintSyntheticCustomerToken({
      key: randomBytes(32).toString("hex"),
      subject: subject,
      expiresAtSeconds: Math.floor(Date.now() / 1_000) + 300
    });
    const foreign = await fetch(`${customerApiBase}/api/v1/customer/session`, {
      headers: customerApiHeaders(foreignKey)
    });
    assert.equal(foreign.status, 401);
  });
});

describe("operator journey through the backoffice BFF", () => {
  let lead;
  let support;

  before(async () => {
    lead = await operatorSession("compliance-lead");
    support = await operatorSession("support-l1");
  });

  it("serves KYC and AML cases with evidence-only provider evidence", async () => {
    const kyc = await signedGet("/bff/api/kyc", lead, "kyc-cases");
    assert.ok(Array.isArray(kyc.cases) && kyc.cases.length > 0);
    assertProviderEvidence(kyc.providerEvidence);
    const aml = await signedGet("/bff/api/aml", lead, "aml-cases");
    assert.ok(Array.isArray(aml.cases) && aml.cases.length > 0);
    assertProviderEvidence(aml.providerEvidence);
  });

  it("rejects a signed envelope whose payload was altered", async () => {
    const response = await fetch(`${backofficeBase}/bff/api/kyc`, { headers: { cookie: lead } });
    const envelope = await readJson(response);
    assert.equal(await verified(envelope), true);
    const altered = { ...envelope, payload: { ...envelope.payload, cases: [] } };
    assert.equal(await verified(altered), false);
  });

  it("rejects envelopes when the matching key is not a live Ed25519 key", async () => {
    const response = await fetch(`${backofficeBase}/bff/api/kyc`, { headers: { cookie: lead } });
    const envelope = await readJson(response);
    const keyset = await signingKeys();
    assert.equal(verifyEnvelope(envelope, keyset), true);
    const withWrongAlgorithm = {
      ...keyset,
      keys: keyset.keys.map((key) =>
        key.keyId === envelope.keyId ? { ...key, algorithm: "ES256" } : key
      )
    };
    assert.equal(verifyEnvelope(envelope, withWrongAlgorithm), false);
    // A retired key must not attest envelopes issued after its retirement.
    const retiredBeforeIssue = {
      ...keyset,
      keys: keyset.keys.map((key) =>
        key.keyId === envelope.keyId
          ? { ...key, status: "retired", retiredAt: "2000-01-01T00:00:00.000Z" }
          : key
      )
    };
    assert.equal(verifyEnvelope(envelope, retiredBeforeIssue), false);
  });

  it("lists and fetches draft reports for compliance-lead and audits the access", async () => {
    const list = await signedGet("/bff/api/reports", lead, "reports");
    assert.equal(list.status, "draft");
    assert.equal(list.not_for_submission, true);
    assert.equal(list.environment, "dev-synthetic");
    for (const entry of list.reports) {
      assert.equal(entry.status, "draft");
      assert.equal(entry.not_for_submission, true);
    }
    const ids = list.reports.map((report) => report.id);
    assert.deepEqual(ids, ["kyc-queue-daily", "aml-kyt-alerts", "maker-checker-approvals"]);

    const before = await signedGet("/bff/api/audit", lead, "audit");
    for (const id of ids) {
      const report = await signedGet(`/bff/api/reports/${id}`, lead, `report:${id}`);
      assert.equal(report.id, id);
      assert.equal(report.status, "draft");
      assert.equal(report.not_for_submission, true);
      assert.equal(report.environment, "dev-synthetic");
      assert.equal(report.decisionAuthority, "none");
    }
    const after = await signedGet("/bff/api/audit", lead, "audit");
    assert.equal(after.events.length, before.events.length + ids.length);
    const appended = after.events.slice(-ids.length);
    assert.deepEqual(
      appended.map((event) => [event.actor, event.action, event.resource]),
      ids.map((id) => ["dev:compliance-lead", "report.viewed", `report:${id}`])
    );
    assert.equal(after.chain.verified, true);
    assert.equal(after.chain.length, before.chain.length + ids.length);
    assert.notEqual(after.chain.headHash, before.chain.headHash);
  });

  it("denies reports and provider evidence to support-l1", async () => {
    await deniedGet("/bff/api/reports", support);
    await deniedGet("/bff/api/reports/kyc-queue-daily", support);
    await deniedGet("/bff/api/kyc", support);
    await deniedGet("/bff/api/aml", support);
  });

  it("rejects cross-site report fetches before authorization", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const response = await fetch(`${backofficeBase}/bff/api/reports`, {
        headers: { cookie: lead, "sec-fetch-site": site }
      });
      assert.equal(response.status, 403, site);
      assert.deepEqual(await readJson(response), { error: "fetch_site_rejected" });
    }
    await signedGet("/bff/api/reports", lead, "reports");
  });

  it("exposes no POST money routes to operators", async () => {
    // Money routes that gained a read-only GET view keep rejecting POST, now
    // with the standard 405 Allow: GET of every registered read route.
    const readOnlyMoneyPaths = new Set(["/bff/api/withdrawals"]);
    for (const path of moneyRoutes.map((route) => route.replace("/bff/", "/bff/api/"))) {
      const response = await postBackoffice(path, {}, lead);
      if (readOnlyMoneyPaths.has(path)) {
        assert.equal(response.status, 405, path);
        assert.equal(response.headers.get("allow"), "GET", path);
      } else {
        assert.equal(response.status, 404, path);
        assert.deepEqual(await readJson(response), { error: "not_found" });
      }
    }
    const reportPost = await postBackoffice("/bff/api/reports", {}, lead);
    assert.equal(reportPost.status, 405);
    assert.equal(reportPost.headers.get("allow"), "GET");
  });
});
