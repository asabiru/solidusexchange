import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { ActivityView, NotificationsView, SupportRequestView, SupportRequestsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { type MiniappServerOptions, createMiniappServer, routeTable } from "./server.js";
import { type SupportDesk, createSupportDesk, supportIdPattern } from "./support.js";

const origin = "http://127.0.0.1:4183";
const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const secretTopic = "Тема-маркер-7f3a";
const secretMessage = "Текст-маркер-c91e: мой номер карты не указан";
let now = 1_790_000_000_000;

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }),
    telegramBotToken: syntheticToken,
    ...overrides
  };
}

interface Running {
  base: string;
  close: () => Promise<void>;
}

async function start(serverConfig: ServerConfig = config(), options: MiniappServerOptions = {}): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now, ...options });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function telegramLogin(base: string, userId: number): Promise<string> {
  const initData = signInitData(new Map([
    ["auth_date", String(Math.floor(now / 1_000) - 5)],
    ["user", JSON.stringify({ id: userId, first_name: "Synthetic" })]
  ]), syntheticToken);
  const response = await post(base, "/bff/session/telegram", { initData });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

function draft(overrides: Record<string, string> = {}) {
  return { category: "question", topic: secretTopic, message: secretMessage, ...overrides };
}

async function create(base: string, cookie: string, body: unknown = draft()): Promise<Response> {
  return post(base, "/bff/support/requests", body, { cookie });
}

async function created(base: string, cookie: string, body: unknown = draft()): Promise<SupportRequestView> {
  const response = await create(base, cookie, body);
  assert.equal(response.status, 201);
  return await response.json() as SupportRequestView;
}

async function getJson<T>(base: string, path: string, cookie: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: response.status, body: await response.json() as T };
}

function capturingDesk(desk: SupportDesk): { desk: SupportDesk; subjects: string[] } {
  const subjects: string[] = [];
  return {
    subjects,
    desk: {
      ...desk,
      create: (subject, input, own) => {
        subjects.push(subject);
        return desk.create(subject, input, own);
      }
    }
  };
}

describe("support routes: creation and reading", () => {
  it("creates a test-only draft for the session subject and returns it from list and detail", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 501);
      const response = await create(running.base, cookie, draft({ category: "operation_problem" }));
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const view = await response.json() as SupportRequestView;
      assert.match(view.id, supportIdPattern);
      assert.deepEqual(Object.keys(view).sort(), ["category", "complaintAcknowledged", "createdAt", "delivery", "expiresAt", "id", "message", "mode", "status", "timeline", "topic"]);
      assert.equal(view.category, "operation_problem");
      assert.equal(view.topic, secretTopic);
      assert.equal(view.message, secretMessage);
      assert.equal(view.mode, "test");
      assert.equal(view.delivery, "disabled");
      assert.equal(view.status, "received");
      assert.deepEqual(view.timeline, [{ status: "received", at: now }]);
      assert.equal(view.complaintAcknowledged, false);
      const list = await getJson<SupportRequestsView>(running.base, "/bff/support/requests", cookie);
      assert.equal(list.status, 200);
      assert.equal(list.body.mode, "test");
      assert.equal(list.body.delivery, "disabled");
      assert.deepEqual(list.body.requests.map((entry) => entry.id), [view.id]);
      const detail = await getJson<SupportRequestView>(running.base, `/bff/support/requests/${view.id}`, cookie);
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body, view);
    } finally {
      await running.close();
    }
  });

  it("marks complaints with the customer-protection acknowledgement", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 502);
      assert.equal((await created(running.base, cookie, draft({ category: "complaint" }))).complaintAcknowledged, true);
      for (const category of ["question", "operation_problem", "data_request"]) {
        assert.equal((await created(running.base, cookie, draft({ category }))).complaintAcknowledged, false, category);
      }
    } finally {
      await running.close();
    }
  });

  it("requires a session, an allowed origin and no device header", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 503);
      assert.equal((await post(running.base, "/bff/support/requests", draft())).status, 401);
      assert.equal((await post(running.base, "/bff/support/requests", draft(), { cookie, origin: "http://evil.example" })).status, 403);
      const noOrigin = await fetch(`${running.base}/bff/support/requests`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(draft())
      });
      assert.equal(noOrigin.status, 403);
      assert.equal((await post(running.base, "/bff/support/requests", draft(), { cookie, "x-device-id": "dev-1" })).status, 400);
      for (const path of ["/bff/support/requests", "/bff/support/requests/sup_000000000000000000000000"]) {
        assert.equal((await fetch(`${running.base}${path}`)).status, 401, path);
        assert.equal((await fetch(`${running.base}${path}`, { headers: { cookie, "x-device-id": "dev-1" } })).status, 400, path);
        assert.equal((await fetch(`${running.base}${path}?limit=1`, { headers: { cookie } })).status, 400, path);
      }
      assert.deepEqual((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", cookie)).body.requests, []);
    } finally {
      await running.close();
    }
  });
});

