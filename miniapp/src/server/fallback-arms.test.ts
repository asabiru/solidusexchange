import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { CheckPreview, CheckView, ChecksView, QuotePreview } from "../shared/api.js";
import { createCheckBook } from "./checks.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  type CustomerApiCheck,
  type CustomerApiClient,
  type CustomerApiWallet,
  createCustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
import { createNotificationOutbox } from "./notifications.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const now = 1_790_000_000_000;
const devSubject = `dev-${createHash("sha256")
  .update("solidchange-miniapp-dev-synthetic|900000001")
  .digest("hex")
  .slice(0, 16)}`;
const upstreamSubject = customerApiSubject(devSubject);
const localBook = createCheckBook({ clock: () => now });
// The received-but-unclaimed fixture is the discriminating one: its gated
// view reads awaiting_recipient_kyc where the verified view reads created.
const fixtureCheckId = "chk_2b8d4f6a0c1e3b5d7f9a2c4e";
const upstreamCheckId = "chk_aaaaaaaabbbbbbbbcccccccc";

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }),
    ...overrides
  };
}

interface Running {
  base: string;
  close: () => Promise<void>;
}

type StubOverrides = Partial<CustomerApiClient>;

// Records every method call into `calls`, including overridden members, so a
// test can pin exactly which upstream reads a fallback arm performs.
function stubClient(overrides: StubOverrides = {}, calls: string[] = []): CustomerApiClient {
  const merged: Record<string, unknown> = {
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "not-configured" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    trades: async () => ({ status: "not-configured" }),
    markets: async () => ({ status: "not-configured" }),
    marketDepth: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
    depositAddresses: async () => ({ status: "not-configured" }),
    addressScreenings: async () => ({ status: "not-configured" }),
    addressScreening: async () => ({ status: "missing" }),
    activity: async () => ({ status: "not-configured" }),
    operations: async () => ({ status: "not-configured" }),
    operation: async () => ({ status: "not-configured" }),
    users: async () => ({ status: "not-configured" })
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== "configured" && value !== undefined) merged[key] = value;
  }
  const client: Record<string, unknown> = { configured: true };
  for (const [key, fn] of Object.entries(merged)) {
    client[key] = (...args: unknown[]) => {
      calls.push(key);
      return (fn as (...args: unknown[]) => unknown)(...args);
    };
  }
  return client as unknown as CustomerApiClient;
}

interface StartOptions {
  customerApi?: CustomerApiClient;
  notifications?: ReturnType<typeof createNotificationOutbox>;
}

