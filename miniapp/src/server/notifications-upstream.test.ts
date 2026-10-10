import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { NotificationsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiNotification, CustomerApiNotifications } from "./customer-api-client.js";
import { notificationIdPattern } from "./notifications.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "ntf_upstreammarker000000";
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

interface NotificationsStub {
  client: CustomerApiClient;
  calls: string[];
}

function notificationsStub(result: CustomerApiNotifications | (() => Promise<CustomerApiNotifications>)): NotificationsStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    notifications: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
        users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: NotificationsStub): Promise<Running> {
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

function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
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

function upstreamEntry(overrides: Partial<CustomerApiNotification> = {}): CustomerApiNotification {
  return {
    notification_id: "ntf_0123456789abcdef01234567",
    created_at: "2026-10-01T12:00:00.000Z",
    channel: "telegram-draft",
    template: "kyc_approved",
    locale: "ru",
    text: "Тестовый режим. Проверка личности пройдена.",
    mode: "test",
    delivered: false,
    read: false,
    ...overrides
  };
}

describe("GET /bff/notifications through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/notifications");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local outbox feed for a kyc-gated session without consulting upstream", async () => {
    const stub = notificationsStub({
      status: "ok",
      unread: 1,
      notifications: [upstreamEntry({ notification_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/notifications", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as NotificationsView;
      assert.deepEqual(Object.keys(view).sort(), ["delivery", "mode", "notifications", "unread"]);
      assert.equal(view.mode, "test");
      assert.equal(view.delivery, "disabled");
      // Dev login records a session_login draft in the local outbox.
      assert.equal(view.notifications.length >= 1, true);
      assert.equal(view.unread, view.notifications.filter((draft) => !draft.read).length);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local outbox feed for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/notifications", cookie)).json() as NotificationsView;
      assert.equal(view.mode, "test");
      assert.equal(view.notifications.length >= 1, true);
      assert.equal(view.notifications.every((draft) => draft.template === "session_login"), true);
    } finally {
      await running.close();
    }
  });

  it("adapts the contract notifications feed into the app's draft shape", async () => {
    const stub = notificationsStub({
      status: "ok",
      unread: 1,
      notifications: [
        upstreamEntry(),
        upstreamEntry({
          notification_id: "ntf_fedcba9876543210fedcba98",
          created_at: "2026-09-30T12:00:00.000Z",
          template: "session_login",
          text: "Тестовый режим. Выполнен вход в SOLID.",
          read: true
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/notifications", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("notification_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("created_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as NotificationsView;
      assert.deepEqual(Object.keys(view).sort(), ["delivery", "mode", "notifications", "unread"]);
      assert.equal(view.mode, "test");
      assert.equal(view.delivery, "disabled");
      assert.equal(view.unread, 1);
      assert.equal(view.notifications.length, 2);
      for (const draft of view.notifications) {
        assert.deepEqual(Object.keys(draft).sort(), [
          "channel", "createdAt", "delivered", "id", "locale", "mode", "read", "template", "text"
        ]);
        assert.match(draft.id, notificationIdPattern);
        assert.equal(draft.channel, "telegram-draft");
        assert.equal(draft.locale, "ru");
        assert.equal(draft.mode, "test");
        assert.equal(draft.delivered, false);
      }
      const [first, second] = view.notifications;
      assert.equal(first.id, "ntf_0123456789abcdef01234567");
      assert.equal(first.createdAt, Date.parse("2026-10-01T12:00:00.000Z"));
      assert.equal(first.template, "kyc_approved");
      assert.equal(first.read, false);
      assert.equal(second.id, "ntf_fedcba9876543210fedcba98");
      assert.equal(second.createdAt, Date.parse("2026-09-30T12:00:00.000Z"));
      assert.equal(second.read, true);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream notifications refusal (403) to the gated feed", async () => {
    const stub = notificationsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      // Dev logins are deterministic per subject, so the gated session and the
      // verified session share the same outbox feed.
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const verifiedCookie = await devLogin(running.base, "verified");
      const gated = await (await get(running.base, "/bff/notifications", gatedCookie)).json() as NotificationsView;
      const response = await get(running.base, "/bff/notifications", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to notifications_unavailable on upstream outage without leaking the body", async () => {
    const stub = notificationsStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/notifications", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("ntf_"), false);
      assert.deepEqual(JSON.parse(text), { error: "notifications_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract feed once upstream answers correctly again", async () => {
    let result: CustomerApiNotifications = { status: "unavailable" };
    const stub = notificationsStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/notifications", cookie)).status, 503);
      result = {
        status: "ok",
        unread: 1,
        notifications: [upstreamEntry()]
      };
      const view = await (await get(running.base, "/bff/notifications", cookie)).json() as NotificationsView;
      assert.equal(view.notifications.length, 1);
      assert.equal(view.notifications[0].id, "ntf_0123456789abcdef01234567");
      assert.equal(view.notifications[0].template, "kyc_approved");
    } finally {
      await running.close();
    }
  });
});