describe("support routes: validation", () => {
  it("rejects unknown fields, non-string values, non-JSON and oversized bodies", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 511);
      const bad = [
        { ...draft(), status: "closed" },
        { ...draft(), id: "sup_000000000000000000000000" },
        { category: "question", topic: secretTopic },
        `{"category":"question","topic":"x","message":1}`,
        `{"category":"question","topic":"x","message":"y","message":"z"}`,
        JSON.stringify(draft({ message: "a".repeat(5_000) }))
      ];
      for (const body of bad) {
        const response = await create(running.base, cookie, body);
        assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
        assert.deepEqual(await response.json(), { error: "invalid_request" });
      }
      const text = await post(running.base, "/bff/support/requests", JSON.stringify(draft()), { cookie, "content-type": "text/plain" });
      assert.equal(text.status, 415);
      assert.deepEqual((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", cookie)).body.requests, []);
    } finally {
      await running.close();
    }
  });

  it("answers category, topic, message and reference errors with specific codes", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 512);
      const cases: [Record<string, string>, string][] = [
        [draft({ category: "refund" }), "invalid_category"],
        [draft({ category: "__proto__" }), "invalid_category"],
        [draft({ topic: "" }), "invalid_topic"],
        [draft({ topic: "a".repeat(121) }), "invalid_topic"],
        [draft({ topic: "две\nстроки" }), "invalid_topic"],
        [draft({ message: "" }), "invalid_message"],
        [draft({ message: "esc\u001b[2J" }), "invalid_message"],
        [draft({ message: "nul\u0000" }), "invalid_message"],
        [draft({ message: "x".repeat(1_001) }), "invalid_message"],
        [draft({ activityId: "act_zz" }), "invalid_reference"],
        [draft({ activityId: "" }), "invalid_reference"]
      ];
      for (const [body, code] of cases) {
        const response = await create(running.base, cookie, body);
        assert.equal(response.status, 400, code);
        assert.deepEqual(await response.json(), { error: code });
      }
      assert.deepEqual((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", cookie)).body.requests, []);
    } finally {
      await running.close();
    }
  });
});

