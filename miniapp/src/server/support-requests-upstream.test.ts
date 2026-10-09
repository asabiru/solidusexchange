import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { SupportRequestsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type {
  CustomerApiClient,
  CustomerApiSupport,
  CustomerApiSupportTicketsView,
  CustomerApiTicketView
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";
import { supportIdPattern } from "./support.js";

const origin = "http://127.0.0.1:4183";
const marker = "tck_upstreammarker0000";
const requestKeys = [
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
];
let now = 1_790_000_000_000;

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

interface SupportStub {
  client: CustomerApiClient;
  calls: string[];
}

function supportStub(result: CustomerApiSupport | (() => Promise<CustomerApiSupport>)): SupportStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "unavailable" }),
    kyc: async () => ({ status: "unavailable" }),
    profile: async () => ({ status: "unavailable" }),
    support: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    }
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: SupportStub): Promise<Running> {
  const server = createMiniappServer(serverConfig, {
    clock: () => now,
    ...(stub ? { customerApi: stub.client } : {})
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

function ticket(overrides: Partial<CustomerApiTicketView> = {}): CustomerApiTicketView {
  return {
    ticket_id: marker,
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
    expires_at: "2026-10-02T12:00:00.000Z",
    ...overrides
  };
}

function upstreamView(tickets: readonly CustomerApiTicketView[] = [ticket()]): CustomerApiSupportTicketsView {
  return { mode: "test", delivery: "disabled", tickets };
}

describe("GET /bff/support/requests through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/support/requests");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local desk view for gated and verified sessions without a configured customer-api", async () => {
    const running = await start(config());
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const created = await post(running.base, "/bff/support/requests", {
          category: "question",
          topic: "Synthetic subject",
          message: "Synthetic message"
        }, cookie);
        assert.equal(created.status, 201);
        const draft = await created.json();
        assert.match(draft.id, supportIdPattern);
        const view = await (await get(running.base, "/bff/support/requests", cookie)).json() as SupportRequestsView;
        assert.equal(view.mode, "test");
        assert.equal(view.delivery, "disabled");
        // Dev sessions share the synthetic subject, so the list accumulates
        // drafts across the loop — the freshly created one must be present.
        assert.ok(view.requests.some((entry) => entry.id === draft.id), kyc);
      }
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a kyc-gated session: the read is never gated", async () => {
    // Unlike /bff/wallet and /bff/notifications, gated sessions are authorized
    // for customer.support.read upstream, so they reach the contract surface
    // too — the same inversion /bff/kyc/status and /bff/profile follow.
    const stub = supportStub({ status: "ok", view: upstreamView() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/support/requests", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const key of ["ticket_id", "complaint_acknowledged", "created_at", "expires_at"]) {
        assert.equal(text.includes(key), false, `upstream key ${key} must not leak`);
      }
      const view = JSON.parse(text) as SupportRequestsView;
      assert.deepEqual(Object.keys(view).sort(), ["delivery", "mode", "requests"]);
      assert.equal(view.mode, "test");
      assert.equal(view.delivery, "disabled");
      assert.equal(view.requests.length, 1);
      const adapted = view.requests[0];
      assert.deepEqual(Object.keys(adapted).sort(), requestKeys);
      assert.equal(adapted.id, marker);
      assert.equal(adapted.category, "complaint");
      assert.equal(adapted.status, "in_review");
      assert.equal(adapted.complaintAcknowledged, true);
      assert.equal(adapted.createdAt, Date.parse("2026-10-01T12:00:00.000Z"));
      assert.equal(adapted.expiresAt, Date.parse("2026-10-02T12:00:00.000Z"));
      assert.deepEqual(adapted.timeline, [
        { status: "received", at: Date.parse("2026-10-01T12:00:00.000Z") },
        { status: "in_review", at: Date.parse("2026-10-01T13:00:00.000Z") }
      ]);
      assert.equal("activityRef" in adapted, false, "the app-only field has no contract counterpart");
      assert.equal(stub.calls.length, 1, "gated sessions must reach upstream");
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a verified session too", async () => {
    const stub = supportStub({
      status: "ok",
      view: upstreamView([ticket({ category: "data_request", status: "answered", complaint_acknowledged: false })])
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/support/requests", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as SupportRequestsView;
      assert.equal(view.requests.length, 1);
      assert.equal(view.requests[0].category, "data_request");
      assert.equal(view.requests[0].status, "answered");
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("keeps the upstream read source of truth for the list while local drafts stay writable", async () => {
    // POST /bff/support/requests stays a local desk write (the contract serves
    // no command side), so a configured upstream owns the list read: a local
    // draft created mid-session does not join the adapted tickets.
    const stub = supportStub({ status: "ok", view: upstreamView() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const created = await post(running.base, "/bff/support/requests", {
        category: "question",
        topic: "Synthetic subject",
        message: "Synthetic message"
      }, cookie);
      assert.equal(created.status, 201);
      const draft = await created.json();
      assert.match(draft.id, supportIdPattern);
      const view = await (await get(running.base, "/bff/support/requests", cookie)).json() as SupportRequestsView;
      assert.deepEqual(view.requests.map((entry) => entry.id), [marker]);
      assert.equal(stub.calls.length, 1);
      // The local detail read still resolves only locally stored drafts.
      assert.equal((await get(running.base, `/bff/support/requests/${draft.id}`, cookie)).status, 200);
      assert.equal((await get(running.base, `/bff/support/requests/${marker}`, cookie)).status, 404);
    } finally {
      await running.close();
    }
  });

  it("degrades to support_unavailable on upstream outage for gated and verified sessions without leaking the body", async () => {
    const stub = supportStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/support/requests", cookie);
        assert.equal(response.status, 503, kyc);
        const text = await response.text();
        assert.equal(text.includes(marker), false);
        assert.equal(text.includes("tck_"), false);
        assert.equal(text.includes("syn_cust_"), false);
        assert.deepEqual(JSON.parse(text), { error: "support_unavailable" });
      }
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiSupport = { status: "unavailable" };
    const stub = supportStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      assert.equal((await get(running.base, "/bff/support/requests", cookie)).status, 503);
      result = { status: "ok", view: upstreamView([ticket({ ticket_id: "tck_recovered000000000000000" })]) };
      const view = await (await get(running.base, "/bff/support/requests", cookie)).json() as SupportRequestsView;
      assert.deepEqual(view.requests.map((entry) => entry.id), ["tck_recovered000000000000000"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
