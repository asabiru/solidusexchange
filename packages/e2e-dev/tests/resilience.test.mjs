import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { after, before, describe, it } from "node:test";
import { demoRepository } from "../../../backoffice/.server-dist/data/demo.js";
import { AuditUnavailableError, MemoryAuditStore } from "../../../backoffice/.server-dist/server/audit-store.js";
import { PostgresAuditStore } from "../../../backoffice/.server-dist/server/postgres-audit-store.js";
import { createBackofficeServer } from "../../../backoffice/.server-dist/server/server.js";
import { loadServerConfig } from "../../../miniapp/.server-dist/server/config.js";
import { createMiniappServer } from "../../../miniapp/.server-dist/server/server.js";
import {
  backofficeEntry,
  closeServer,
  cookieOf,
  customerApiEntry,
  freePort,
  listen,
  readJson,
  runToExit,
  startService
} from "./stack.mjs";

// Failure injection for the synthetic dev stack: customer-api outages and
// malformed upstream responses, provider-simulator failure scenarios and an
// unreachable PostgreSQL audit store. Every failure must surface as a documented
// fail-closed response, never as a 500, a hang or a leaked upstream body.

const miniappOrigin = "http://127.0.0.1:4183";
const backofficeOrigin = "http://127.0.0.1:5174";
const requestTimeoutMs = 10_000;
const marker = `syn-upstream-${randomBytes(6).toString("hex")}`;
// Public synthetic TRON testnet address already used by the Mini App fixtures.
const tronTestnet = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
const screeningBody = { asset: "USDT", network: "TRON_TESTNET", address: tronTestnet };
const quotePath = "/bff/quotes/preview?from=RUB&to=USDT&amount=5000";

function call(base, path, { method = "GET", cookie, body, origin = miniappOrigin } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "POST" ? { "content-type": "application/json", origin } : {})
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
}

async function startMiniapp(env = {}) {
  const clock = { now: Date.now() };
  const config = loadServerConfig({
    MINIAPP_ALLOW_DEV_LOGIN: "true",
    MINIAPP_ALLOWED_ORIGINS: miniappOrigin,
    MINIAPP_QUOTE_SOURCE: "provider-simulator",
    ...env
  });
  const server = createMiniappServer(config, { clock: () => clock.now });
  return { server, clock, base: await listen(server) };
}