describe("support routes: ownership", () => {
  it("lists and returns only the caller's own requests; other ids are not found", async () => {
    const running = await start();
    try {
      const alice = await telegramLogin(running.base, 521);
      const bob = await telegramLogin(running.base, 522);
      const own = await created(running.base, alice);
      const foreign = await created(running.base, bob, draft({ topic: "Чужая тема" }));
      assert.deepEqual((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", alice)).body.requests.map((entry) => entry.id), [own.id]);
      const stolen = await getJson<unknown>(running.base, `/bff/support/requests/${foreign.id}`, alice);
      const unknown = await getJson<unknown>(running.base, "/bff/support/requests/sup_000000000000000000000000", alice);
      assert.equal(stolen.status, 404);
      assert.deepEqual(stolen.body, unknown.body);
      assert.deepEqual(stolen.body, { error: "not_found" });
      for (const id of ["", "unknown", own.id.toUpperCase(), `${own.id}/x`, "%2e%2e"]) {
        assert.equal((await getJson<unknown>(running.base, `/bff/support/requests/${id}`, alice)).status, 404, id);
      }
      assert.equal((await getJson<SupportRequestView>(running.base, `/bff/support/requests/${own.id}`, alice)).status, 200);
    } finally {
      await running.close();
    }
  });

  it("accepts references only to the caller's own server-owned activity items", async () => {
    const running = await start();
    try {
      const alice = await telegramLogin(running.base, 531);
      const bob = await telegramLogin(running.base, 532);
      const [aliceLogin] = (await getJson<ActivityView>(running.base, "/bff/activity", alice)).body.items;
      const [bobLogin] = (await getJson<ActivityView>(running.base, "/bff/activity", bob)).body.items;
      const linked = await created(running.base, alice, draft({ activityId: aliceLogin.id }));
      assert.deepEqual(linked.activityRef, { id: aliceLogin.id, kind: "session_login" });
      const foreign = await create(running.base, alice, draft({ activityId: bobLogin.id }));
      assert.equal(foreign.status, 400);
      assert.deepEqual(await foreign.json(), { error: "invalid_reference" });
      const forged = await create(running.base, alice, draft({ activityId: "act_000000000000000000000000" }));
      assert.equal(forged.status, 400);
      assert.equal((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", alice)).body.requests.length, 1);
    } finally {
      await running.close();
    }
  });
});

describe("support routes: limits", () => {
  it("rate limits creation per subject and recovers after the window", async () => {
    const running = await start();
    try {
      const alice = await telegramLogin(running.base, 541);
      const bob = await telegramLogin(running.base, 542);
      for (let index = 0; index < 5; index++) await created(running.base, alice);
      const limited = await create(running.base, alice);
      assert.equal(limited.status, 429);
      assert.deepEqual(await limited.json(), { error: "support_rate_limited" });
      await created(running.base, bob);
      now += 10 * 60 * 1_000;
      await created(running.base, alice);
      assert.equal((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", alice)).body.requests.length, 6);
    } finally {
      await running.close();
    }
  });

  it("enforces per-subject and global caps and expires drafts after the TTL", async () => {
    const support = createSupportDesk({ clock: () => now, maxPerSubject: 1, maxTotal: 2, ttlMs: 60_000 });
    const running = await start(config(), { support });
    try {
      const alice = await telegramLogin(running.base, 551);
      const bob = await telegramLogin(running.base, 552);
      const carol = await telegramLogin(running.base, 553);
      const first = await created(running.base, alice);
      const full = await create(running.base, alice);
      assert.equal(full.status, 409);
      assert.deepEqual(await full.json(), { error: "support_limit_reached" });
      await created(running.base, bob);
      const capacity = await create(running.base, carol);
      assert.equal(capacity.status, 503);
      assert.deepEqual(await capacity.json(), { error: "support_capacity" });
      now += 60_000;
      assert.equal((await getJson<unknown>(running.base, `/bff/support/requests/${first.id}`, alice)).status, 404);
      assert.deepEqual((await getJson<SupportRequestsView>(running.base, "/bff/support/requests", alice)).body.requests, []);
      await created(running.base, carol);
    } finally {
      await running.close();
    }
  });
});

describe("support routes: side effects", () => {
  it("records an activity entry and a draft notification without any request text", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 561);
      const question = await created(running.base, cookie);
      const complaint = await created(running.base, cookie, draft({ category: "complaint" }));
      const activity = (await getJson<ActivityView>(running.base, "/bff/activity", cookie)).body;
      const [latest, previous] = activity.items;
      assert.deepEqual(Object.keys(latest).sort(), ["at", "category", "id", "kind", "requestId"]);
      assert.deepEqual({ kind: latest.kind, ...(latest.kind === "support_requested" ? { category: latest.category, requestId: latest.requestId } : {}) }, {
        kind: "support_requested",
        category: "complaint",
        requestId: complaint.id
      });
      assert.ok(previous.kind === "support_requested" && previous.requestId === question.id);
      const inbox = (await getJson<NotificationsView>(running.base, "/bff/notifications", cookie)).body;
      assert.deepEqual(inbox.notifications.slice(0, 2).map((draftView) => draftView.template), ["complaint_received", "support_received"]);
      assert.ok(inbox.notifications.every((entry) => entry.delivered === false && entry.mode === "test"));
      const serialized = JSON.stringify([activity, inbox]);
      assert.ok(!serialized.includes(secretTopic));
      assert.ok(!serialized.includes(secretMessage));
    } finally {
      await running.close();
    }
  });

  it("does not record activity or notifications for rejected requests", async () => {
    const running = await start();
    try {
      const cookie = await telegramLogin(running.base, 562);
      assert.equal((await create(running.base, cookie, draft({ category: "refund" }))).status, 400);
      assert.equal((await create(running.base, cookie, draft({ message: "" }))).status, 400);
      const activity = (await getJson<ActivityView>(running.base, "/bff/activity", cookie)).body;
      assert.deepEqual(activity.items.map((item) => item.kind), ["session_login"]);
      const inbox = (await getJson<NotificationsView>(running.base, "/bff/notifications", cookie)).body;
      assert.deepEqual(inbox.notifications.map((entry) => entry.template), ["session_login"]);
    } finally {
      await running.close();
    }
  });

  it("logs only the category and server id, never topic or message text", async () => {
    const lines: string[] = [];
    const running = await start(config({ observability: { log: "json", metrics: "off" } }), { logSink: (line) => lines.push(line) });
    try {
      const cookie = await telegramLogin(running.base, 571);
      const view = await created(running.base, cookie, draft({ category: "data_request" }));
      await getJson<SupportRequestView>(running.base, `/bff/support/requests/${view.id}`, cookie);
      assert.equal((await create(running.base, cookie, draft({ message: "nul\u0000" }))).status, 400);
      const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry.event !== undefined);
      assert.equal(events.length, 1);
      assert.deepEqual(Object.keys(events[0]).sort(), ["category", "event", "service", "support_id", "ts"]);
      assert.equal(events[0].event, "support_request_created");
      assert.equal(events[0].category, "data_request");
      assert.equal(events[0].support_id, view.id);
      const all = lines.join("\n");
      assert.ok(!all.includes(secretTopic));
      assert.ok(!all.includes(secretMessage));
      assert.ok(!all.includes("Текст-маркер"));
      assert.ok(!all.includes(cookie.split("=")[1]));
      assert.ok(lines.some((line) => JSON.parse(line).route === "/bff/support/requests/:id"));
    } finally {
      await running.close();
    }
  });
});

describe("support routes: no operator and no external delivery", () => {
  it("changes status only through the in-process desk fixture, never through a route", async () => {
    const { desk, subjects } = capturingDesk(createSupportDesk({ clock: () => now }));
    const running = await start(config(), { support: desk });
    try {
      const cookie = await telegramLogin(running.base, 581);
      const view = await created(running.base, cookie);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await fetch(`${running.base}/bff/support/requests/${view.id}`, {
          method,
          headers: { "content-type": "application/json", origin, cookie },
          body: JSON.stringify({ status: "closed" })
        });
        assert.equal(response.status, 404, method);
      }
      assert.equal((await getJson<SupportRequestView>(running.base, `/bff/support/requests/${view.id}`, cookie)).body.status, "received");
      now += 1_000;
      assert.equal(desk.advance(subjects[0], view.id, "in_review")?.status, "in_review");
      const detail = (await getJson<SupportRequestView>(running.base, `/bff/support/requests/${view.id}`, cookie)).body;
      assert.deepEqual(detail.timeline.map((entry) => entry.status), ["received", "in_review"]);
      const supportRoutes = routeTable.filter((route) => route.path.startsWith("/bff/support"));
      assert.deepEqual(supportRoutes.map((route) => `${route.method} ${route.path}`).sort(), [
        "GET /bff/support/requests",
        "GET /bff/support/requests/:id",
        "POST /bff/support/requests"
      ]);
    } finally {
      await running.close();
    }
  });

  it("has no network, Telegram, email or logging access in the support module", async () => {
    for (const file of ["./support.js", "../shared/support.js"]) {
      const source = await readFile(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(source, /fetch\(|node:https?|node:net|node:dgram|node:child_process|api\.telegram\.org|sendMessage|smtp|nodemailer|mailto:|console\.|process\.stdout/i, file);
    }
  });
});