async function start(serverConfig: ServerConfig, options: StartOptions = {}): Promise<Running> {
  const server = createMiniappServer(serverConfig, {
    clock: () => now,
    ...(options.customerApi ? { customerApi: options.customerApi } : {}),
    ...(options.notifications ? { notifications: options.notifications } : {})
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown, cookie?: string) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
}

function upstreamCheck(overrides: Partial<CustomerApiCheck> = {}): CustomerApiCheck {
  return {
    check_id: upstreamCheckId,
    check_type: "personal",
    status: "created",
    sender_ref: upstreamSubject,
    recipient_ref: "syn_peer_0123456789ab",
    amount: "25.000000",
    asset: "USDT",
    fee_amount: "0.075000",
    outstanding_amount: "25.000000",
    created_at: "2026-10-08T09:15:00.000Z",
    expires_at: "2026-10-11T09:15:00.000Z",
    resolved_at: null,
    posting: "none",
    ...overrides
  };
}

function upstreamWallet(asset: CustomerApiWallet["asset"], available: string): CustomerApiWallet {
  return { wallet_id: `wal_${asset.toLowerCase()}`, asset, available, hold: "0" };
}

describe("GET /bff/checks/:id fallback arms", () => {
  it("resolves an upstream check id from the contract list, not the fixtures", async () => {
    const calls: string[] = [];
    const client = stubClient({
      checks: async () => ({ status: "ok", checks: [upstreamCheck()] })
    }, calls);
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const list = await (await get(running.base, "/bff/checks", cookie)).json() as ChecksView;
      assert.equal(list.checks.length, 1);
      const response = await get(running.base, `/bff/checks/${upstreamCheckId}`, cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json() as CheckView, list.checks[0]);
      assert.deepEqual(calls, ["checks", "checks"]);
    } finally {
      await running.close();
    }
  });

  it("answers 404 for a fixture check id the upstream list does not serve", async () => {
    const calls: string[] = [];
    const client = stubClient({
      checks: async () => ({ status: "ok", checks: [upstreamCheck()] })
    }, calls);
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      // The fixture id is in the local book and renders for the unconfigured
      // arm, but the contract list owns the reference space upstream: the
      // detail must not resurrect rows the list does not show.
      const response = await get(running.base, `/bff/checks/${fixtureCheckId}`, cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.deepEqual(calls, ["checks"]);
    } finally {
      await running.close();
    }
  });

  it("fails closed as checks_unavailable when the upstream list is down", async () => {
    const client = stubClient({
      checks: async () => ({ status: "unavailable" })
    });
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, `/bff/checks/${fixtureCheckId}`, cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes("chk_"), false);
      assert.deepEqual(JSON.parse(text), { error: "checks_unavailable" });
    } finally {
      await running.close();
    }
  });

  it("degrades an upstream refusal to the same gated fixture detail the list shows", async () => {
    const client = stubClient({
      checks: async () => ({ status: "denied" })
    });
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const list = await (await get(running.base, "/bff/checks", cookie)).json() as ChecksView;
      const response = await get(running.base, `/bff/checks/${fixtureCheckId}`, cookie);
      assert.equal(response.status, 200);
      const detail = await response.json() as CheckView;
      const gated = list.checks.find((check) => check.reference === fixtureCheckId);
      assert.ok(gated, "the gated list must contain the fixture the detail renders");
      assert.deepEqual(detail, gated);
      assert.equal(detail.status, "awaiting_recipient_kyc", "the degraded detail keeps the gated status");
    } finally {
      await running.close();
    }
  });

  it("keeps the fixture detail for gated and unconfigured sessions without consulting upstream", async () => {
    const calls: string[] = [];
    const client = stubClient({
      checks: async () => ({ status: "unavailable" })
    }, calls);
    const running = await start(config(), { customerApi: client });
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await get(running.base, `/bff/checks/${fixtureCheckId}`, gatedCookie);
      assert.equal(gated.status, 200);
      assert.deepEqual(await gated.json() as CheckView, localBook.view(fixtureCheckId, "kyc-gated"));
      assert.equal(calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
    const unconfigured = await start(config());
    try {
      const cookie = await devLogin(unconfigured.base, "verified");
      const response = await get(unconfigured.base, `/bff/checks/${fixtureCheckId}`, cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json() as CheckView, localBook.view(fixtureCheckId, "verified"));
    } finally {
      await unconfigured.close();
    }
  });
});

