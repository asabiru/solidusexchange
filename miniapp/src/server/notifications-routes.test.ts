import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { NotificationsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { defaultMaxPerSubject, notificationIdPattern } from "./notifications.js";
import { createMiniappServer, routeTable } from "./server.js";

const origin = "http://127.0.0.1:4183";
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

async function start(serverConfig: ServerConfig = config()): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await fetch(`${base}/bff/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ kyc })
  });
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function inbox(base: string, cookie: string): Promise<{ status: number; body: NotificationsView }> {
  const response = await fetch(`${base}/bff/notifications`, { headers: { cookie } });
  return { status: response.status, body: await response.json() as NotificationsView };
}

describe("notification feed route: authentication and guards", () => {
  it("requires a session and rejects forged handles, X-Device-Id and query parameters", async () => {
    const running = await start();
    try {
      assert.equal((await fetch(`${running.base}/bff/notifications`)).status, 401);
      const forged = { cookie: "solidchange_ma_session=00000000-0000-4000-8000-000000000000" };
      assert.equal((await fetch(`${running.base}/bff/notifications`, { headers: forged })).status, 401);
      const cookie = await devLogin(running.base);
      const device = await fetch(`${running.base}/bff/notifications`, {
        headers: { cookie, "x-device-id": "6f1c2f9e-5d5a-4b1c-9c1e-2f0f7c9a1b2c" }
      });
      assert.equal(device.status, 400);
      for (const query of ["?limit=5", "?subject=tg-x", "?seen=1", "?offset=0"]) {
        const response = await fetch(`${running.base}/bff/notifications${query}`, { headers: { cookie } });
        assert.equal(response.status, 400, query);
      }
      assert.equal((await inbox(running.base, cookie)).status, 200);
    } finally {
      await running.close();
    }
  });

  it("exposes only the feed GET plus the existing read-receipt POST", async () => {
    const routes = routeTable.filter((route) => route.path.startsWith("/bff/notifications"));
    assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`).sort(), [
      "GET /bff/notifications",
      "POST /bff/notifications/read"
    ]);
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await fetch(`${running.base}/bff/notifications`, {
          method,
          headers: { "content-type": "application/json", origin, cookie },
          body: JSON.stringify({})
        });
        assert.equal(response.status, 404, method);
      }
      for (const path of ["/bff/notifications/drafts", "/bff/notifications/send", "/bff/notifications/ntf_000000000000000000000001"]) {
        const response = await fetch(`${running.base}${path}`, { headers: { cookie } });
        assert.equal(response.status, 404, path);
      }
    } finally {
      await running.close();
    }
  });
});

describe("notification feed route: envelope, ordering and bounds", () => {
  it("returns the test-mode envelope with exact view and draft keys", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      const { status, body } = await inbox(running.base, cookie);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body).sort(), ["delivery", "mode", "notifications", "unread"]);
      assert.equal(body.mode, "test");
      assert.equal(body.delivery, "disabled");
      assert.equal(body.unread, body.notifications.length);
      assert.ok(body.notifications.length >= 1);
      for (const draft of body.notifications) {
        assert.deepEqual(Object.keys(draft).sort(), [
          "channel", "createdAt", "delivered", "id", "locale", "mode", "read", "template", "text"
        ]);
        assert.match(draft.id, notificationIdPattern);
        assert.equal(draft.channel, "telegram-draft");
        assert.equal(draft.mode, "test");
        assert.equal(draft.locale, "ru");
        assert.equal(draft.delivered, false);
        assert.equal(draft.read, false);
        assert.equal(draft.createdAt, now);
        assert.ok(draft.text.length > 0);
      }
    } finally {
      await running.close();
    }
  });

  it("serves drafts newest-first and caps the feed at the per-subject bound", async () => {
    const running = await start();
    try {
      let cookie = "";
      for (let index = 0; index < defaultMaxPerSubject + 2; index += 1) {
        now += 1_000;
        cookie = await devLogin(running.base);
      }
      const { status, body } = await inbox(running.base, cookie);
      assert.equal(status, 200);
      assert.equal(body.notifications.length, defaultMaxPerSubject);
      assert.deepEqual(new Set(body.notifications.map((draft) => draft.template)), new Set(["session_login"]));
      const createdAt = body.notifications.map((draft) => draft.createdAt);
      assert.deepEqual([...createdAt].sort((a, b) => b - a), createdAt);
      assert.equal(new Set(createdAt).size, createdAt.length);
      assert.equal(new Set(body.notifications.map((draft) => draft.id)).size, defaultMaxPerSubject);
    } finally {
      await running.close();
    }
  });
});
