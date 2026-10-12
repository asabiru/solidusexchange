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
  const quotes = await getJson(app, "/bff/quotes", cookie);
  assert.equal(quotes.kyc, "kyc-gated", label);
  assert.equal(quotes.quotes.length, 0, label);
  const orders = await getJson(app, "/bff/exchange-orders", cookie);
  assert.equal(orders.kyc, "kyc-gated", label);
  assert.equal(orders.orders.length, 0, label);
  const trades = await getJson(app, "/bff/trades", cookie);
  assert.equal(trades.kyc, "kyc-gated", label);
  assert.equal(trades.trades.length, 0, label);
  const markets = await getJson(app, "/bff/markets", cookie);
  assert.equal(markets.kyc, "kyc-gated", label);
  assert.equal(markets.markets.length, 0, label);
  const payments = await getJson(app, "/bff/payments", cookie);
  assert.equal(payments.kyc, "kyc-gated", label);
  assert.equal(payments.payments.length, 0, label);
  const cards = await getJson(app, "/bff/cards", cookie);
  assert.equal(cards.kyc, "kyc-gated", label);
  assert.equal(cards.cards.length, 0, label);
  const checks = await getJson(app, "/bff/checks", cookie);
  assert.equal(checks.mode, "test", label);
  assert.equal(checks.checks.length, 5, label);
  for (const check of checks.checks) {
    assert.equal(check.mode, "test", label);
    assert.equal(check.claimRule, "personal", label);
    assert.equal(check.executable, false, label);
    assert.equal(check.executionUnavailableReason, "dev_test_version", label);
  }
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
  let stubBase;
  let app;
  let cookie;
  let verifiedCookie;

  function subjectOf(request) {
    return (request.headers.authorization ?? "").split(".")[1] ?? "";
  }

  // The real customer-api echoes the presented token's expiry; the stub does
  // the same so it cannot answer with a session the real server never emits.
  function expiresAtOf(request) {
    const seconds = Number((request.headers.authorization ?? "").split(".")[2]);
    return Number.isFinite(seconds) ? new Date(seconds * 1_000).toISOString() : "1970-01-01T00:00:00.000Z";
  }

  // The operations feed fixture: one served OperationView item shared by the
  // list arm and the member arm (the member 404s every other id).
  const operationFixture = {
    operation_id: "ope_0123456789abcdef01234567",
    reference: "SCX-01234",
    kind: "exchange",
    status: "open",
    title: "Exchange USDT → RUB",
    channel: "miniapp",
    legs: [
      { asset: "USDT", amount: "10.000000", direction: "out" },
      { asset: "RUB", amount: "950.00", direction: "in" }
    ],
    fee_amount: "0.050000",
    fee_asset: "USDT",
    exchange: { base_asset: "USDT", quote_asset: "RUB", rate: "95.000000" },
    note: "Synthetic exchange operation",
    timeline: [
      { title: "Draft", detail: "Operation created", at: "2026-10-08T09:15:00.000Z", state: "done" },
      { title: "Review", detail: "Awaiting confirmation", at: "2026-10-08T09:16:00.000Z", state: "current" },
      { title: "Settled", detail: "Legs settle", at: null, state: "pending" }
    ],
    // Upstream mints created_at at the latest recorded step instant — no
    // timeline entry may sit past it.
    created_at: "2026-10-08T09:16:00.000Z",
    posting: "none"
  };

  // Every customer-api operation the BFF calls must have an explicit arm here;
  // an unmatched path means harness drift and answers 404 like the real
  // router — never a successful default body.
  function validBody(request, extra = {}) {
    if (request.url.endsWith("/session")) {
      // The real customer-api echoes the verified principal's CUSTOMER_SCOPES
      // pair verbatim; the BFF access probe pins exactly this ordered list.
      return {
        subject: subjectOf(request),
        actor_type: "customer",
        scopes: ["customer.session.read", "customer.capabilities.read"],
        expires_at: expiresAtOf(request),
        ...extra
      };
    }
    if (request.url.endsWith("/capabilities")) {
      return { capabilities: ["customer.session.read"], commands_enabled: false, ...extra };
    }
    if (request.url.endsWith("/wallets")) {
      // Upstream mints exactly one wallet per asset in the fixed asset table
      // (RUB, USDT, TON) — a subset, an extra row or a duplicate is drift.
      return {
        wallets: [
          { wallet_id: "syn_wal_rub00001", asset: "RUB", available: "84200.00", hold: "0.00" },
          { wallet_id: "syn_wal_usdt0001", asset: "USDT", available: "10.000000", hold: "0.000000" },
          { wallet_id: "syn_wal_ton000001", asset: "TON", available: "5.000000000", hold: "0.500000000" }
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
    if (request.url.endsWith("/quotes")) {
      return {
        mode: "test",
        quotes: [
          {
            quote_id: "qte_0123456789abcdef01234567",
            pair: "USDT/RUB",
            base_asset: "USDT",
            quote_asset: "RUB",
            side: "sell",
            base_amount: "25.000000",
            mid_price: "90.00000000",
            price: "89.77500000",
            spread_bps: 50,
            fee_bps: 30,
            quote_amount: "2244.37",
            fee_amount: "6.74",
            total_quote_amount: "2237.63",
            rounding: "down",
            price_observed_at: "2026-10-02T14:04:57.000Z",
            issued_at: "2026-10-02T14:05:00.000Z",
            expires_at: "2026-10-02T14:05:30.000Z",
            ttl_seconds: 30,
            status: "indicative",
            execution: "not_supported",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/exchange-orders")) {
      return {
        mode: "test",
        orders: [
          {
            order_id: "ord_0123456789abcdef01234567",
            pair: "USDT/RUB",
            base_asset: "USDT",
            quote_asset: "RUB",
            side: "sell",
            order_type: "limit",
            base_amount: "25.000000",
            price: "89.77500000",
            quote_amount: "2244.37",
            fee_bps: 30,
            fee_amount: "6.74",
            total_quote_amount: "2237.63",
            status: "open",
            created_at: "2026-10-02T14:05:00.000Z",
            updated_at: "2026-10-02T14:05:00.000Z",
            execution: "not_supported",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/trades")) {
      return {
        mode: "test",
        trades: [
          {
            trade_id: "trd_0123456789abcdef01234567",
            order_id: "ord_0123456789abcdef01234567",
            pair: "USDT/RUB",
            base_asset: "USDT",
            quote_asset: "RUB",
            side: "sell",
            liquidity: "maker",
            price: "90.00000000",
            quantity: "10.000000",
            quote_amount: "900.00",
            fee_bps: 30,
            fee_amount: "2.70",
            total_quote_amount: "897.30",
            executed_at: "2026-10-02T14:05:00.000Z",
            execution: "not_supported",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.includes("/markets/")) {
      // The member read's depth view: percent-encoded instrument in one path
      // segment, bids descending / asks ascending, never crossed. The served
      // book is a live-upstream-only value — it is what recovery proves.
      const segment = request.url.slice(request.url.indexOf("/markets/") + "/markets/".length);
      let instrument;
      try {
        instrument = decodeURIComponent(segment);
      } catch {
        instrument = undefined;
      }
      if (instrument !== "USDT/RUB") {
        return undefined;
      }
      return {
        mode: "test",
        instrument: "USDT/RUB",
        base_asset: "USDT",
        quote_asset: "RUB",
        bids: [{ price: "89.99000000", quantity: "25.000000", order_count: 1 }],
        asks: [{ price: "90.01000000", quantity: "18.000000", order_count: 1 }],
        last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: "2026-10-02T14:05:00.000Z" },
        depth_levels: 1,
        as_of: "2026-10-02T14:10:00.000Z",
        posting: "none",
        ...extra
      };
    }
    if (request.url.endsWith("/markets")) {
      // The served contract emits every declared instrument exactly once
      // in canonical ORDER_PAIRS order; the adapter pins that sequence, so
      // the stub must report all three — a book side may still rest empty.
      return {
        mode: "test",
        markets: [
          {
            instrument: "USDT/RUB",
            base_asset: "USDT",
            quote_asset: "RUB",
            best_bid: { price: "89.99000000", quantity: "25.000000", order_count: 1 },
            best_ask: { price: "90.01000000", quantity: "18.000000", order_count: 1 },
            last_trade: { price: "90.00000000", quantity: "10.000000", executed_at: "2026-10-02T14:05:00.000Z" },
            spread_bps: 2,
            base_scale: 6,
            quote_scale: 2,
            price_scale: 8,
            as_of: "2026-10-02T14:10:00.000Z",
            posting: "none"
          },
          {
            instrument: "TON/RUB",
            base_asset: "TON",
            quote_asset: "RUB",
            best_bid: { price: "299.00000000", quantity: "5.000000000", order_count: 1 },
            best_ask: { price: "301.00000000", quantity: "4.000000000", order_count: 1 },
            last_trade: null,
            spread_bps: 67,
            base_scale: 9,
            quote_scale: 2,
            price_scale: 8,
            as_of: "2026-10-02T14:10:00.000Z",
            posting: "none"
          },
          {
            instrument: "TON/USDT",
            base_asset: "TON",
            quote_asset: "USDT",
            best_bid: null,
            best_ask: null,
            last_trade: null,
            spread_bps: null,
            base_scale: 9,
            quote_scale: 6,
            price_scale: 8,
            as_of: "2026-10-02T14:10:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/payments")) {
      return {
        mode: "test",
        payments: [
          {
            payment_id: "pay_0123456789abcdef01234567",
            asset: "RUB",
            method: "sbp",
            status: "completed",
            amount: "1500.00",
            fee_amount: "7.50",
            total_amount: "1507.50",
            recipient_reference: "recipient_ref_a1b2c3d4",
            provider_reference: "SIMBANK0123456789ABCDEF",
            created_at: "2026-10-05T11:20:00.000Z",
            updated_at: "2026-10-05T11:24:00.000Z",
            posting: "none"
          },
          {
            payment_id: "pay_fedcba9876543210fedcba98",
            asset: "RUB",
            method: "sbp",
            status: "created",
            amount: "800.00",
            fee_amount: "2.00",
            total_amount: "802.00",
            recipient_reference: "recipient_ref_f6e5d4c3",
            provider_reference: null,
            created_at: "2026-10-08T09:15:00.000Z",
            updated_at: "2026-10-08T09:15:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/cards")) {
      return {
        mode: "test",
        cards: [
          {
            card_id: "crd_0123456789abcdef01234567",
            brand: "mir",
            kind: "physical",
            status: "active",
            last4: "4832",
            token_reference: "tok_0123456789abcdef01234567",
            asset: "RUB",
            monthly_limit: "250000.00",
            created_at: "2026-09-12T10:00:00.000Z",
            expires_at: "2029-09-12T00:00:00.000Z",
            updated_at: "2026-09-12T10:05:00.000Z",
            posting: "none"
          },
          {
            card_id: "crd_fedcba9876543210fedcba98",
            brand: "visa",
            kind: "virtual",
            status: "pending_activation",
            last4: "7716",
            token_reference: "tok_fedcba9876543210fedcba98",
            asset: "RUB",
            monthly_limit: "100000.00",
            created_at: "2026-10-08T09:15:00.000Z",
            expires_at: "2029-10-08T09:15:00.000Z",
            updated_at: "2026-10-08T09:15:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/checks")) {
      return {
        mode: "test",
        checks: [
          {
            check_id: "chk_0123456789abcdef01234567",
            check_type: "personal",
            status: "created",
            sender_ref: subjectOf(request),
            recipient_ref: "syn_peer_0123456789ab",
            amount: "25.000000",
            asset: "USDT",
            fee_amount: "0.075000",
            outstanding_amount: "25.000000",
            created_at: "2026-10-08T09:15:00.000Z",
            expires_at: "2026-10-11T09:15:00.000Z",
            resolved_at: null,
            posting: "none"
          },
          {
            check_id: "chk_fedcba9876543210fedcba98",
            check_type: "personal",
            status: "claimed",
            sender_ref: "syn_peer_fedcba987654",
            recipient_ref: subjectOf(request),
            amount: "4.000000000",
            asset: "TON",
            fee_amount: "0.012000000",
            outstanding_amount: "0.000000000",
            created_at: "2026-10-01T10:00:00.000Z",
            expires_at: "2026-10-04T10:00:00.000Z",
            resolved_at: "2026-10-02T10:00:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/deposit-addresses")) {
      // The address set is a fixed catalog: upstream mints exactly one entry
      // per custody-dev-v1 (asset, network) target in DEPOSIT_ADDRESS_TARGETS
      // order — a subset or an emptied list is drift, never "empty but live".
      return {
        mode: "test",
        deposit_addresses: [
          {
            deposit_address_id: "dpa_0123456789abcdef01234567",
            asset: "TON",
            network: "TON_TESTNET",
            address: `kQ${"A".repeat(46)}`,
            status: "active",
            created_at: "2026-09-01T00:00:00.000Z",
            posting: "none"
          },
          {
            deposit_address_id: "dpa_fedcba9876543210fedcba98",
            asset: "USDT",
            network: "TON_TESTNET",
            address: `kQ${"B".repeat(46)}`,
            status: "active",
            created_at: "2026-09-02T00:00:00.000Z",
            posting: "none"
          },
          {
            deposit_address_id: "dpa_89abcdef0123456789abcdef",
            asset: "USDT",
            network: "TRON_TESTNET",
            address: tronTestnet,
            status: "active",
            created_at: "2026-09-03T00:00:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.includes("/address-screenings/")) {
      return {
        screening_id: "scr_0123456789abcdef0123456789abcdef",
        asset: "USDT",
        network: "TON_TESTNET",
        direction: "outbound",
        status: "low",
        verdict: "clear",
        risk_level: "low",
        advisory: true,
        executable: false,
        submitted_at: "2026-10-01T10:00:00.000Z",
        deadline: "2026-10-01T11:00:00.000Z",
        posting: "none",
        ...extra
      };
    }
    if (request.url.endsWith("/address-screenings")) {
      // The screening set is the fixed custody-dev-v1 target catalog: one
      // advisory outbound entry per (asset, network) pair — a subset or an
      // emptied list is drift, and each entry's verdict mirrors its
      // terminal risk level.
      return {
        mode: "test",
        screenings: [
          {
            screening_id: "scr_aaaabbbbccccddddeeeeffff00001111",
            asset: "TON",
            network: "TON_TESTNET",
            direction: "outbound",
            status: "low",
            verdict: "clear",
            risk_level: "low",
            advisory: true,
            executable: false,
            submitted_at: "2026-10-01T10:00:00.000Z",
            deadline: "2026-10-01T11:00:00.000Z",
            posting: "none"
          },
          {
            screening_id: "scr_0123456789abcdef0123456789abcdef",
            asset: "USDT",
            network: "TON_TESTNET",
            direction: "outbound",
            status: "medium",
            verdict: "review",
            risk_level: "medium",
            advisory: true,
            executable: false,
            submitted_at: "2026-10-01T10:00:00.000Z",
            deadline: "2026-10-01T11:00:00.000Z",
            posting: "none"
          },
          {
            screening_id: "scr_00112233445566778899aabbccddeeff",
            asset: "USDT",
            network: "TRON_TESTNET",
            direction: "outbound",
            status: "high",
            verdict: "flagged",
            risk_level: "high",
            advisory: true,
            executable: false,
            submitted_at: "2026-10-01T10:00:00.000Z",
            deadline: "2026-10-01T11:00:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.endsWith("/activity")) {
      return {
        mode: "test",
        activity: [
          {
            activity_id: "act_0123456789abcdef01234567",
            kind: "deposit",
            status: "payment_received",
            title: "Deposit · payment received",
            detail: "dep_0123456789abcdef01234567 payment received",
            money: { amount: "10.000000", asset: "USDT" },
            created_at: "2026-10-08T09:15:00.000Z",
            posting: "none"
          },
          {
            activity_id: "act_fedcba9876543210fedcba98",
            kind: "security",
            status: "login",
            title: "Security · signed in",
            detail: "ses_fedcba9876543210fedcba98 login",
            money: null,
            created_at: "2026-10-08T08:15:00.000Z",
            posting: "none"
          }
        ],
        ...extra
      };
    }
    if (request.url.includes("/operations/ope_")) {
      const id = request.url.slice(request.url.indexOf("/operations/") + "/operations/".length);
      if (id !== "ope_0123456789abcdef01234567") {
        return undefined;
      }
      return { ...operationFixture, ...extra };
    }
    if (request.url.endsWith("/operations")) {
      return { mode: "test", operations: [operationFixture], ...extra };
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
    if (request.url.endsWith("/users")) {
      return {
        mode: "test",
        user_id: "usr_0123456789abcdef01234567",
        subject: subjectOf(request),
        status: "active",
        flags: {
          terms_accepted: true,
          two_factor_enabled: true,
          marketing_opt_in: false
        },
        created_at: "2026-09-01T12:00:00.000Z",
        updated_at: "2026-10-01T12:00:00.000Z",
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
    if (request.url.endsWith("/auth")) {
      return {
        mode: "test",
        sessions: [
          {
            session_id: "sess_0123456789abcdef01234567",
            platform: "telegram-mini-app",
            state: "active",
            created_at: "2026-10-01T12:00:00.000Z",
            last_seen_at: "2026-10-01T13:00:00.000Z",
            current: true
          },
          {
            session_id: "sess_fedcba9876543210fedcba98",
            platform: "web",
            state: "active",
            created_at: "2026-10-02T12:00:00.000Z",
            last_seen_at: "2026-10-02T14:00:00.000Z",
            current: false
          },
          {
            session_id: "sess_aabbccddeeff00112233aabb",
            platform: "ios",
            state: "revoked",
            created_at: "2026-09-30T12:00:00.000Z",
            last_seen_at: "2026-10-01T12:00:00.000Z",
            current: false
          }
        ],
        ...extra
      };
    }
    return undefined;
  }

  function send(response, status, contentType, text) {
    if (contentType) response.setHeader("content-type", contentType);
    response.statusCode = status;
    response.end(text);
  }

  const modes = {
    valid: (request, response) => {
      const body = validBody(request);
      if (body === undefined) {
        send(response, 404, "application/json", JSON.stringify({ code: "NOT_FOUND", detail: marker }));
        return;
      }
      send(response, 200, "application/json", JSON.stringify(body));
    },
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
    // An upstream 404: legitimate "missing" on member paths (the member routes'
    // documented fallback), contract drift on collection reads (a collection
    // endpoint the BFF addresses by contract never legitimately 404s).
    not_found: (_, response) =>
      send(response, 404, "application/json", JSON.stringify({ code: "NOT_FOUND", detail: marker })),
    // A real reachable status class: the upstream's own limiter emits 429 —
    // it must fail closed like every other non-ok outcome, never map to the
    // denied/in-place-degrade arm.
    rate_limited: (_, response) =>
      send(response, 429, "application/json", JSON.stringify({ code: "RATE_LIMITED", detail: marker })),
    // 400 = the client sent something the contract does not accept — still
    // fail closed, not "missing" and not "denied".
    validation_failed: (_, response) =>
      send(response, 400, "application/json", JSON.stringify({ code: "VALIDATION_FAILED", detail: marker })),
    // Per-path degrade: only the deposit-addresses read is refused — the
    // wallet route must degrade that section in place (live balances +
    // emptied addresses), not fail the whole route.
    deposit_addresses_denied: (request, response) => {
      if (request.url.endsWith("/deposit-addresses")) {
        send(response, 403, "application/json", JSON.stringify({ code: "CAPABILITY_DENIED", detail: marker }));
        return;
      }
      modes.valid(request, response);
    },
    // Per-path degrade: every collection read answers 200 with a valid but
    // emptied list — "empty but live" must stay distinguishable from a
    // degrade: verified sessions get 200-with-empty (never the gated
    // fixture, never 503); the markets collection still 503s because the
    // contract requires every declared instrument.
    empty_lists: (request, response) => {
      const body = validBody(request);
      if (body === undefined) {
        send(response, 404, "application/json", JSON.stringify({ code: "NOT_FOUND", detail: marker }));
        return;
      }
      for (const member of ["wallets", "deposits", "withdrawals", "quotes", "orders", "trades", "markets", "payments", "cards", "checks", "deposit_addresses", "screenings", "activity", "operations", "notifications", "tickets", "sessions"]) {
        if (member in body) body[member] = [];
      }
      if ("unread" in body) body.unread = 0;
      send(response, 200, "application/json", JSON.stringify(body));
    },
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
    // Every recorded request must be closed — checking only the last entry
    // would let a client that leaks earlier stalled sockets stay green.
    for (let attempt = 0; attempt < 100 && !upstream.every((entry) => entry.closed); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(upstream.every((entry) => entry.closed), true, `${label}: upstream response still open`);
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
    assert.equal(text.includes("dpa_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "wallet_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
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
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
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
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function quotesFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/quotes", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("qte_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "quotes_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function exchangeOrdersFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/exchange-orders", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("ord_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "exchange_orders_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function tradesFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/trades", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("trd_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "trades_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function marketsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/markets", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "markets_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function paymentsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/payments", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("pay_"), false, label);
    assert.equal(text.includes("SIMBANK"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "payments_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function cardsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/cards", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("crd_"), false, label);
    assert.equal(text.includes("tok_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "cards_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function checksFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/checks", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("syn_peer_"), false, label);
    assert.equal(text.includes("chk_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "checks_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    // A gated session never consults upstream: its local checks view stays
    // intact (and leak-free) while the verified session fails closed.
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/checks", { cookie });
    assert.equal(gatedResponse.status, 200, label);
    const gatedText = await gatedResponse.text();
    assert.equal(gatedText.includes(marker), false, label);
    assert.equal(gatedText.includes(key), false, label);
    assert.equal(gatedText.includes("syn_cust_"), false, label);
    assert.equal(gatedText.includes("syn_peer_"), false, label);
    assert.equal(JSON.parse(gatedText).mode, "test", label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function screeningsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/address-screening", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("scr_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "screening_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    // A gated session never consults upstream: the surface's own KYC gate
    // answers kyc_required (leak-free) while the verified session fails
    // closed.
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/address-screening", { cookie });
    assert.equal(gatedResponse.status, 403, label);
    const gatedText = await gatedResponse.text();
    assert.equal(gatedText.includes(marker), false, label);
    assert.equal(gatedText.includes(key), false, label);
    assert.equal(gatedText.includes("syn_cust_"), false, label);
    assert.deepEqual(JSON.parse(gatedText), { error: "kyc_required" }, label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function screeningDetailFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, `/bff/address-screening/scr_${"0".repeat(32)}`, { cookie: verifiedCookie });
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    // Every mode this helper runs under fails the member read upstream — the
    // exact contract is 503. The upstream-404 → local-fallback arm is pinned
    // separately by the dedicated not_found mode test, where it is the only
    // branch that can legitimately answer not_found.
    assert.equal(response.status, 503, label);
    assert.deepEqual(JSON.parse(text), { error: "screening_unavailable" }, label);
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function activityFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/activity", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("act_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "activity_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    // A gated session never consults upstream: its local activity log view
    // stays intact (and leak-free) while the verified session fails closed.
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/activity", { cookie });
    assert.equal(gatedResponse.status, 200, label);
    const gatedText = await gatedResponse.text();
    assert.equal(gatedText.includes(marker), false, label);
    assert.equal(gatedText.includes(key), false, label);
    assert.equal(gatedText.includes("syn_cust_"), false, label);
    assert.equal(JSON.parse(gatedText).mode, "test", label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function marketsMemberFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/markets/USDT%2FRUB", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("89.99000000"), false, label);
    assert.equal(text.includes("depth_levels"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "markets_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    // A gated session never consults upstream for depth: the member read
    // answers the local not-found, leak-free.
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/markets/USDT%2FRUB", { cookie });
    assert.equal(gatedResponse.status, 404, label);
    assert.deepEqual(await readJson(gatedResponse), { error: "not_found" }, label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function checkDetailFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/checks/chk_0123456789abcdef01234567", { cookie: verifiedCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("chk_"), false, label);
    assert.equal(text.includes("SYNCHK"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "checks_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    // A gated session resolves the reference against the local fixture only —
    // the upstream reference is absent there, and upstream is never consulted.
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/checks/chk_0123456789abcdef01234567", { cookie });
    assert.equal(gatedResponse.status, 404, label);
    assert.deepEqual(await readJson(gatedResponse), { error: "not_found" }, label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function notificationsReadFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    // The marks stay local either way, but the verified session's unread
    // count is reported from the contract feed — an upstream failure fails
    // the read closed rather than serving a count that contradicts the list.
    const response = await call(app.base, "/bff/notifications/read", { method: "POST", cookie: verifiedCookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(text.includes("ntf_"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "notifications_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/notifications/read", { method: "POST", cookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(gatedResponse.status, 200, label);
    const gatedBody = await readJson(gatedResponse);
    assert.equal(gatedBody.marked, 0, label);
    assert.equal(typeof gatedBody.unread, "number", label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function previewsFailClosed(label) {
    const hits = upstream.length;
    let elapsed = 0;
    // Verified previews judge affordability against the served upstream
    // balances — an upstream failure fails the preview closed instead of
    // answering against fixture money.
    for (const [path, errorBody] of [
      [quotePath, { error: "quote_unavailable" }],
      ["/bff/checks/preview?asset=USDT&amount=10", { error: "checks_unavailable" }]
    ]) {
      const callStartedAt = Date.now();
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 503, `${label} ${path}`);
      const text = await response.text();
      const callElapsed = Date.now() - callStartedAt;
      elapsed += callElapsed;
      assert.equal(text.includes(marker), false, label);
      assert.equal(text.includes(key), false, label);
      assert.equal(text.includes("syn_cust_"), false, label);
      assert.deepEqual(JSON.parse(text), errorBody, label);
      assert.ok(callElapsed < 3_500, `${label} ${path} took ${callElapsed} ms`);
    }
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    const gatedHits = upstream.length;
    for (const path of [quotePath, "/bff/checks/preview?asset=USDT&amount=10"]) {
      const gatedResponse = await call(app.base, path, { cookie });
      assert.equal(gatedResponse.status, 200, `${label} ${path}`);
      assert.equal((await readJson(gatedResponse)).kycRequired, true, `${label} ${path}`);
    }
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
    return elapsed;
  }

  async function localSurfacesStayLocal(label) {
    // Surfaces that never consult upstream must keep their exact local
    // contract during any degrade. Read-only pins only: this runs once per
    // failure mode, so any stateful write would accumulate side effects —
    // the write pins live in the dedicated local-writes test instead.
    const hits = upstream.length;
    const health = await call(app.base, "/bff/health");
    assert.equal(health.status, 200, label);
    assert.equal((await readJson(health)).mode, "dev-synthetic", label);
    assert.equal((await getJson(app, "/bff/session", cookie)).kyc, "kyc-gated", label);
    assert.equal((await getJson(app, "/bff/session", verifiedCookie)).kyc, "verified", label);
    const notificationsRead = await call(app.base, "/bff/notifications/read", { method: "POST", cookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(notificationsRead.status, 200, label);
    const fixtureCheck = await call(app.base, "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b", { cookie });
    assert.equal(fixtureCheck.status, 200, label);
    // revoke-others is intentionally absent here: the two sessions share one
    // subject, so it would evict the gated cookie the rest of the arm needs.
    assert.equal(upstream.length, hits, `${label}: a local-only surface consulted upstream`);
  }

  async function operationsFailsClosed(label) {
    const hits = upstream.length;
    const startedAt = Date.now();
    for (const path of ["/bff/operations", "/bff/operations/ope_0123456789abcdef01234567"]) {
      const callStartedAt = Date.now();
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 503, label);
      const text = await response.text();
      const callElapsed = Date.now() - callStartedAt;
      assert.equal(text.includes(marker), false, label);
      assert.equal(text.includes(key), false, label);
      assert.equal(text.includes("syn_cust_"), false, label);
      assert.equal(text.includes("ope_"), false, label);
      assert.deepEqual(JSON.parse(text), { error: "operations_unavailable" }, label);
      assert.ok(callElapsed < 3_500, `${label} ${path} took ${callElapsed} ms`);
    }
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 7_000, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    // A gated session never consults upstream: its local operations view
    // (empty for a gated subject) stays intact and leak-free.
    const gatedHits = upstream.length;
    const gatedResponse = await call(app.base, "/bff/operations", { cookie });
    assert.equal(gatedResponse.status, 200, label);
    const gatedText = await gatedResponse.text();
    assert.equal(gatedText.includes(marker), false, label);
    assert.equal(gatedText.includes(key), false, label);
    assert.equal(gatedText.includes("syn_cust_"), false, label);
    assert.equal(gatedText.includes("ope_"), false, label);
    assert.deepEqual(JSON.parse(gatedText), { operations: [] }, label);
    assert.equal(upstream.length, gatedHits, `${label}: gated session reached upstream`);
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
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
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
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
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
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
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
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function sessionsFailsClosed(label, sessionCookie) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/sessions", { cookie: sessionCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(/sess_[0-9a-f]/.test(text), false, label);
    assert.equal(text.includes("session_id"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "sessions_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  async function accountFailsClosed(label, sessionCookie) {
    const hits = upstream.length;
    const startedAt = Date.now();
    const response = await call(app.base, "/bff/account", { cookie: sessionCookie });
    assert.equal(response.status, 503, label);
    const text = await response.text();
    const elapsed = Date.now() - startedAt;
    assert.equal(text.includes(marker), false, label);
    assert.equal(text.includes(key), false, label);
    assert.equal(text.includes("syn_cust_"), false, label);
    assert.equal(/usr_[0-9a-f]/.test(text), false, label);
    assert.equal(text.includes("user_id"), false, label);
    assert.equal(text.includes("subject"), false, label);
    assert.deepEqual(JSON.parse(text), { error: "account_unavailable" }, label);
    assert.ok(elapsed < 3_500, `${label} took ${elapsed} ms`);
    assert.ok(upstream.length > hits, `${label}: upstream was never called`);
    return elapsed;
  }

  before(async () => {
    stub = createServer((request, response) => {
      const entry = { mode, closed: false, method: request.method ?? "", url: request.url ?? "", headers: request.headers };
      response.once("close", () => {
        entry.closed = true;
      });
      upstream.push(entry);
      // The real customer-api routes by method and path: the BFF only issues
      // GETs, so anything else is harness drift and answers 404 like the real
      // router rather than a fallback success body.
      if (request.method !== "GET") {
        send(response, 404, "application/json", JSON.stringify({ code: "NOT_FOUND", detail: marker }));
        return;
      }
      modes[mode](request, response);
    });
    stubBase = await listen(stub);
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
    // Stub self-check: an unmatched path or a non-GET method must not receive
    // a success body — it answers 404 like the real router, so a BFF that
    // drifts to the wrong upstream route fails closed instead of passing.
    const unknownPath = await fetch(`${stubBase}/api/v1/customer/no-such-operation`);
    assert.equal(unknownPath.status, 404);
    assert.deepEqual(await unknownPath.json(), { code: "NOT_FOUND", detail: marker });
    const wrongMethod = await fetch(`${stubBase}/api/v1/customer/wallets`, { method: "POST" });
    assert.equal(wrongMethod.status, 404);
    await wrongMethod.body?.cancel();
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
      { code: "USDT", available: "10.000000", hold: "0.000000", valueRub: "924.00" },
      { code: "TON", available: "5.000000000", hold: "0.500000000", valueRub: "1568.05" }
    ]);
    assert.equal(wallet.availableRub, "86549.50");
    assert.equal(wallet.holdRub, "142.55");
    assert.equal(wallet.totalRub, "86692.05");
    // The depositAddresses section is upstream-served only: the local wallet
    // view has no address data of its own, so the verified view must carry
    // the served contract records — adapted, never the raw snake_case body.
    assert.deepEqual(Object.keys(wallet).sort(), ["assets", "availableRub", "depositAddresses", "holdRub", "kyc", "totalRub"]);
    assert.deepEqual(wallet.depositAddresses, [
      {
        id: "dpa_0123456789abcdef01234567",
        asset: "TON",
        network: "TON_TESTNET",
        address: `kQ${"A".repeat(46)}`,
        status: "active",
        createdAt: Date.parse("2026-09-01T00:00:00.000Z"),
        posting: "none"
      },
      {
        id: "dpa_fedcba9876543210fedcba98",
        asset: "USDT",
        network: "TON_TESTNET",
        address: `kQ${"B".repeat(46)}`,
        status: "active",
        createdAt: Date.parse("2026-09-02T00:00:00.000Z"),
        posting: "none"
      },
      {
        id: "dpa_89abcdef0123456789abcdef",
        asset: "USDT",
        network: "TRON_TESTNET",
        address: tronTestnet,
        status: "active",
        createdAt: Date.parse("2026-09-03T00:00:00.000Z"),
        posting: "none"
      }
    ]);
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
    // The quotes list is KYC-gated the same way: only the verified session
    // consults upstream, and the adapted view keeps the indicative
    // not_supported entries read-only (posting stays "none").
    const quotes = await getJson(app, "/bff/quotes", verifiedCookie);
    assert.equal(quotes.mode, "test");
    assert.equal(quotes.kyc, "verified");
    assert.deepEqual(Object.keys(quotes).sort(), ["kyc", "mode", "quotes"]);
    assert.equal(quotes.quotes.length, 1);
    assert.deepEqual(Object.keys(quotes.quotes[0]).sort(), [
      "base",
      "baseAmount",
      "execution",
      "expiresAt",
      "feeAmount",
      "feeBps",
      "id",
      "issuedAt",
      "midPrice",
      "pair",
      "posting",
      "price",
      "priceObservedAt",
      "quote",
      "quoteAmount",
      "rounding",
      "side",
      "spreadBps",
      "status",
      "totalQuoteAmount",
      "ttlSeconds"
    ]);
    assert.equal(quotes.quotes[0].id, "qte_0123456789abcdef01234567");
    assert.equal(quotes.quotes[0].pair, "USDT/RUB");
    assert.equal(quotes.quotes[0].side, "sell");
    assert.equal(quotes.quotes[0].rounding, "down");
    assert.equal(quotes.quotes[0].status, "indicative");
    assert.equal(quotes.quotes[0].execution, "not_supported");
    assert.equal(quotes.quotes[0].posting, "none");
    const gatedQuotes = await getJson(app, "/bff/quotes", cookie);
    assert.equal(gatedQuotes.kyc, "kyc-gated");
    assert.equal(gatedQuotes.quotes.length, 0);
    // The exchange-orders list is KYC-gated like quotes: only the verified
    // session consults upstream, and the adapted view keeps the
    // non-executed not_supported orders read-only (posting stays "none").
    const orders = await getJson(app, "/bff/exchange-orders", verifiedCookie);
    assert.equal(orders.mode, "test");
    assert.equal(orders.kyc, "verified");
    assert.deepEqual(Object.keys(orders).sort(), ["kyc", "mode", "orders"]);
    assert.equal(orders.orders.length, 1);
    assert.deepEqual(Object.keys(orders.orders[0]).sort(), [
      "base",
      "baseAmount",
      "createdAt",
      "execution",
      "feeAmount",
      "feeBps",
      "id",
      "orderType",
      "pair",
      "posting",
      "price",
      "quote",
      "quoteAmount",
      "side",
      "status",
      "totalQuoteAmount",
      "updatedAt"
    ]);
    assert.equal(orders.orders[0].id, "ord_0123456789abcdef01234567");
    assert.equal(orders.orders[0].pair, "USDT/RUB");
    assert.equal(orders.orders[0].side, "sell");
    assert.equal(orders.orders[0].orderType, "limit");
    assert.equal(orders.orders[0].status, "open");
    assert.equal(orders.orders[0].execution, "not_supported");
    assert.equal(orders.orders[0].posting, "none");
    const gatedOrders = await getJson(app, "/bff/exchange-orders", cookie);
    assert.equal(gatedOrders.kyc, "kyc-gated");
    assert.equal(gatedOrders.orders.length, 0);
    // The trades list is KYC-gated like exchange-orders: only the verified
    // session consults upstream, and the adapted view keeps the recorded
    // engine fill legs read-only (posting stays "none").
    const trades = await getJson(app, "/bff/trades", verifiedCookie);
    assert.equal(trades.mode, "test");
    assert.equal(trades.kyc, "verified");
    assert.deepEqual(Object.keys(trades).sort(), ["kyc", "mode", "trades"]);
    assert.equal(trades.trades.length, 1);
    assert.deepEqual(Object.keys(trades.trades[0]).sort(), [
      "base",
      "executedAt",
      "execution",
      "feeAmount",
      "feeBps",
      "id",
      "liquidity",
      "orderId",
      "pair",
      "posting",
      "price",
      "quantity",
      "quote",
      "quoteAmount",
      "side",
      "totalQuoteAmount"
    ]);
    assert.equal(trades.trades[0].id, "trd_0123456789abcdef01234567");
    assert.equal(trades.trades[0].orderId, "ord_0123456789abcdef01234567");
    assert.equal(trades.trades[0].pair, "USDT/RUB");
    assert.equal(trades.trades[0].side, "sell");
    assert.equal(trades.trades[0].liquidity, "maker");
    assert.equal(trades.trades[0].execution, "not_supported");
    assert.equal(trades.trades[0].posting, "none");
    const gatedTrades = await getJson(app, "/bff/trades", cookie);
    assert.equal(gatedTrades.kyc, "kyc-gated");
    assert.equal(gatedTrades.trades.length, 0);
    // The markets view is KYC-gated like trades: only the verified session
    // consults upstream, and the adapted view keeps the instrument-scoped
    // book state read-only (posting stays "none").
    const markets = await getJson(app, "/bff/markets", verifiedCookie);
    assert.equal(markets.mode, "test");
    assert.equal(markets.kyc, "verified");
    assert.deepEqual(Object.keys(markets).sort(), ["kyc", "markets", "mode"]);
    assert.equal(markets.markets.length, 3);
    assert.deepEqual(Object.keys(markets.markets[0]).sort(), [
      "asOf",
      "base",
      "baseScale",
      "bestAsk",
      "bestBid",
      "instrument",
      "lastTrade",
      "posting",
      "priceScale",
      "quote",
      "quoteScale",
      "spreadBps"
    ]);
    assert.equal(markets.markets[0].instrument, "USDT/RUB");
    assert.equal(markets.markets[0].bestBid.price, "89.99000000");
    assert.equal(markets.markets[0].bestAsk.price, "90.01000000");
    assert.equal(markets.markets[0].lastTrade.price, "90.00000000");
    assert.equal(markets.markets[0].spreadBps, 2);
    assert.equal(markets.markets[0].posting, "none");
    // Canonical ORDER_PAIRS sequence: every declared pair reports exactly
    // once, in catalog order — the same pin the adapter enforces upstream.
    assert.deepEqual(
      markets.markets.map((m) => m.instrument),
      ["USDT/RUB", "TON/RUB", "TON/USDT"]
    );
    const gatedMarkets = await getJson(app, "/bff/markets", cookie);
    assert.equal(gatedMarkets.kyc, "kyc-gated");
    assert.equal(gatedMarkets.markets.length, 0);
    // The payments list is KYC-gated like exchange-orders: only the
    // verified session consults upstream, and the adapted view keeps the
    // outbound SBP observations read-only (posting stays "none").
    const payments = await getJson(app, "/bff/payments", verifiedCookie);
    assert.equal(payments.mode, "test");
    assert.equal(payments.kyc, "verified");
    assert.deepEqual(Object.keys(payments).sort(), ["kyc", "mode", "payments"]);
    assert.equal(payments.payments.length, 2);
    assert.deepEqual(Object.keys(payments.payments[0]).sort(), [
      "amount",
      "asset",
      "createdAt",
      "fee",
      "id",
      "method",
      "posting",
      "providerReference",
      "recipientReference",
      "status",
      "total",
      "updatedAt"
    ]);
    assert.equal(payments.payments[0].id, "pay_0123456789abcdef01234567");
    assert.equal(payments.payments[0].asset, "RUB");
    assert.equal(payments.payments[0].method, "sbp");
    assert.equal(payments.payments[0].status, "completed");
    assert.equal(payments.payments[0].providerReference, "SIMBANK0123456789ABCDEF");
    assert.equal(payments.payments[0].posting, "none");
    assert.equal(payments.payments[1].id, "pay_fedcba9876543210fedcba98");
    assert.equal(payments.payments[1].status, "created");
    assert.equal(payments.payments[1].providerReference, null);
    const gatedPayments = await getJson(app, "/bff/payments", cookie);
    assert.equal(gatedPayments.kyc, "kyc-gated");
    assert.equal(gatedPayments.payments.length, 0);
    // The cards list is KYC-gated like payments: only the verified session
    // consults upstream, and the adapted view carries only masked card
    // identifiers (last4 + token_reference — never a full PAN) with
    // posting "none".
    const cards = await getJson(app, "/bff/cards", verifiedCookie);
    assert.equal(cards.mode, "test");
    assert.equal(cards.kyc, "verified");
    assert.deepEqual(Object.keys(cards).sort(), ["cards", "kyc", "mode"]);
    assert.equal(cards.cards.length, 2);
    assert.deepEqual(Object.keys(cards.cards[0]).sort(), [
      "asset",
      "brand",
      "createdAt",
      "expiresAt",
      "id",
      "kind",
      "last4",
      "monthlyLimit",
      "posting",
      "status",
      "tokenReference",
      "updatedAt"
    ]);
    assert.equal(cards.cards[0].id, "crd_0123456789abcdef01234567");
    assert.equal(cards.cards[0].brand, "mir");
    assert.equal(cards.cards[0].kind, "physical");
    assert.equal(cards.cards[0].status, "active");
    assert.equal(cards.cards[0].last4, "4832");
    assert.equal(cards.cards[0].tokenReference, "tok_0123456789abcdef01234567");
    assert.equal(cards.cards[0].monthlyLimit, "250000.00");
    assert.equal(cards.cards[0].posting, "none");
    assert.equal(cards.cards[1].id, "crd_fedcba9876543210fedcba98");
    assert.equal(cards.cards[1].status, "pending_activation");
    assert.equal(cards.cards[1].updatedAt, cards.cards[1].createdAt);
    const gatedCards = await getJson(app, "/bff/cards", cookie);
    assert.equal(gatedCards.kyc, "kyc-gated");
    assert.equal(gatedCards.cards.length, 0);
    // The checks list carries the same KYC gate: only the verified session
    // consults upstream, and the adapted view carries only opaque check
    // references (chk_*) — never a claim code, claim URL or bearer token.
    // Direction comes from which side the subject sits on, timeline ends at
    // the upstream resolution, and a sender-side draft never appears.
    const checks = await getJson(app, "/bff/checks", verifiedCookie);
    assert.equal(checks.mode, "test");
    assert.deepEqual(Object.keys(checks).sort(), ["checks", "mode"]);
    assert.equal(checks.checks.length, 2);
    assert.deepEqual(Object.keys(checks.checks[0]).sort(), [
      "amount",
      "asset",
      "claimRule",
      "createdAt",
      "direction",
      "executable",
      "executionUnavailableReason",
      "expiresAt",
      "fee",
      "mode",
      "reference",
      "status",
      "timeline",
      "total"
    ]);
    assert.equal(checks.checks[0].reference, "chk_0123456789abcdef01234567");
    assert.equal(checks.checks[0].direction, "sent");
    assert.equal(checks.checks[0].status, "created");
    assert.equal(checks.checks[0].asset, "USDT");
    assert.equal(checks.checks[0].amount, "25.000000");
    assert.equal(checks.checks[0].fee, "0.075000");
    assert.equal(checks.checks[0].total, "25.075000");
    assert.equal(checks.checks[0].claimRule, "personal");
    assert.equal(checks.checks[0].executable, false);
    assert.equal(checks.checks[0].executionUnavailableReason, "dev_test_version");
    assert.equal(checks.checks[0].timeline.length, 1);
    assert.equal(checks.checks[1].reference, "chk_fedcba9876543210fedcba98");
    assert.equal(checks.checks[1].direction, "received");
    assert.equal(checks.checks[1].status, "claimed");
    assert.equal(checks.checks[1].total, "4.012000000");
    assert.equal(checks.checks[1].timeline.length, 2);
    assert.equal(checks.checks[1].timeline[1].status, "claimed");
    const gatedChecks = await getJson(app, "/bff/checks", cookie);
    assert.equal(gatedChecks.mode, "test");
    assert.equal(gatedChecks.checks.length, 5);
    // The activity feed carries the same KYC gate: only the verified
    // session consults upstream, and the adapted view keeps the served
    // item's id/title/detail/status verbatim under the "contract" kind —
    // the upstream snake_case fields never leak into the app view.
    const activity = await getJson(app, "/bff/activity", verifiedCookie);
    assert.equal(activity.mode, "test");
    assert.equal(activity.executable, false);
    assert.deepEqual(Object.keys(activity).sort(), ["executable", "items", "mode"]);
    assert.equal(activity.items.length, 2);
    assert.deepEqual(Object.keys(activity.items[0]).sort(), [
      "amount",
      "asset",
      "at",
      "contract",
      "detail",
      "executable",
      "id",
      "kind",
      "status",
      "title"
    ]);
    assert.equal(activity.items[0].kind, "contract");
    assert.equal(activity.items[0].id, "act_0123456789abcdef01234567");
    assert.equal(activity.items[0].contract, "deposit");
    assert.equal(activity.items[0].status, "payment_received");
    assert.equal(activity.items[0].title, "Deposit · payment received");
    assert.equal(activity.items[0].detail, "dep_0123456789abcdef01234567 payment received");
    assert.equal(activity.items[0].amount, "10.000000");
    assert.equal(activity.items[0].asset, "USDT");
    assert.equal(activity.items[0].at, Date.parse("2026-10-08T09:15:00.000Z"));
    assert.equal(activity.items[0].executable, false);
    assert.deepEqual(Object.keys(activity.items[1]).sort(), [
      "at",
      "contract",
      "detail",
      "executable",
      "id",
      "kind",
      "status",
      "title"
    ]);
    assert.equal(activity.items[1].contract, "security");
    assert.equal(activity.items[1].id, "act_fedcba9876543210fedcba98");
    const gatedActivity = await getJson(app, "/bff/activity", cookie);
    assert.equal(gatedActivity.mode, "test");
    assert.equal(gatedActivity.executable, false);
    assert.ok(gatedActivity.items.every((item) => item.kind !== "contract"));
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
    // The sessions list consults upstream for gated sessions too
    // (customer.auth.read is never denied): the adapted view carries only
    // live sign-ins — the revoked entry drops out — with sess_* handles and
    // exactly one current marker.
    const sessions = await getJson(app, "/bff/sessions", cookie);
    assert.equal(sessions.mode, "test");
    assert.equal(sessions.sessions.length, 2);
    assert.deepEqual(sessions.sessions.map((entry) => entry.handle), [
      "sess_0123456789abcdef01234567",
      "sess_fedcba9876543210fedcba98"
    ]);
    assert.deepEqual(sessions.sessions.map((entry) => entry.client), ["telegram", "dev-login"]);
    assert.deepEqual(sessions.sessions.map((entry) => entry.current), [true, false]);
    assert.equal(sessions.sessions[0].createdAt, Date.parse("2026-10-01T12:00:00.000Z"));
    assert.equal(sessions.sessions[0].lastSeenAt, Date.parse("2026-10-01T13:00:00.000Z"));
    assert.deepEqual(await getJson(app, "/bff/sessions", verifiedCookie), sessions);
    // The account record consults upstream for gated sessions too
    // (customer.users.read is never denied): the adapted view maps the
    // contract snake_case record onto the app's account shape.
    const account = await getJson(app, "/bff/account", cookie);
    assert.equal(account.mode, "test");
    assert.deepEqual(Object.keys(account).sort(), [
      "createdAt",
      "flags",
      "id",
      "mode",
      "status",
      "subject",
      "updatedAt"
    ]);
    assert.equal(account.id, "usr_0123456789abcdef01234567");
    assert.match(account.subject, /^syn_cust_[a-z0-9]{8,32}$/);
    assert.equal(account.status, "active");
    assert.deepEqual(account.flags, {
      termsAccepted: true,
      twoFactorEnabled: true,
      marketingOptIn: false
    });
    assert.equal(account.createdAt, Date.parse("2026-09-01T12:00:00.000Z"));
    assert.equal(account.updatedAt, Date.parse("2026-10-01T12:00:00.000Z"));
    assert.deepEqual(await getJson(app, "/bff/account", verifiedCookie), account);
    // The member reads: the verified session consults upstream per id and
    // receives the adapted view; an id the upstream does not own reports the
    // documented not_found, never a fabricated fixture row.
    const depth = await getJson(app, "/bff/markets/USDT%2FRUB", verifiedCookie);
    assert.deepEqual(depth, {
      mode: "test",
      instrument: "USDT/RUB",
      base: "USDT",
      quote: "RUB",
      bids: [{ price: "89.99000000", quantity: "25.000000", orderCount: 1 }],
      asks: [{ price: "90.01000000", quantity: "18.000000", orderCount: 1 }],
      lastTrade: { price: "90.00000000", quantity: "10.000000", executedAt: Date.parse("2026-10-02T14:05:00.000Z") },
      depthLevels: 1,
      baseScale: 6,
      quoteScale: 2,
      priceScale: 8,
      asOf: Date.parse("2026-10-02T14:10:00.000Z"),
      posting: "none"
    });
    const operation = await getJson(app, "/bff/operations/ope_0123456789abcdef01234567", verifiedCookie);
    assert.equal(operation.id, "ope_0123456789abcdef01234567");
    const check = await getJson(app, "/bff/checks/chk_0123456789abcdef01234567", verifiedCookie);
    assert.equal(check.reference, "chk_0123456789abcdef01234567");
    // Member ids the upstream does not own: the served list/lookup owns the
    // reference space, so a fixture-only or unknown reference is not_found.
    for (const path of [
      "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b",
      "/bff/operations/ope_deadbeef01234567890123",
      "/bff/markets/TON%2FRUB"
    ]) {
      const missing = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(missing.status, 404, path);
      assert.deepEqual(await readJson(missing), { error: "not_found" }, path);
    }
    // The gated member reads stay local: the fixture check resolves, depth
    // and unknown ids 404 — upstream is never consulted for any of it.
    const gatedHits = upstream.length;
    const gatedCheck = await call(app.base, "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b", { cookie });
    assert.equal(gatedCheck.status, 200);
    assert.equal((await readJson(gatedCheck)).reference, "chk_7f3a9c1e5d2b4f8a0e6c1d3b");
    for (const path of ["/bff/markets/USDT%2FRUB", "/bff/operations/ope_deadbeef01234567890123"]) {
      const missing = await call(app.base, path, { cookie });
      assert.equal(missing.status, 404, path);
      assert.deepEqual(await readJson(missing), { error: "not_found" }, path);
    }
    assert.equal(upstream.length, gatedHits, "a gated member read consulted upstream");
    // Every upstream request carries the contracted header set: the minted
    // synthetic bearer for the session subject, a v7 request id, the BFF's
    // client version and platform — and never a device id.
    assert.ok(upstream.length > 0, "the connected run never reached upstream");
    for (const entry of upstream) {
      // The two recorded requests that are not BFF-driven: the arm's own
      // unauthenticated probes of an unmatched path and a non-GET method.
      if (entry.url.endsWith("/no-such-operation") || entry.method !== "GET") continue;
      assert.match(entry.headers.authorization ?? "", /^Bearer scdev1\.syn_cust_[a-z0-9]{8,32}\.\d{10}\.[0-9a-f]{64}$/, entry.url);
      assert.match(entry.headers["x-request-id"] ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, entry.url);
      assert.equal(entry.headers["x-client-version"], "solidchange-miniapp-bff/0.1.0", entry.url);
      assert.equal(entry.headers["x-platform"], "telegram-mini-app", entry.url);
      assert.equal(entry.headers["x-device-id"], undefined, entry.url);
      assert.equal(entry.method, "GET", entry.url);
    }
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
    // A refused exchange-orders read degrades the same way: the verified
    // session falls back to the emptied list a gated session sees.
    const ordersResponse = await call(app.base, "/bff/exchange-orders", { cookie: verifiedCookie });
    assert.equal(ordersResponse.status, 200);
    const ordersText = await ordersResponse.text();
    assert.equal(ordersText.includes(marker), false);
    assert.equal(ordersText.includes(key), false);
    assert.equal(ordersText.includes("ord_"), false);
    const gatedOrdersDenied = await getJson(app, "/bff/exchange-orders", cookie);
    assert.deepEqual(JSON.parse(ordersText), gatedOrdersDenied);
    assert.equal(gatedOrdersDenied.kyc, "kyc-gated");
    // A refused trades read degrades the same way: the verified session
    // falls back to the emptied list a gated session sees.
    const tradesResponse = await call(app.base, "/bff/trades", { cookie: verifiedCookie });
    assert.equal(tradesResponse.status, 200);
    const tradesText = await tradesResponse.text();
    assert.equal(tradesText.includes(marker), false);
    assert.equal(tradesText.includes(key), false);
    assert.equal(tradesText.includes("trd_"), false);
    const gatedTradesDenied = await getJson(app, "/bff/trades", cookie);
    assert.deepEqual(JSON.parse(tradesText), gatedTradesDenied);
    assert.equal(gatedTradesDenied.kyc, "kyc-gated");
    // A refused markets read degrades the same way: the verified session
    // falls back to the emptied list a gated session sees.
    const marketsResponse = await call(app.base, "/bff/markets", { cookie: verifiedCookie });
    assert.equal(marketsResponse.status, 200);
    const marketsText = await marketsResponse.text();
    assert.equal(marketsText.includes(marker), false);
    assert.equal(marketsText.includes(key), false);
    const gatedMarketsDenied = await getJson(app, "/bff/markets", cookie);
    assert.deepEqual(JSON.parse(marketsText), gatedMarketsDenied);
    assert.equal(gatedMarketsDenied.kyc, "kyc-gated");
    // A refused payments read degrades the same way: the verified session
    // falls back to the emptied list a gated session sees.
    const paymentsResponse = await call(app.base, "/bff/payments", { cookie: verifiedCookie });
    assert.equal(paymentsResponse.status, 200);
    const paymentsText = await paymentsResponse.text();
    assert.equal(paymentsText.includes(marker), false);
    assert.equal(paymentsText.includes(key), false);
    assert.equal(paymentsText.includes("pay_"), false);
    const gatedPaymentsDenied = await getJson(app, "/bff/payments", cookie);
    assert.deepEqual(JSON.parse(paymentsText), gatedPaymentsDenied);
    assert.equal(gatedPaymentsDenied.kyc, "kyc-gated");
    // A refused cards read degrades the same way: the verified session falls
    // back to the emptied list a gated session sees.
    const cardsResponse = await call(app.base, "/bff/cards", { cookie: verifiedCookie });
    assert.equal(cardsResponse.status, 200);
    const cardsText = await cardsResponse.text();
    assert.equal(cardsText.includes(marker), false);
    assert.equal(cardsText.includes(key), false);
    assert.equal(cardsText.includes("crd_"), false);
    assert.equal(cardsText.includes("tok_"), false);
    const gatedCardsDenied = await getJson(app, "/bff/cards", cookie);
    assert.deepEqual(JSON.parse(cardsText), gatedCardsDenied);
    assert.equal(gatedCardsDenied.kyc, "kyc-gated");
    // A refused checks read degrades in place to the same local list a
    // gated session sees — the fixture entries, never upstream data.
    const checksResponse = await call(app.base, "/bff/checks", { cookie: verifiedCookie });
    assert.equal(checksResponse.status, 200);
    const checksText = await checksResponse.text();
    assert.equal(checksText.includes(marker), false);
    assert.equal(checksText.includes(key), false);
    assert.equal(checksText.includes("chk_0123456789abcdef01234567"), false);
    assert.equal(checksText.includes("chk_fedcba9876543210fedcba98"), false);
    assert.equal(checksText.includes("syn_peer_"), false);
    const gatedChecksDenied = await getJson(app, "/bff/checks", cookie);
    assert.deepEqual(JSON.parse(checksText), gatedChecksDenied);
    assert.equal(gatedChecksDenied.mode, "test");
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
      // customer.auth.read is never denied either, so a refused sessions read
      // is likewise contract drift: it fails closed for both session levels.
      const sessionsResponse = await call(app.base, "/bff/sessions", { cookie: sessionCookie });
      assert.equal(sessionsResponse.status, 503);
      assert.deepEqual(await readJson(sessionsResponse), { error: "sessions_unavailable" });
      // customer.users.read is never denied either, so a refused account
      // read is likewise contract drift: it fails closed for both session
      // levels.
      const accountResponse = await call(app.base, "/bff/account", { cookie: sessionCookie });
      assert.equal(accountResponse.status, 503);
      assert.deepEqual(await readJson(accountResponse), { error: "account_unavailable" });
    }
    // A refused quotes read degrades the same way: the verified session
    // falls back to the emptied list a gated session sees.
    const quotesDenied = await getJson(app, "/bff/quotes", verifiedCookie);
    assert.equal(quotesDenied.kyc, "kyc-gated");
    assert.equal(quotesDenied.quotes.length, 0);
    // A refused activity read degrades in place to the same local feed the
    // gated session sees (local outbox items only, no contract items).
    assert.deepEqual(await getJson(app, "/bff/activity", verifiedCookie), await getJson(app, "/bff/activity", cookie));
    // Refused operations list and member reads degrade in place: the list
    // empties and the member id is absent locally — never *_unavailable.
    assert.deepEqual(await getJson(app, "/bff/operations", verifiedCookie), { operations: [] });
    const opDenied = await call(app.base, "/bff/operations/ope_0123456789abcdef01234567", { cookie: verifiedCookie });
    assert.equal(opDenied.status, 404);
    assert.deepEqual(await readJson(opDenied), { error: "not_found" });
    // A refused screenings list read degrades in place to the local store
    // read (empty for this subject); the member read resolves through the
    // same local store.
    assert.deepEqual(await getJson(app, "/bff/address-screening", verifiedCookie), { mode: "test", screenings: [] });
    const scrDenied = await call(app.base, `/bff/address-screening/scr_${"0".repeat(32)}`, { cookie: verifiedCookie });
    assert.equal(scrDenied.status, 404);
    assert.deepEqual(await readJson(scrDenied), { error: "not_found" });
    // A refused markets member read degrades to the same 404 a gated session
    // sees — depth is never fabricated locally.
    const depthDenied = await call(app.base, "/bff/markets/USDT%2FRUB", { cookie: verifiedCookie });
    assert.equal(depthDenied.status, 404);
    assert.deepEqual(await readJson(depthDenied), { error: "not_found" });
    // A refused checks member read resolves through the local fixture: the
    // fixture reference renders, the upstream reference is absent.
    const fixtureDenied = await call(app.base, "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b", { cookie: verifiedCookie });
    assert.equal(fixtureDenied.status, 200);
    assert.equal((await readJson(fixtureDenied)).reference, "chk_7f3a9c1e5d2b4f8a0e6c1d3b");
    const unknownDenied = await call(app.base, "/bff/checks/chk_0123456789abcdef01234567", { cookie: verifiedCookie });
    assert.equal(unknownDenied.status, 404);
    assert.deepEqual(await readJson(unknownDenied), { error: "not_found" });
    // A refused notifications/read POST degrades to the local unread count.
    const ntfDenied = await call(app.base, "/bff/notifications/read", { method: "POST", cookie: verifiedCookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(ntfDenied.status, 200);
    const ntfDeniedBody = await readJson(ntfDenied);
    assert.equal(ntfDeniedBody.marked, 0);
    assert.equal(typeof ntfDeniedBody.unread, "number");
    // A refused affordability read keeps the previews honest: the verified
    // session previews against the zeroed gated answer (insufficient), never
    // fixture money.
    const quoteDenied = await getJson(app, quotePath, verifiedCookie);
    assert.equal(quoteDenied.kycRequired, false);
    assert.equal(quoteDenied.executable, false);
    assert.equal(quoteDenied.insufficientBalance, true);
    const checkPreviewDenied = await getJson(app, "/bff/checks/preview?asset=USDT&amount=10", verifiedCookie);
    assert.equal(checkPreviewDenied.kycRequired, false);
    assert.equal(checkPreviewDenied.insufficientBalance, true);
    assert.equal((await getJson(app, "/bff/session", verifiedCookie)).kyc, "verified");
  });

  it("degrades only the wallet deposit-addresses section on a scoped refusal", async () => {
    mode = "deposit_addresses_denied";
    // A refusal scoped to the deposit-addresses read degrades that section in
    // place: the balances stay LIVE (served values, not fixture money) while
    // the section empties — a whole-route 503 or a fixture address both fail.
    const wallet = await getJson(app, "/bff/wallet", verifiedCookie);
    assert.equal(wallet.kyc, "verified");
    assert.deepEqual(wallet.depositAddresses, []);
    assert.equal(wallet.availableRub, "86549.50");
    assert.deepEqual(wallet.assets[0], { code: "RUB", available: "84200.00", hold: "0.00", valueRub: "84200.00" });
    // The refusal stays scoped: sibling reads keep serving live data.
    assert.equal((await getJson(app, "/bff/deposits", verifiedCookie)).deposits[0].id, "dep_0123456789abcdef01234567");
  });

  it("keeps every member read's documented not-found semantics on an upstream 404", async () => {
    mode = "not_found";
    // An upstream 404 on a collection read is contract drift — the BFF
    // addresses collections by contract — so list surfaces fail closed.
    for (const [path, error] of [
      ["/bff/wallet", "wallet_unavailable"],
      ["/bff/deposits", "deposits_unavailable"],
      ["/bff/withdrawals", "withdrawals_unavailable"],
      ["/bff/quotes", "quotes_unavailable"],
      ["/bff/exchange-orders", "exchange_orders_unavailable"],
      ["/bff/trades", "trades_unavailable"],
      ["/bff/markets", "markets_unavailable"],
      ["/bff/payments", "payments_unavailable"],
      ["/bff/cards", "cards_unavailable"],
      ["/bff/checks", "checks_unavailable"],
      ["/bff/address-screening", "screening_unavailable"],
      ["/bff/activity", "activity_unavailable"],
      ["/bff/operations", "operations_unavailable"],
      ["/bff/notifications", "notifications_unavailable"],
      ["/bff/kyc/status", "kyc_unavailable"],
      ["/bff/profile", "profile_unavailable"],
      ["/bff/support/requests", "support_unavailable"],
      ["/bff/sessions", "sessions_unavailable"],
      ["/bff/account", "account_unavailable"]
    ]) {
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 503, path);
      assert.deepEqual(await readJson(response), { error }, path);
    }
    // On member paths the same upstream 404 is the documented "missing": each
    // route's own fallback — never a fabricated fixture row, never *_unavailable.
    for (const path of [
      "/bff/operations/ope_0123456789abcdef01234567",
      "/bff/markets/USDT%2FRUB"
    ]) {
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 404, path);
      assert.deepEqual(await readJson(response), { error: "not_found" }, path);
    }
    // The checks member resolves through the collection read, so an upstream
    // 404 there is the same collection drift: checks_unavailable, not a local
    // fixture detail.
    const checkResponse = await call(app.base, "/bff/checks/chk_0123456789abcdef01234567", { cookie: verifiedCookie });
    assert.equal(checkResponse.status, 503);
    assert.deepEqual(await readJson(checkResponse), { error: "checks_unavailable" });
    // The screening member falls back to the local store: a never-submitted
    // id is not_found…
    const absent = await call(app.base, `/bff/address-screening/scr_${"0".repeat(32)}`, { cookie: verifiedCookie });
    assert.equal(absent.status, 404);
    assert.deepEqual(await readJson(absent), { error: "not_found" });
    // …and a locally POST-submitted screening still renders from that store —
    // the POST stays local by contract, so its record survives the outage.
    const posted = await call(app.base, "/bff/address-screening", { method: "POST", cookie: verifiedCookie, body: screeningBody });
    assert.ok([200, 202].includes(posted.status));
    const postedView = await readJson(posted);
    const member = await call(app.base, `/bff/address-screening/${postedView.id}`, { cookie: verifiedCookie });
    assert.equal(member.status, 200);
    assert.equal((await readJson(member)).id, postedView.id);
    // Upstream-coupled POSTs and verified previews fail closed on the same
    // upstream 404; purely local surfaces stay local.
    const ntf = await call(app.base, "/bff/notifications/read", { method: "POST", cookie: verifiedCookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(ntf.status, 503);
    assert.deepEqual(await readJson(ntf), { error: "notifications_unavailable" });
    const quotePreview = await call(app.base, quotePath, { cookie: verifiedCookie });
    assert.equal(quotePreview.status, 503);
    assert.deepEqual(await readJson(quotePreview), { error: "quote_unavailable" });
    await localSurfacesStayLocal("not_found");
  });

  it("serves an emptied upstream collection as the live view, never a degrade", async () => {
    mode = "empty_lists";
    // Verified sessions get 200-with-empty on the upstream-owned collections —
    // distinguishable from both the gated fixture (5 local checks entries) and
    // a 503: "empty but live" is not a degrade.
    // The wallet read shares the fixed-catalog class: the wallets list is
    // the asset table and deposit-addresses the custody target set, so an
    // emptied body is drift — the whole route fails closed like
    // markets/sessions, never degrades to "empty but live".
    const wallet = await call(app.base, "/bff/wallet", { cookie: verifiedCookie });
    assert.equal(wallet.status, 503);
    assert.deepEqual(await readJson(wallet), { error: "wallet_unavailable" });
    for (const [path, member] of [
      ["/bff/deposits", "deposits"],
      ["/bff/withdrawals", "withdrawals"],
      ["/bff/quotes", "quotes"],
      ["/bff/exchange-orders", "orders"],
      ["/bff/trades", "trades"],
      ["/bff/payments", "payments"],
      ["/bff/cards", "cards"],
      ["/bff/notifications", "notifications"],
      ["/bff/support/requests", "requests"]
    ]) {
      const body = await getJson(app, path, verifiedCookie);
      assert.deepEqual(body[member], [], path);
    }
    // The min-one-entry feeds and the screening catalog answer the same
    // contract: emptied is drift, so the routes fail closed alongside
    // markets and sessions rather than serving an impossible list.
    for (const [path, error] of [
      ["/bff/activity", "activity_unavailable"],
      ["/bff/operations", "operations_unavailable"],
      ["/bff/address-screening", "screening_unavailable"]
    ]) {
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 503, path);
      assert.deepEqual(await readJson(response), { error }, path);
    }
    // The sessions collection shares the markets rule: the contract requires
    // exactly one current session — the caller's own — so an empty directory
    // is drift, not "empty but live": sessions_unavailable.
    const sessions = await call(app.base, "/bff/sessions", { cookie: verifiedCookie });
    assert.equal(sessions.status, 503);
    assert.deepEqual(await readJson(sessions), { error: "sessions_unavailable" });
    assert.deepEqual((await getJson(app, "/bff/checks", verifiedCookie)).checks, []);
    // The checks member read resolves through the (now empty) live list: the
    // upstream reference is absent — not_found, never the local fixture.
    const check = await call(app.base, "/bff/checks/chk_0123456789abcdef01234567", { cookie: verifiedCookie });
    assert.equal(check.status, 404);
    assert.deepEqual(await readJson(check), { error: "not_found" });
    // Member reads with their own upstream endpoints still answer live.
    assert.equal((await getJson(app, "/bff/operations/ope_0123456789abcdef01234567", verifiedCookie)).id, "ope_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/markets/USDT%2FRUB", verifiedCookie)).instrument, "USDT/RUB");
    // The markets collection is the exception: the contract requires every
    // declared instrument, so an empty list is drift — markets_unavailable.
    const markets = await call(app.base, "/bff/markets", { cookie: verifiedCookie });
    assert.equal(markets.status, 503);
    assert.deepEqual(await readJson(markets), { error: "markets_unavailable" });
    // Non-collection reads stay live too.
    assert.equal((await getJson(app, "/bff/profile", verifiedCookie)).apiAccess.status, "connected");
    assert.equal((await getJson(app, "/bff/kyc/status", verifiedCookie)).state, "rejected");
    assert.equal((await getJson(app, "/bff/account", verifiedCookie)).id, "usr_0123456789abcdef01234567");
  });

  it("wipes in-memory session state on restart and recovers into live data", async () => {
    mode = "valid";
    // The dev BFF's session store is memory — a documented volatile surface:
    // a restarted process must not resurrect the old cookie (a persisted
    // session would fail this pin), and a fresh login must serve live
    // upstream data, not a replayed degrade.
    const restarted = await startMiniapp({
      MINIAPP_CUSTOMER_API_URL: stubBase,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key
    });
    try {
      const stale = await call(restarted.base, "/bff/session", { cookie });
      assert.equal(stale.status, 401);
      assert.deepEqual(await readJson(stale), { error: "unauthenticated" });
      const fresh = await devLogin(restarted, "verified");
      const hits = upstream.length;
      const wallet = await getJson(restarted, "/bff/wallet", fresh);
      assert.equal(wallet.kyc, "verified");
      assert.equal(wallet.depositAddresses[0].id, "dpa_0123456789abcdef01234567");
      assert.ok(upstream.length > hits, "restarted BFF served data without consulting upstream");
    } finally {
      await closeServer(restarted.server);
    }
  });

  it("keeps local writes local during a degrade", async () => {
    mode = "server_error";
    // Degraded-write pins: a POST that touches only local state must apply
    // immediately (never silently queue for upstream), and each write's own
    // local read-back must render — while upstream is still failing.
    const hits = upstream.length;
    const support = await call(app.base, "/bff/support/requests", {
      method: "POST",
      cookie,
      body: { category: "question", topic: "synthetic resilience probe", message: "synthetic" }
    });
    assert.equal(support.status, 201);
    const ticket = await readJson(support);
    const member = await call(app.base, `/bff/support/requests/${ticket.id}`, { cookie });
    assert.equal(member.status, 200);
    const kycPost = await call(app.base, "/bff/kyc/applications", { method: "POST", cookie, body: {} });
    assert.ok([200, 202].includes(kycPost.status));
    const screening = await call(app.base, "/bff/address-screening", { method: "POST", cookie: verifiedCookie, body: screeningBody });
    assert.ok([200, 202].includes(screening.status));
    assert.equal(upstream.length, hits, "a local write consulted upstream");
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
      "invalid_utf8",
      "rate_limited",
      "validation_failed"
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
      await quotesFailsClosed(name);
      await exchangeOrdersFailsClosed(name);
      await tradesFailsClosed(name);
      await marketsFailsClosed(name);
      await marketsMemberFailsClosed(name);
      await paymentsFailsClosed(name);
      await cardsFailsClosed(name);
      await checksFailsClosed(name);
      await checkDetailFailsClosed(name);
      await screeningsFailsClosed(name);
      await screeningDetailFailsClosed(name);
      await activityFailsClosed(name);
      await operationsFailsClosed(name);
      await notificationsFailClosed(name);
      await notificationsReadFailsClosed(name);
      await previewsFailClosed(name);
      await localSurfacesStayLocal(name);
      await kycFailsClosed(`${name} verified`, verifiedCookie);
      await kycFailsClosed(`${name} gated`, cookie);
      await sessionsFailsClosed(`${name} verified`, verifiedCookie);
      await sessionsFailsClosed(`${name} gated`, cookie);
      await accountFailsClosed(`${name} verified`, verifiedCookie);
      await accountFailsClosed(`${name} gated`, cookie);
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
      await quotesFailsClosed(name);
      await exchangeOrdersFailsClosed(name);
      await tradesFailsClosed(name);
      await marketsFailsClosed(name);
      await paymentsFailsClosed(name);
      await cardsFailsClosed(name);
      await checksFailsClosed(name);
      await checkDetailFailsClosed(name);
      await marketsMemberFailsClosed(name);
      await screeningsFailsClosed(name);
      await screeningDetailFailsClosed(name);
      await activityFailsClosed(name);
      await operationsFailsClosed(name);
      await notificationsFailClosed(name);
      await notificationsReadFailsClosed(name);
      await previewsFailClosed(name);
      await kycFailsClosed(`${name} verified`, verifiedCookie);
      await kycFailsClosed(`${name} gated`, cookie);
      await sessionsFailsClosed(`${name} verified`, verifiedCookie);
      await sessionsFailsClosed(`${name} gated`, cookie);
      await accountFailsClosed(`${name} verified`, verifiedCookie);
      await accountFailsClosed(`${name} gated`, cookie);
      await upstreamReleased(name);
      await assertGated(app, cookie, name);
    }
  });

  it("recovers once upstream answers correctly again", async () => {
    mode = "valid";
    // "Live again" means upstream-served values and fresh upstream hits —
    // a BFF that recovers into permanently cached degraded data goes red on
    // both pins, not just on "200 again".
    const hits = upstream.length;
    const profile = await getJson(app, "/bff/profile", cookie);
    assert.equal(profile.apiAccess.status, "connected");
    assert.equal(profile.displayName, "Customer ab12cd34");
    const recoveredWallet = await getJson(app, "/bff/wallet", verifiedCookie);
    assert.equal(recoveredWallet.kyc, "verified");
    assert.equal(recoveredWallet.depositAddresses[0].id, "dpa_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/deposits", verifiedCookie)).deposits[0].id, "dep_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/withdrawals", verifiedCookie)).withdrawals[0].id, "wdr_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/quotes", verifiedCookie)).quotes[0].id, "qte_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/exchange-orders", verifiedCookie)).orders[0].id, "ord_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/trades", verifiedCookie)).trades[0].id, "trd_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/markets", verifiedCookie)).markets[0].instrument, "USDT/RUB");
    assert.equal((await getJson(app, "/bff/payments", verifiedCookie)).payments[0].id, "pay_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/cards", verifiedCookie)).cards[0].id, "crd_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/notifications", verifiedCookie)).mode, "test");
    assert.equal((await getJson(app, "/bff/kyc/status", cookie)).state, "rejected");
    assert.equal((await getJson(app, "/bff/support/requests", cookie)).requests[0].id, "tck_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/sessions", cookie)).sessions[0].handle, "sess_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/account", cookie)).id, "usr_0123456789abcdef01234567");
    // Member reads are live again too — an id only the real upstream serves.
    assert.equal((await getJson(app, "/bff/operations/ope_0123456789abcdef01234567", verifiedCookie)).id, "ope_0123456789abcdef01234567");
    assert.equal((await getJson(app, "/bff/markets/USDT%2FRUB", verifiedCookie)).instrument, "USDT/RUB");
    assert.equal((await getJson(app, "/bff/checks/chk_0123456789abcdef01234567", verifiedCookie)).reference, "chk_0123456789abcdef01234567");
    assert.ok(upstream.length > hits, "recovery served cached data — upstream was never called");
  });

  it("evicts every other session of the subject on revoke-others", async () => {
    // State-divergence pin: dev sessions share one subject across kyc levels,
    // so revoke-others must evict every sibling — including the shared gated
    // and verified cookies. Runs last: nothing else in the suite may depend
    // on those cookies afterwards.
    const evictor = await devLogin(app, "verified");
    const victim = await devLogin(app, "kyc-gated");
    const response = await call(app.base, "/bff/sessions/revoke-others", { method: "POST", cookie: evictor, body: {} });
    assert.equal(response.status, 200);
    for (const stale of [victim, cookie, verifiedCookie]) {
      const session = await call(app.base, "/bff/session", { cookie: stale });
      assert.equal(session.status, 401);
      assert.deepEqual(await readJson(session), { error: "unauthenticated" });
    }
    // The evictor itself stays live — the current session is never revoked.
    assert.equal((await getJson(app, "/bff/session", evictor)).kyc, "verified");
  });
});

describe("Mini App BFF with an unreachable customer-api", () => {
  const key = randomBytes(32).toString("hex");

  async function assertUnavailable(app, label) {
    const gatedCookie = await devLogin(app, "kyc-gated");
    const verifiedCookie = await devLogin(app, "verified");
    // The never-denied surfaces consult upstream for either session level —
    // an unreachable customer-api fails them closed outright for both.
    for (const sessionCookie of [gatedCookie, verifiedCookie]) {
      for (const [path, error] of [
        ["/bff/profile", "profile_unavailable"],
        ["/bff/support/requests", "support_unavailable"],
        ["/bff/sessions", "sessions_unavailable"],
        ["/bff/account", "account_unavailable"],
        ["/bff/kyc/status", "kyc_unavailable"]
      ]) {
        const response = await call(app.base, path, { cookie: sessionCookie });
        assert.equal(response.status, 503, `${label} ${path}`);
        assert.deepEqual(await readJson(response), { error }, `${label} ${path}`);
      }
    }
    // The verified session's KYC-gated surfaces fail closed too — a BFF that
    // treats "connection refused" as "denied" would answer these in place
    // with the gated fixture, and "not configured" with the local view.
    for (const [path, error] of [
      ["/bff/wallet", "wallet_unavailable"],
      ["/bff/deposits", "deposits_unavailable"],
      ["/bff/withdrawals", "withdrawals_unavailable"],
      ["/bff/quotes", "quotes_unavailable"],
      ["/bff/exchange-orders", "exchange_orders_unavailable"],
      ["/bff/trades", "trades_unavailable"],
      ["/bff/markets", "markets_unavailable"],
      ["/bff/payments", "payments_unavailable"],
      ["/bff/cards", "cards_unavailable"],
      ["/bff/checks", "checks_unavailable"],
      ["/bff/address-screening", "screening_unavailable"],
      ["/bff/activity", "activity_unavailable"],
      ["/bff/operations", "operations_unavailable"],
      ["/bff/notifications", "notifications_unavailable"]
    ]) {
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 503, `${label} verified ${path}`);
      assert.deepEqual(await readJson(response), { error }, `${label} verified ${path}`);
    }
    // The verified member reads fail closed with the sibling shape — never a
    // fabricated fixture row and never the local not-found.
    for (const [path, error] of [
      ["/bff/operations/ope_0123456789abcdef01234567", "operations_unavailable"],
      ["/bff/markets/USDT%2FRUB", "markets_unavailable"],
      ["/bff/checks/chk_0123456789abcdef01234567", "checks_unavailable"],
      [`/bff/address-screening/scr_${"0".repeat(32)}`, "screening_unavailable"]
    ]) {
      const response = await call(app.base, path, { cookie: verifiedCookie });
      assert.equal(response.status, 503, `${label} verified ${path}`);
      assert.deepEqual(await readJson(response), { error }, `${label} verified ${path}`);
    }
    // Upstream-coupled POSTs and verified previews fail closed too: the
    // unread count is reported from the contract feed and affordability from
    // the served balances — an outage must not answer either locally.
    const ntf = await call(app.base, "/bff/notifications/read", { method: "POST", cookie: verifiedCookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(ntf.status, 503, label);
    assert.deepEqual(await readJson(ntf), { error: "notifications_unavailable" }, label);
    const quotePreview = await call(app.base, quotePath, { cookie: verifiedCookie });
    assert.equal(quotePreview.status, 503, label);
    assert.deepEqual(await readJson(quotePreview), { error: "quote_unavailable" }, label);
    const checkPreview = await call(app.base, "/bff/checks/preview?asset=USDT&amount=10", { cookie: verifiedCookie });
    assert.equal(checkPreview.status, 503, label);
    assert.deepEqual(await readJson(checkPreview), { error: "checks_unavailable" }, label);
    // Local surfaces keep their exact contract during the outage: the dev
    // login and the session store run inside the BFF, the provider
    // simulators run inside the BFF, and the local-only POSTs must not
    // silently queue or fail on upstream state. assertGated covers the
    // gated local reads.
    const health = await call(app.base, "/bff/health");
    assert.equal(health.status, 200, label);
    assert.equal((await readJson(health)).mode, "dev-synthetic", label);
    assert.equal((await getJson(app, "/bff/session", gatedCookie)).kyc, "kyc-gated", label);
    assert.equal((await getJson(app, "/bff/session", verifiedCookie)).kyc, "verified", label);
    const supportPost = await call(app.base, "/bff/support/requests", {
      method: "POST",
      cookie: gatedCookie,
      body: { category: "question", topic: "synthetic resilience probe", message: "synthetic" }
    });
    assert.equal(supportPost.status, 201, label);
    const kycPost = await call(app.base, "/bff/kyc/applications", { method: "POST", cookie: gatedCookie, body: {} });
    assert.ok([200, 202].includes(kycPost.status), label);
    const screeningPost = await call(app.base, "/bff/address-screening", { method: "POST", cookie: verifiedCookie, body: screeningBody });
    assert.ok([200, 202].includes(screeningPost.status), label);
    const screeningView = await readJson(screeningPost);
    // The member read still fails closed: "unavailable" never falls back to
    // the local store (only denied/missing do) — even a record the local
    // submit just created is not served on its local id alone.
    const screeningMember = await call(app.base, `/bff/address-screening/${screeningView.id}`, { cookie: verifiedCookie });
    assert.equal(screeningMember.status, 503, label);
    assert.deepEqual(await readJson(screeningMember), { error: "screening_unavailable" }, label);
    const ntfLocal = await call(app.base, "/bff/notifications/read", { method: "POST", cookie: gatedCookie, body: { ids: "ntf_0123456789abcdef01234567" } });
    assert.equal(ntfLocal.status, 200, label);
    const gatedQuote = await call(app.base, quotePath, { cookie: gatedCookie });
    assert.equal(gatedQuote.status, 200, label);
    const gatedCheckPreview = await call(app.base, "/bff/checks/preview?asset=USDT&amount=10", { cookie: gatedCookie });
    assert.equal(gatedCheckPreview.status, 200, label);
    await assertGated(app, gatedCookie, label);
    // Sessions share one subject across kyc levels, so this evicts the gated
    // session too — it runs last, after every gated pin above.
    const revoke = await call(app.base, "/bff/sessions/revoke-others", { method: "POST", cookie: verifiedCookie, body: {} });
    assert.equal(revoke.status, 200, label);
  }

  it("fails closed when customer-api was never started", async () => {
    const port = await freePort();
    const app = await startMiniapp({
      MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${port}`,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key
    });
    try {
      await assertUnavailable(app, "never started");
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
      await assertUnavailable(app, "refusing");
    } finally {
      await closeServer(app.server);
      // closeAllConnections only covers tracked sockets; the refusing
      // server's destroyed sockets need the explicit close.
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
      await assertUnavailable(app, "killed");
    } finally {
      // The kill is idempotent: a failing pin before the SIGKILL must still
      // reap the child — a leaked listener hangs the whole runner.
      customerApi.child.kill("SIGKILL");
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
    assert.match(result.stderr, /refused to start: Audit storage is unavailable/);
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
        "/bff/api/reports/kyc-queue-daily/export",
        // Every read route that appends an audit event fails closed too —
        // the check/support/withdrawal detail reads and the subject timeline
        // append their own *.viewed events before signing.
        "/bff/api/checks/CHK-771312",
        "/bff/api/support/SUP-384120",
        "/bff/api/withdrawals/WDR-991804",
        "/bff/api/subjects/sim-alina-mironova/timeline"
      ]) {
        await assertAuditUnavailable(base, path, cookie);
      }
      // The outage closes only the audited routes: collection reads that
      // never touch the audit store keep serving — the degrade is scoped,
      // not a whole-BFF shutdown.
      for (const path of [
        "/bff/api/checks",
        "/bff/api/support",
        "/bff/api/withdrawals",
        "/bff/api/reports",
        "/bff/api/kyc",
        "/bff/api/aml",
        "/bff/api/investigations",
        "/bff/api/fraud-alerts",
        "/bff/api/approvals"
      ]) {
        const listing = await call(base, path, { cookie });
        assert.equal(listing.status, 200, path);
        await listing.body?.cancel();
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
      // Every other read route that appends an audit event fails closed too:
      // a silent append would serve the signed view without the record.
      for (const path of [
        "/bff/api/checks/CHK-771312",
        "/bff/api/support/SUP-384120",
        "/bff/api/withdrawals/WDR-991804",
        "/bff/api/subjects/sim-alina-mironova/timeline"
      ]) {
        await assertAuditUnavailable(base, path, cookie);
      }
      // Append failure closes only appending routes: snapshot-only reads —
      // the collection lists and the audit views themselves — stay live.
      for (const path of [
        "/bff/api/checks",
        "/bff/api/support",
        "/bff/api/withdrawals",
        "/bff/api/audit",
        "/bff/api/audit/export",
        "/bff/api/kyc"
      ]) {
        const live = await call(base, path, { cookie });
        assert.equal(live.status, 200, path);
        await live.body?.cancel();
      }
      assert.equal((await store.snapshot()).status.length, before);
    } finally {
      await closeServer(server);
    }
  });
});