describe("preview affordability fallback arms", () => {
  const quotePath = "/bff/quotes/preview?from=USDT&to=RUB&amount=10.000000";
  const checkPath = "/bff/checks/preview?asset=USDT&amount=10.000000";

  it("judges a verified preview against the served upstream balance, not the fixtures", async () => {
    const calls: string[] = [];
    const client = stubClient({
      wallets: async () => ({ status: "ok", wallets: [upstreamWallet("USDT", "1.000000")] })
    }, calls);
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const quote = await (await get(running.base, quotePath, cookie)).json() as QuotePreview;
      assert.equal(quote.insufficientBalance, true, "1 USDT upstream cannot cover a 10 USDT preview");
      const preview = await (await get(running.base, checkPath, cookie)).json() as CheckPreview;
      assert.equal(preview.insufficientBalance, true);
      assert.deepEqual(calls, ["wallets", "wallets"]);
    } finally {
      await running.close();
    }
  });

  it("treats an asset missing from the served wallets as a zero balance", async () => {
    const client = stubClient({
      wallets: async () => ({ status: "ok", wallets: [upstreamWallet("TON", "50.000000000")] })
    });
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const quote = await (await get(running.base, quotePath, cookie)).json() as QuotePreview;
      assert.equal(quote.insufficientBalance, true);
      const preview = await (await get(running.base, checkPath, cookie)).json() as CheckPreview;
      assert.equal(preview.insufficientBalance, true);
    } finally {
      await running.close();
    }
  });

  it("fails closed when the upstream wallet read is refused", async () => {
    const client = stubClient({
      wallets: async () => ({ status: "denied" })
    });
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const quote = await (await get(running.base, quotePath, cookie)).json() as QuotePreview;
      assert.equal(quote.insufficientBalance, true, "a refused balance degrades to the gated zero answer");
      const preview = await (await get(running.base, checkPath, cookie)).json() as CheckPreview;
      assert.equal(preview.insufficientBalance, true);
    } finally {
      await running.close();
    }
  });

  it("answers the *_unavailable shape when the upstream wallet read is down", async () => {
    const client = stubClient({
      wallets: async () => ({ status: "unavailable" })
    });
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const quoteResponse = await get(running.base, quotePath, cookie);
      assert.equal(quoteResponse.status, 503);
      assert.deepEqual(await quoteResponse.json(), { error: "quote_unavailable" });
      const checkResponse = await get(running.base, checkPath, cookie);
      assert.equal(checkResponse.status, 503);
      assert.deepEqual(await checkResponse.json(), { error: "checks_unavailable" });
    } finally {
      await running.close();
    }
  });

  it("keeps the fixture balance for gated and unconfigured sessions without consulting upstream", async () => {
    const calls: string[] = [];
    const client = stubClient({
      wallets: async () => ({ status: "unavailable" })
    }, calls);
    const running = await start(config(), { customerApi: client });
    try {
      const gated = await devLogin(running.base, "kyc-gated");
      const quote = await (await get(running.base, quotePath, gated)).json() as QuotePreview;
      assert.equal(quote.kycRequired, true);
      assert.equal(quote.insufficientBalance, true, "the gated fixture balance is zero");
      assert.equal(calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
    const unconfigured = await start(config());
    try {
      const cookie = await devLogin(unconfigured.base, "verified");
      const quote = await (await get(unconfigured.base, quotePath, cookie)).json() as QuotePreview;
      assert.equal(quote.insufficientBalance, false, "the 482.18 USDT fixture covers a 10 USDT preview");
      const preview = await (await get(unconfigured.base, checkPath, cookie)).json() as CheckPreview;
      assert.equal(preview.insufficientBalance, false);
    } finally {
      await unconfigured.close();
    }
  });
});