async function devLogin(app, kyc) {
  const response = await call(app.base, "/bff/auth/dev-session", { method: "POST", body: { kyc } });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function getJson(app, path, cookie) {
  const response = await call(app.base, path, { cookie });
  assert.equal(response.status, 200, path);
  return readJson(response);
}

async function assertGated(app, cookie, label) {
  assert.equal((await getJson(app, "/bff/session", cookie)).kyc, "kyc-gated", label);
  const wallet = await getJson(app, "/bff/wallet", cookie);
  assert.equal(wallet.kyc, "kyc-gated", label);
  assert.equal(wallet.availableRub, "0.00", label);
  assert.deepEqual(await getJson(app, "/bff/operations", cookie), { operations: [] }, label);
  const quote = await getJson(app, quotePath, cookie);
  assert.equal(quote.kycRequired, true, label);
  assert.equal(quote.executable, false, label);
  const screening = await call(app.base, "/bff/address-screening", { method: "POST", cookie, body: screeningBody });
  assert.equal(screening.status, 403, label);
  assert.deepEqual(await readJson(screening), { error: "kyc_required" }, label);
  const deposits = await getJson(app, "/bff/deposits", cookie);
  assert.equal(deposits.kyc, "kyc-gated", label);
  assert.equal(deposits.deposits.length, 0, label);
  const withdrawals = await getJson(app, "/bff/withdrawals", cookie);
  assert.equal(withdrawals.kyc, "kyc-gated", label);
  assert.equal(withdrawals.withdrawals.length, 0, label);
}

async function advanceUntil(app, path, cookie, done, { stepMs, maxSteps }) {
  const seen = [];
  for (let step = 0; step <= maxSteps; step += 1) {
    const view = await getJson(app, path, cookie);
    if (seen.at(-1) !== view.state && view.state !== undefined) seen.push(view.state);
    if (view.status !== undefined && seen.at(-1) !== view.status) seen.push(view.status);
    if (done(view)) return { view, seen };
    app.clock.now += stepMs;
  }
  assert.fail(`${path} did not settle: ${seen.join(" -> ")}`);
}

describe("Mini App BFF with a failing customer-api", () => {
  const key = randomBytes(32).toString("hex");
  const timers = new Set();
  const upstream = [];
  let mode = "valid";
  let stub;
  let app;
  let cookie;
  let verifiedCookie;

  function subjectOf(request) {
    return (request.headers.authorization ?? "").split(".")[1] ?? "";
  }

  function validBody(request, extra = {}) {
    if (request.url.endsWith("/session")) {
      return { subject: subjectOf(request), actor_type: "customer", scopes: [], expires_at: "2026-10-06T00:00:00Z", ...extra };
    }
    if (request.url.endsWith("/wallets")) {
      return {
        wallets: [
          { wallet_id: "syn_wal_rub00001", asset: "RUB", available: "84200.00", hold: "0.00" },
          { wallet_id: "syn_wal_usdt0001", asset: "USDT", available: "10.000000", hold: "0.000000" }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/deposits")) {
      return {
        mode: "test",
        deposits: [
          {
            deposit_id: "dep_0123456789abcdef01234567",
            asset: "RUB",
            method: "sbp",
            status: "payment_received",
            expected_amount: "25000.00",
            received_total: "25000.00",
            reversed_total: "0.00",
            payment_reference: "SIMSBP0123456789AB",
            created_at: "2026-10-04T12:10:00.000Z",
            updated_at: "2026-10-04T12:14:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/withdrawals")) {
      return {
        mode: "test",
        withdrawals: [
          {
            withdrawal_id: "wdr_0123456789abcdef01234567",
            asset: "USDT",
            network: "TRON_TESTNET",
            status: "confirmed",
            amount: "25.000000",
            fee_amount: "0.125000",
            destination_reference: "destination_ref_0123456789abcd",
            legs: [
              { leg_id: "wdl_0123456789abcdef01234567", asset: "USDT", amount: "25.000000", direction: "out" },
              { leg_id: "wdl_fedcba9876543210fedcba98", asset: "USDT", amount: "0.125000", direction: "out" }
            ],
            created_at: "2026-10-02T14:05:00.000Z",
            updated_at: "2026-10-02T14:20:00.000Z",
            expires_at: "2026-10-02T14:10:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/notifications")) {
      return {
        mode: "test",
        delivery: "disabled",
        unread: 1,
        notifications: [
          {
            notification_id: "ntf_0123456789abcdef01234567",
            created_at: "2026-10-01T12:00:00.000Z",
            channel: "telegram-draft",
            template: "kyc_approved",
            locale: "ru",
            text: "Тестовый режим. Проверка личности пройдена.",
            mode: "test",
            delivered: false,
            read: false
          },
          {
            notification_id: "ntf_fedcba9876543210fedcba98",
            created_at: "2026-09-30T12:00:00.000Z",
            channel: "telegram-draft",
            template: "session_login",
            locale: "ru",
            text: "Тестовый режим. Выполнен вход в SOLID.",
            mode: "test",
            delivered: false,
            read: true
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/profile")) {
      return {
        mode: "test",
        customer_ref: "SC-DEV-UPST1",
        display_name: "Customer ab12cd34",
        locale: "ru",
        registered_at: "2026-09-01T12:00:00.000Z",
        ...extra
      };
    }
    if (request.url.endsWith("/support")) {
      return {
        mode: "test",
        delivery: "disabled",
        tickets: [
          {
            ticket_id: "tck_0123456789abcdef01234567",
            category: "complaint",
            topic: "Тестовый режим. Жалоба на обслуживание.",
            message: "Тестовый режим. Синтетическая жалоба, её никто не получит.",
            status: "in_review",
            timeline: [
              { status: "received", at: "2026-10-01T12:00:00.000Z" },
              { status: "in_review", at: "2026-10-01T13:00:00.000Z" }
            ],
            complaint_acknowledged: true,
            created_at: "2026-10-01T12:00:00.000Z",
            expires_at: "2026-10-02T12:00:00.000Z"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/kyc")) {
      return {
        mode: "test",
        provider: "simulator",
        session_kyc: "unverified",
        status: "rejected",
        application_id: "kyc_0123456789abcdef01234567",
        submitted_at: "2026-10-01T12:00:00.000Z",
        updated_at: "2026-10-02T12:00:00.000Z",
        reason_codes: ["SIM_DOCUMENT_UNREADABLE"],
        can_submit: true,
        ...extra
      };
    }
    return { capabilities: ["customer.session.read"], commands_enabled: false, ...extra };
  }

  function send(response, status, contentType, text) {
    if (contentType) response.setHeader("content-type", contentType);
    response.statusCode = status;
    response.end(text);
  }

  const modes = {
    valid: (request, response) => send(response, 200, "application/json", JSON.stringify(validBody(request))),
    server_error: (_, response) => send(response, 500, "application/json", JSON.stringify({ error: marker })),
    unauthorized: (_, response) => send(response, 401, "application/json", JSON.stringify({ code: marker })),
    redirect: (_, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${stub.address().port}/${marker}` });
      response.end(marker);
    },
    invalid_json: (_, response) => send(response, 200, "application/json", `{"subject":"${marker}"`),
    wrong_content_type: (request, response) => send(response, 200, "text/html", JSON.stringify(validBody(request))),
    missing_content_type: (request, response) => send(response, 200, undefined, JSON.stringify(validBody(request))),
    oversized_declared: (request, response) =>
      send(response, 200, "application/json", JSON.stringify(validBody(request)) + " ".repeat(65_536)),
    oversized_chunked: (request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write(JSON.stringify(validBody(request)));
      for (let chunk = 0; chunk < 64; chunk += 1) response.write(" ".repeat(1_024));
      response.end();
    },
    wrong_shape: (_, response) => send(response, 200, "application/json", JSON.stringify([marker])),
    extra_fields: (request, response) =>
      send(response, 200, "application/json", JSON.stringify(validBody(request, { kyc: "verified", note: marker }))),
    subject_mismatch: (request, response) =>
      send(response, 200, "application/json", JSON.stringify({ ...validBody(request), subject: "syn_cust_00000000" })),
    commands_enabled: (request, response) =>
      send(response, 200, "application/json", JSON.stringify({ ...validBody(request), commands_enabled: true })),
    capability_denied: (_, response) =>
      send(response, 403, "application/json", JSON.stringify({ code: "CAPABILITY_DENIED", detail: marker })),
    connection_reset: (request) => request.socket.destroy(),
    slow_headers: (request, response) => {
      const timer = setTimeout(() => modes.valid(request, response), 3_000);
      timers.add(timer);
    },
    stalled_body: (_, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write(`{"subject":"${marker}"`);
    },
    invalid_utf8: (request, response) =>
      send(response, 200, "application/json", Buffer.concat([Buffer.from([0xff]), Buffer.from(JSON.stringify(validBody(request)), "latin1")]))
  };

  async function upstreamReleased(label) {
    const last = upstream.at(-1);
    for (let attempt = 0; attempt < 100 && !last.closed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(last.closed, true, `${label}: upstream response still open`);
  }

  async function walletFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/wallet", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "wallet_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function depositsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/deposits", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("dep_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "deposits_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function withdrawalsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/withdrawals", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("wdr_"), false, label);
    assert.equal(text.includes("wdl_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "withdrawals_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function notificationsFailClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/notifications", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("ntf_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "notifications_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function kycFailsClosed(label, sessionCookie) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/kyc/status", { cookie: sessionCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(/kyc_[0-9a-f]{24}/.test(text), false, label);
    assert.deepEqual(JSON.parse(text), { error: "kyc_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function profileFailsClosed(label, sessionCookie) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/profile", { cookie: sessionCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("SC-DEV"), false, label);
    assert.equal(text.includes("display_name"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "profile_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function supportFailsClosed(label, sessionCookie) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/support/requests", { cookie: sessionCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("tck_"), false, label);
    assert.equal(text.includes("ticket_id"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "support_unavailable" }, label);
    assert.ok(elapsed < 5_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  before(async () => {
    stub = createServer((request, response) => {
      const entry = { mode, closed: false };
      response.once("close", () => {
        entry.closed = true;
      });
      upstream.push(entry);
      modes[mode](request, response);
    });
    const stubBase = await listen(stub);
    app = await startMiniapp({ MINIAPP_CUSTOMER_API_URL: stubBase, MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key });
    cookie = await devLogin(app, "kyc-gated");
    verifiedCookie = await devLogin(app, "verified");
  });

  after(async () => {
    for (const timer of timers) clearTimeout(timer);
    await closeServer(app.server);
    await closeServer(stub);
  });

  it("connects through the stub when upstream answers correctly", async () => {
    mode = "valid";
    const profile = await getJson(app, "/bff/profile", cookie);
    assert.deepEqual(profile.apiAccess, {
      status: "connected",
      granted: ["customer.session.read"],
      commandsEnabled: false
    });
    // The profile surface consults upstream for gated sessions too (the read
    // is never KYC-gated): the stub's contract identity fields overlay the
    // local view while the app keeps its own sections and apiAccess block.
    assert.equal(profile.displayName, "Customer ab12cd34");
    assert.equal(profile.customerRef, "SC-DEV-UPST1");
    assert.equal(profile.kyc.state, "kyc-gated");
    assert.equal("locale" in profile, false);
    assert.equal("registeredAt" in profile, false);
    // A verified session reads the same upstream identity fields; only the
    // app-local kyc section follows its own session flag.
    const verifiedProfile = await getJson(app, "/bff/profile", verifiedCookie);
    assert.equal(verifiedProfile.displayName, profile.displayName);
    assert.equal(verifiedProfile.customerRef, profile.customerRef);
    assert.equal(verifiedProfile.kyc.state, "verified");
    const wallet = await getJson(app, "/bff/wallet", verifiedCookie);
    assert.equal(wallet.kyc, "verified");
    assert.deepEqual(wallet.assets, [
      { code: "RUB", available: "84200.00", hold: "0.00", valueRub: "84200.00" },
      { code: "USDT", available: "10.000000", hold: "0.000000", valueRub: "924.00" }
    ]);
    assert.equal(wallet.availableRub, "85124.00");
    assert.equal(wallet.holdRub, "0.00");
    assert.equal(wallet.totalRub, "85124.00");
    const feed = await getJson(app, "/bff/notifications", verifiedCookie);
    assert.equal(feed.mode, "test");
    assert.equal(feed.delivery, "disabled");
    assert.equal(feed.unread, 1);
    assert.deepEqual(feed.notifications.map((draft) => draft.id), [
      "ntf_0123456789abcdef01234567",
      "ntf_fedcba9876543210fedcba98"
    ]);
    assert.deepEqual(feed.notifications.map((draft) => draft.createdAt), [
      Date.parse("2026-10-01T12:00:00.000Z"),
      Date.parse("2026-09-30T12:00:00.000Z")
    ]);
    assert.deepEqual(feed.notifications.map((draft) => draft.read), [false, true]);
    // The deposits list is KYC-gated like the wallet: only the verified
    // session consults upstream, the gated one keeps the emptied local view.
    const deposits = await getJson(app, "/bff/deposits", verifiedCookie);
    assert.equal(deposits.mode, "test");
    assert.equal(deposits.kyc, "verified");
    assert.deepEqual(Object.keys(deposits).sort(), ["deposits", "kyc", "mode"]);
    assert.equal(deposits.deposits.length, 1);
    assert.deepEqual(Object.keys(deposits.deposits[0]).sort(), [
      "asset",
      "createdAt",
      "expected",
      "id",
      "method",
      "paymentReference",
      "posting",
      "received",
      "reversed",
      "status",
      "updatedAt"
    ]);
    assert.equal(deposits.deposits[0].id, "dep_0123456789abcdef01234567");
    assert.equal(deposits.deposits[0].status, "payment_received");
    assert.equal(deposits.deposits[0].expected, "25000.00");
    assert.equal(deposits.deposits[0].posting, "none");
    const gatedDeposits = await getJson(app, "/bff/deposits", cookie);
    assert.equal(gatedDeposits.kyc, "kyc-gated");
    assert.equal(gatedDeposits.deposits.length, 0);
    // The withdrawals list is KYC-gated the same way: only the verified
    // session consults upstream, and the adapted view carries the custody
    // lifecycle statuses and the two wdl_* out-legs (principal + fee).
    const withdrawals = await getJson(app, "/bff/withdrawals", verifiedCookie);
    assert.equal(withdrawals.mode, "test");
    assert.equal(withdrawals.kyc, "verified");
    assert.deepEqual(Object.keys(withdrawals).sort(), ["kyc", "mode", "withdrawals"]);
    assert.equal(withdrawals.withdrawals.length, 1);
    assert.deepEqual(Object.keys(withdrawals.withdrawals[0]).sort(), [
      "amount",
      "asset",
      "createdAt",
      "destinationReference",
      "expiresAt",
      "fee",
      "id",
      "legs",
      "network",
      "posting",
      "status",
      "updatedAt"
    ]);
    assert.equal(withdrawals.withdrawals[0].id, "wdr_0123456789abcdef01234567");
    assert.equal(withdrawals.withdrawals[0].status, "confirmed");
    assert.equal(withdrawals.withdrawals[0].amount, "25.000000");
    assert.equal(withdrawals.withdrawals[0].posting, "none");
    assert.deepEqual(withdrawals.withdrawals[0].legs.map((leg) => leg.id), [
      "wdl_0123456789abcdef01234567",
      "wdl_fedcba9876543210fedcba98"
    ]);
    const gatedWithdrawals = await getJson(app, "/bff/withdrawals", cookie);
    assert.equal(gatedWithdrawals.kyc, "kyc-gated");
    assert.equal(gatedWithdrawals.withdrawals.length, 0);
    // The KYC status surface consults upstream for gated sessions too (the
    // read is never KYC-gated): the adapted view carries the upstream verdict
    // sessionKyc="kyc-gated" (stub's session_kyc is "unverified") for both.
    const kyc = await getJson(app, "/bff/kyc/status", verifiedCookie);
    assert.equal(kyc.mode, "test");
    assert.equal(kyc.provider, "simulator");
    assert.equal(kyc.sessionKyc, "kyc-gated");
    assert.equal(kyc.state, "rejected");
    assert.equal(kyc.canSubmit, true);
    assert.equal(kyc.submittedAt, Date.parse("2026-10-01T12:00:00.000Z"));
    assert.equal(kyc.reviewDeadline, undefined);
    assert.deepEqual(await getJson(app, "/bff/kyc/status", cookie), kyc);
    // The support request list consults upstream for gated sessions too
    // (customer.support.read is never denied): the adapted view maps the
    // contract snake_case ticket fields onto the app's request shape.
    const requests = await getJson(app, "/bff/support/requests", cookie);
    assert.equal(requests.mode, "test");
    assert.equal(requests.delivery, "disabled");
    assert.equal(requests.requests.length, 1);
    assert.deepEqual(Object.keys(requests.requests[0]).sort(), [
      "category",
      "complaintAcknowledged",
      "createdAt",
      "delivery",
      "expiresAt",
      "id",
      "message",
      "mode",
      "status",
      "timeline",
      "topic"
    ]);
    assert.equal(requests.requests[0].id, "tck_0123456789abcdef01234567");
    assert.equal(requests.requests[0].status, "in_review");
    assert.equal(requests.requests[0].complaintAcknowledged, true);
    assert.equal(requests.requests[0].createdAt, Date.parse("2026-10-01T12:00:00.000Z"));
    assert.deepEqual(requests.requests[0].timeline, [
      { status: "received", at: Date.parse("2026-10-01T12:00:00.000Z") },
      { status: "in_review", at: Date.parse("2026-10-01T13:00:00.000Z") }
    ]);
    assert.deepEqual(await getJson(app, "/bff/support/requests", verifiedCookie), requests);
  });

  it("degrades verified sessions' wallet and notifications on an upstream capability denial", async () => {
    mode = "capability_denied";
    const hits = upstream.length;
    const response = await call(app.base, "/bff/wallet", { cookie: verifiedCookie });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.includes(marker), false);
    assert.equal(text.includes(key), false);
    assert.equal(text.includes("syn_wal_"), false);
    const wallet = JSON.parse(text);
    assert.equal(wallet.kyc, "kyc-gated");
    assert.equal(wallet.availableRub, "0.00");
    assert.equal(wallet.holdRub, "0.00");
    // A refused deposits read degrades in place to the same emptied list a
    // gated session sees (like the wallet's zeroed gated view).
    const depositsResponse = await call(app.base, "/bff/deposits", { cookie: verifiedCookie });
    assert.equal(depositsResponse.status, 200);
    const depositsText = await depositsResponse.text();
    assert.equal(depositsText.includes(marker), false);
    assert.equal(depositsText.includes(key), false);
    assert.equal(depositsText.includes("dep_"), false);
    const gatedDeposits = await getJson(app, "/bff/deposits", cookie);
    assert.deepEqual(JSON.parse(depositsText), gatedDeposits);
    assert.equal(gatedDeposits.kyc, "kyc-gated");
    // A refused withdrawals read degrades the same way: the verified session
    // falls back to the emptied list a gated session sees.
    const withdrawalsResponse = await call(app.base, "/bff/withdrawals", { cookie: verifiedCookie });
    assert.equal(withdrawalsResponse.status, 200);
    const withdrawalsText = await withdrawalsResponse.text();
    assert.equal(withdrawalsText.includes(marker), false);
    assert.equal(withdrawalsText.includes(key), false);
    assert.equal(withdrawalsText.includes("wdr_"), false);
    const gatedWithdrawalsDenied = await getJson(app, "/bff/withdrawals", cookie);
    assert.deepEqual(JSON.parse(withdrawalsText), gatedWithdrawalsDenied);
    assert.equal(gatedWithdrawalsDenied.kyc, "kyc-gated");
    // A refused notifications read degrades in place to the same feed a gated
    // session sees: the local outbox drafts (a session_login per dev login).
    const feedResponse = await call(app.base, "/bff/notifications", { cookie: verifiedCookie });
    assert.equal(feedResponse.status, 200);
    const feedText = await feedResponse.text();
    assert.equal(feedText.includes(marker), false);
    assert.equal(feedText.includes(key), false);
    const feed = JSON.parse(feedText);
    assert.equal(feed.mode, "test");
    assert.equal(feed.delivery, "disabled");
    const gatedFeed = await getJson(app, "/bff/notifications", cookie);
    assert.deepEqual(feed, gatedFeed);
    assert.ok(upstream.length > hits, "upstream was never called");
    // A refused KYC status read is upstream contract drift (customer.kyc.read
    // is granted at every session status), so it fails closed for gated and
    // verified sessions alike rather than degrading in place. The same holds
    // for the profile and support reads (customer.profile.read and
    // customer.support.read are never denied either).
    for (const sessionCookie of [verifiedCookie, cookie]) {
      const kycResponse = await call(app.base, "/bff/kyc/status", { cookie: sessionCookie });
      assert.equal(kycResponse.status, 503);
      assert.deepEqual(await readJson(kycResponse), { error: "kyc_unavailable" });
      const profileResponse = await call(app.base, "/bff/profile", { cookie: sessionCookie });
      assert.equal(profileResponse.status, 503);
      assert.deepEqual(await readJson(profileResponse), { error: "profile_unavailable" });
      const supportResponse = await call(app.base, "/bff/support/requests", { cookie: sessionCookie });
      assert.equal(supportResponse.status, 503);
      assert.deepEqual(await readJson(supportResponse), { error: "support_unavailable" });
    }
    assert.equal((await getJson(app, "/bff/session", verifiedCookie)).kyc, "verified");
  });

  it("fails closed on error statuses, redirects and malformed bodies without leaking them", async () => {
    const malformed = [
      "server_error",
      "unauthorized",
      "redirect",
      "invalid_json",
      "wrong_content_type",
      "missing_content_type",
      "oversized_declared",
      "oversized_chunked",
      "wrong_shape",
      "extra_fields",
      "subject_mismatch",
      "commands_enabled",
      "connection_reset",
      "invalid_utf8"
    ];
    for (const name of malformed) {
      mode = name;
      await profileFailsClosed(`${name} gated`, cookie);
      await profileFailsClosed(`${name} verified`, verifiedCookie);
      await supportFailsClosed(`${name} verified`, verifiedCookie);
      await supportFailsClosed(`${name} gated`, cookie);
      await walletFailsClosed(name);
      await depositsFailsClosed(name);
      await withdrawalsFailsClosed(name);
      await notificationsFailClosed(name);
      await kycFailsClosed(`${name} verified`, verifiedCookie);
      await kycFailsClosed(`${name} gated`, cookie);
      await assertGated(app, cookie, name);
    }
  });

  it("times out slow and stalled upstream responses within the client deadline", async () => {
    for (const name of ["slow_headers", "stalled_body"]) {
      mode = name;
      const elapsed = await profileFailsClosed(`${name} gated`, cookie);
      assert.ok(elapsed >= 1_500, `${name} returned before the client timeout (${elapsed} ms)`);
      await supportFailsClosed(`${name} gated`, cookie);
      await walletFailsClosed(name);
      await depositsFailsClosed(name);
      await withdrawalsFailsClosed(name);
      await notificationsFailClosed(name);
      await kycFailsClosed(`${name} verified`, verifiedCookie);
      await kycFailsClosed(`${name} gated`, cookie);
      await upstreamReleased(name);
      await assertGated(app, cookie, name);
    }
  });

  it("recovers once upstream answers correctly again", async () => {
    mode = "valid";
    const profile = await getJson(app, "/bff/profile", cookie);
    assert.equal(profile.apiAccess.status, "connected");
    assert.equal(profile.displayName, "Customer ab12cd34");
    assert.equal((await getJson(app, "/bff/wallet", verifiedCookie)).kyc, "verified");
    assert.equal((await getJson(app, "/bff/deposits", verifiedCookie)).deposits[0].id, "dep_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/withdrawals", verifiedCookie)).withdrawals[0].id, "wdr_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/notifications", verifiedCookie)).mode, "test");
    assert.equal((await getJson(app, "/bff/kyc/status", cookie)).state, "rejected");
    assert.equal((await getJson(app, "/bff/support/requests", cookie)).requests[0].id, "tck_0123456789abcdef01234567");
  });
});

describe("Mini App BFF with an unreachable customer-api", () => {
  const key = randomBytes(32).toString("hex");

  async function assertUnavailable(app, cookie, label) {
    // The profile and support surfaces consult upstream for gated sessions
    // too, so an unreachable customer-api fails them closed outright.
    const response = await call(app.base, "/bff/profile", { cookie });
    assert.equal(response.status, 503, label);
    assert.deepEqual(await readJson(response), { error: "profile_unavailable" }, label);
    const support = await call(app.base, "/bff/support/requests", { cookie });
    assert.equal(support.status, 503, label);
    assert.deepEqual(await readJson(support), { error: "support_unavailable" }, label);
    await assertGated(app, cookie, label);
  }

  it("fails closed when customer-api was never started", async () => {
    const port = await freePort();
    const app = await startMiniapp({
      MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${port}`,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key
    });
    try {
      await assertUnavailable(app, await devLogin(app, "kyc-gated"), "never started");
    } finally {
      await closeServer(app.server);
    }
  });

  it("fails closed when the port accepts and immediately drops connections", async () => {
    const refusing = createTcpServer((socket) => socket.destroy());
    await new Promise((resolve) => refusing.listen(0, "127.0.0.1", resolve));
    const app = await startMiniapp({
      MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${refusing.address().port}`,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key
    });
    try {
      await assertUnavailable(app, await devLogin(app, "kyc-gated"), "refusing");
    } finally {
      await closeServer(app.server);
      await new Promise((resolve) => refusing.close(resolve));
    }
  });

  it("fails closed after customer-api is killed mid-session", async () => {
    const customerApi = await startService(
      customerApiEntry,
      {
        CUSTOMER_API_HOST: "127.0.0.1",
        CUSTOMER_API_PORT: "0",
        CUSTOMER_API_DEV_AUTH: "synthetic",
        CUSTOMER_API_DEV_TOKEN_KEY: key
      },
      /listening on http:\/\/127\.0\.0\.1:(\d+) auth=synthetic/
    );
    const app = await startMiniapp({
      MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${customerApi.match[1]}`,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key
    });
    try {
      const cookie = await devLogin(app, "kyc-gated");
      assert.equal((await getJson(app, "/bff/profile", cookie)).apiAccess.status, "connected");
      const exited = once(customerApi.child, "exit");
      customerApi.child.kill("SIGKILL");
      assert.deepEqual(await exited, [null, "SIGKILL"]);
      await assertUnavailable(app, cookie, "killed");
    } finally {
      await closeServer(app.server);
    }
  });
});

describe("Mini App BFF provider-simulator failure scenarios", () => {
  it("maps quote outage and stale price to quote_unavailable for every session", async () => {
    for (const scenario of ["provider_outage", "stale_price"]) {
      const app = await startMiniapp({ MINIAPP_QUOTE_SCENARIO: scenario });
      try {
        for (const kyc of ["verified", "kyc-gated"]) {
          const response = await call(app.base, quotePath, { cookie: await devLogin(app, kyc) });
          assert.equal(response.status, 503, `${scenario} ${kyc}`);
          assert.deepEqual(await readJson(response), { error: "quote_unavailable", reason: scenario });
        }
      } finally {
        await closeServer(app.server);
      }
    }
  });

  it("serves expired quotes as non-executable previews that are already expired", async () => {
    const app = await startMiniapp({ MINIAPP_QUOTE_SCENARIO: "expired_quote" });
    try {
      for (const kyc of ["verified", "kyc-gated"]) {
        const quote = await getJson(app, quotePath, await devLogin(app, kyc));
        assert.equal(quote.executable, false, kyc);
        assert.equal(quote.kycRequired, kyc !== "verified", kyc);
        assert.ok(quote.expiresAt <= quote.serverTime, kyc);
      }
    } finally {
      await closeServer(app.server);
    }
  });

  it("keeps the session gated when the KYC provider is down", async () => {
    const app = await startMiniapp({ MINIAPP_KYC_SCENARIO: "provider_outage" });
    try {
      const cookie = await devLogin(app, "kyc-gated");
      const submitted = await call(app.base, "/bff/kyc/applications", { method: "POST", cookie });
      assert.equal(submitted.status, 503);
      assert.deepEqual(await readJson(submitted), { error: "kyc_unavailable" });
      assert.deepEqual(await getJson(app, "/bff/kyc/status", cookie), {
        mode: "test",
        provider: "simulator",
        state: "unavailable",
        sessionKyc: "kyc-gated",
        canSubmit: true
      });
      await assertGated(app, cookie, "kyc provider_outage");
    } finally {
      await closeServer(app.server);
    }
  });

  it("times out KYC reviews without approval, even when a late callback arrives", async () => {
    for (const scenario of ["pending_timeout", "late_callback"]) {
      const app = await startMiniapp({
        MINIAPP_KYC_SCENARIO: scenario,
        MINIAPP_KYC_REVIEW_TIMEOUT_SECONDS: "600",
        MINIAPP_SESSION_TTL_SECONDS: "3600"
      });
      try {
        const cookie = await devLogin(app, "kyc-gated");
        const submitted = await call(app.base, "/bff/kyc/applications", { method: "POST", cookie });
        assert.equal(submitted.status, 202, scenario);
        const { view, seen } = await advanceUntil(app, "/bff/kyc/status", cookie, (state) => state.state === "timed_out", {
          stepMs: 30_000,
          maxSteps: 40
        });
        assert.equal(view.sessionKyc, "kyc-gated", scenario);
        assert.equal(seen.includes("approved"), false, `${scenario}: ${seen.join(" -> ")}`);
        app.clock.now += 1_200_000;
        assert.equal((await getJson(app, "/bff/kyc/status", cookie)).state, "timed_out", scenario);
        await assertGated(app, cookie, `kyc ${scenario}`);
      } finally {
        await closeServer(app.server);
      }
    }
  });

  it("only verifies an out-of-order KYC journey after the signed approval is applied", async () => {
    const app = await startMiniapp({ MINIAPP_KYC_SCENARIO: "out_of_order_callback" });
    try {
      const cookie = await devLogin(app, "kyc-gated");
      const submitted = await call(app.base, "/bff/kyc/applications", { method: "POST", cookie });
      assert.equal(submitted.status, 202);
      await assertGated(app, cookie, "before approval");
      const { seen } = await advanceUntil(app, "/bff/kyc/status", cookie, (state) => state.state === "approved", {
        stepMs: 5_000,
        maxSteps: 120
      });
      assert.equal(seen.at(-1), "approved");
      assert.equal((await getJson(app, "/bff/session", cookie)).kyc, "verified");
      assert.equal((await getJson(app, "/bff/wallet", cookie)).kyc, "verified");
    } finally {
      await closeServer(app.server);
    }
  });

  it("returns screening_unavailable without the address when the KYT provider is down", async () => {
    const app = await startMiniapp({ MINIAPP_KYT_SCENARIO: "provider_outage" });
    try {
      const cookie = await devLogin(app, "verified");
      const response = await call(app.base, "/bff/address-screening", { method: "POST", cookie, body: screeningBody });
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(tronTestnet), false);
      const body = JSON.parse(text);
      assert.deepEqual(Object.keys(body).sort(), ["error", "screening"]);
      assert.equal(body.error, "screening_unavailable");
      assert.equal(body.screening.status, "unavailable");
      assert.equal(body.screening.advisory, true);
      assert.equal(body.screening.executable, false);
    } finally {
      await closeServer(app.server);
    }
  });

  it("times out KYT screenings, and a late callback never yields a risk level", async () => {
    for (const scenario of ["pending_timeout", "late_callback"]) {
      const app = await startMiniapp({ MINIAPP_KYT_SCENARIO: scenario, MINIAPP_KYT_TIMEOUT_SECONDS: "60" });
      try {
        const cookie = await devLogin(app, "verified");
        const submitted = await call(app.base, "/bff/address-screening", { method: "POST", cookie, body: screeningBody });
        assert.equal(submitted.status, 202, scenario);
        const created = await readJson(submitted);
        assert.equal(created.status, "pending", scenario);
        const path = `/bff/address-screening/${created.id}`;
        const { view, seen } = await advanceUntil(app, path, cookie, (state) => state.status === "timed_out", {
          stepMs: 5_000,
          maxSteps: 60
        });
        assert.equal(view.executable, false, scenario);
        assert.deepEqual(seen.filter((status) => status !== "pending" && status !== "timed_out"), [], scenario);
        app.clock.now += 1_200_000;
        const late = await getJson(app, path, cookie);
        assert.equal(late.status, "timed_out", scenario);
        assert.equal(late.executable, false, scenario);
      } finally {
        await closeServer(app.server);
      }
    }
  });
});

describe("backoffice BFF with an unreachable PostgreSQL audit store", () => {
  const password = `syn-${randomBytes(12).toString("hex")}`;
  let databaseUrl;

  function backofficeConfig() {
    return {
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [backofficeOrigin],
      allowDevLogin: true,
      sessionTtlSeconds: 900,
      audit: { storage: "postgresql", retentionDays: 30, databaseUrl },
      stepUp: { provider: "synthetic-dev", challengeTtlSeconds: 300, grantTtlSeconds: 60, maxAttempts: 3 },
      signing: { backend: "ephemeral-dev", rotationSeconds: 900, retainedVerificationKeys: 2 }
    };
  }

  async function operatorCookie(base) {
    const response = await call(base, "/bff/auth/dev-session", {
      method: "POST",
      body: { role: "compliance-lead" },
      origin: backofficeOrigin
    });
    assert.equal(response.status, 200);
    return cookieOf(response);
  }

  async function assertAuditUnavailable(base, path, cookie) {
    const response = await call(base, path, { cookie });
    assert.equal(response.status, 503, path);
    assert.deepEqual(await readJson(response), { error: "audit_integrity_unavailable" }, path);
  }

  before(async () => {
    databaseUrl = `postgresql://syn_audit:${password}@127.0.0.1:${await freePort()}/syn_audit`;
  });

  it("refuses to start without reachable audit storage and never listens", async () => {
    const port = await freePort();
    const result = await runToExit(backofficeEntry, {
      BACKOFFICE_BFF_HOST: "127.0.0.1",
      BACKOFFICE_BFF_PORT: String(port),
      BACKOFFICE_ALLOWED_ORIGINS: backofficeOrigin,
      BACKOFFICE_ALLOW_DEV_LOGIN: "true",
      BACKOFFICE_AUDIT_STORAGE: "postgresql",
      BACKOFFICE_AUDIT_DATABASE_URL: databaseUrl
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /refused to start because audit storage is not ready/);
    assert.doesNotMatch(result.stdout, /listening/);
    assert.equal(`${result.stdout}${result.stderr}`.includes(password), false);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/bff/healthz`, { signal: AbortSignal.timeout(2_000) }));
  });

  it("reports not-ready and fails audited routes closed when the store drops after startup", async () => {
    const store = new PostgresAuditStore(backofficeConfig().audit);
    await assert.rejects(store.initialize(demoRepository.auditSource()), AuditUnavailableError);
    const server = createBackofficeServer(backofficeConfig(), store);
    const base = await listen(server);
    try {
      const health = await call(base, "/bff/healthz");
      assert.equal(health.status, 503);
      const text = await health.text();
      assert.equal(text.includes(password), false);
      assert.deepEqual(JSON.parse(text), { error: "audit_integrity_unavailable" });
      const cookie = await operatorCookie(base);
      for (const path of [
        "/bff/api/audit",
        "/bff/api/audit/export",
        "/bff/api/reports/kyc-queue-daily",
        "/bff/api/reports/kyc-queue-daily/export"
      ]) {
        await assertAuditUnavailable(base, path, cookie);
      }
    } finally {
      await closeServer(server);
      await store.close();
    }
  });

  it("serves no report when the audit append fails", async () => {
    class AppendFailingStore extends MemoryAuditStore {
      async append() {
        throw new AuditUnavailableError();
      }
    }
    const store = new AppendFailingStore(demoRepository.auditSource(), 30);
    const before = (await store.snapshot()).status.length;
    const server = createBackofficeServer({ ...backofficeConfig(), audit: { storage: "memory", retentionDays: 30 } }, store);
    const base = await listen(server);
    try {
      assert.equal((await call(base, "/bff/healthz")).status, 200);
      const cookie = await operatorCookie(base);
      const listing = await call(base, "/bff/api/reports", { cookie });
      assert.equal(listing.status, 200);
      const reports = (await readJson(listing)).payload.reports;
      assert.ok(reports.length > 0);
      for (const report of reports) {
        await assertAuditUnavailable(base, `/bff/api/reports/${report.id}`, cookie);
        await assertAuditUnavailable(base, `/bff/api/reports/${report.id}/export`, cookie);
      }
      assert.equal((await store.snapshot()).status.length, before);
    } finally {
      await closeServer(server);
    }
  });
});