describe("POST /bff/notifications/read fallback arms", () => {
  function outboxWithDraft() {
    const outbox = createNotificationOutbox({ clock: () => now });
    const draft = outbox.record(devSubject, "support_received");
    return { outbox, draft };
  }

  it("reports the served unread count when the contract feed owns the list", async () => {
    const { outbox, draft } = outboxWithDraft();
    const calls: string[] = [];
    const client = stubClient({
      notifications: async () => ({ status: "ok", unread: 7, notifications: [] })
    }, calls);
    const running = await start(config(), { customerApi: client, notifications: outbox });
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await post(running.base, "/bff/notifications/read", { ids: draft.id }, cookie);
      assert.equal(response.status, 200);
      // The marks still land in the local outbox (the only store the command
      // can write) but the reported count follows the displayed feed. The
      // remaining local unread is the session_login draft from devLogin.
      assert.deepEqual(await response.json(), { marked: 1, unread: 7 });
      assert.equal(outbox.unread(devSubject), 1);
      assert.deepEqual(calls, ["notifications"]);
    } finally {
      await running.close();
    }
  });

  it("reports marked: 0 for upstream notification ids without masking the served count", async () => {
    const { outbox } = outboxWithDraft();
    const client = stubClient({
      notifications: async () => ({ status: "ok", unread: 3, notifications: [] })
    });
    const running = await start(config(), { customerApi: client, notifications: outbox });
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await post(
        running.base,
        "/bff/notifications/read",
        { ids: "ntf_00112233445566778899aabb" },
        cookie
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { marked: 0, unread: 3 });
    } finally {
      await running.close();
    }
  });

  it("degrades to the local response on an upstream refusal", async () => {
    const { outbox, draft } = outboxWithDraft();
    const client = stubClient({
      notifications: async () => ({ status: "denied" })
    });
    const running = await start(config(), { customerApi: client, notifications: outbox });
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await post(running.base, "/bff/notifications/read", { ids: draft.id }, cookie);
      assert.equal(response.status, 200);
      // Local unread keeps the still-unread session_login draft from devLogin.
      assert.deepEqual(await response.json(), { marked: 1, unread: 1 });
    } finally {
      await running.close();
    }
  });

  it("answers notifications_unavailable when the upstream feed is down", async () => {
    const { outbox, draft } = outboxWithDraft();
    const client = stubClient({
      notifications: async () => ({ status: "unavailable" })
    });
    const running = await start(config(), { customerApi: client, notifications: outbox });
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await post(running.base, "/bff/notifications/read", { ids: draft.id }, cookie);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "notifications_unavailable" });
      // The mark still applied: marks are local writes; only the reported
      // count needed the feed that failed.
      assert.equal(outbox.unread(devSubject), 1);
    } finally {
      await running.close();
    }
  });

  it("keeps the local response for gated sessions without consulting upstream", async () => {
    const { outbox, draft } = outboxWithDraft();
    const calls: string[] = [];
    const client = stubClient({
      notifications: async () => ({ status: "unavailable" })
    }, calls);
    const running = await start(config(), { customerApi: client, notifications: outbox });
    try {
      const gated = await devLogin(running.base, "kyc-gated");
      const response = await post(running.base, "/bff/notifications/read", { ids: draft.id }, gated);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { marked: 1, unread: 1 });
      assert.equal(calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });
});

describe("fallback id namespace pins", () => {
  it("resolves a malformed screening id locally without spending an upstream call", async () => {
    // The real client (not a stub) must short-circuit ids that cannot parse
    // upstream — mirroring operation() — before the request burns a slot on
    // the shared upstream rate limit.
    const seen: string[] = [];
    const upstream = createServer((request, response) => {
      seen.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({}));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const running = await start(config(), {
      customerApi: createCustomerApiClient({ baseUrl, devTokenKey: randomBytes(32).toString("hex") })
    });
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/address-screening/not-a-screening-id", cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.deepEqual(seen, [], "a malformed id must not reach upstream");
    } finally {
      await running.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("keeps the support detail local-only: an upstream ticket id 404s while the list serves it", async () => {
    const ticketId = "tck_00112233445566778899aabb";
    const calls: string[] = [];
    const client = stubClient({
      support: async () => ({
        status: "ok",
        view: {
          mode: "test",
          delivery: "disabled",
          tickets: [
            {
              ticket_id: ticketId,
              category: "question",
              topic: "Upstream ticket",
              message: "Served by the contract list only",
              status: "in_review",
              timeline: [{ status: "received", at: "2026-10-08T09:15:00.000Z" }],
              complaint_acknowledged: false,
              created_at: "2026-10-08T09:15:00.000Z",
              expires_at: "2026-10-09T09:15:00.000Z"
            }
          ]
        }
      })
    }, calls);
    const running = await start(config(), { customerApi: client });
    try {
      const cookie = await devLogin(running.base, "verified");
      const list = await get(running.base, "/bff/support/requests", cookie);
      assert.equal(list.status, 200);
      assert.equal((await list.text()).includes(ticketId), true, "the upstream list serves the ticket");
      // The detail read is deliberately local-only: POST-created sup_* drafts
      // render, upstream tck_* ids resolve nowhere locally — the route does
      // not even ask upstream for them.
      const detail = await get(running.base, `/bff/support/requests/${ticketId}`, cookie);
      assert.equal(detail.status, 404);
      assert.deepEqual(await detail.json(), { error: "not_found" });
      assert.deepEqual(calls, ["support"], "the detail read stays local");
    } finally {
      await running.close();
    }
  });
});
