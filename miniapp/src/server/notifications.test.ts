import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { KycScenario } from "@solidchange/provider-simulators";
import type { KycVerificationState, NotificationTemplate, NotificationsView, SessionView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { type KycService, createKycService } from "./kyc.js";
import { createNotificationOutbox, notificationIdPattern, notificationTexts } from "./notifications.js";
import { createMiniappServer } from "./server.js";

const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
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

async function start(serverConfig: ServerConfig, kyc?: KycService): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now, kyc });
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
    body: JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function devLogin(base: string, kyc = "kyc-gated"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
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

async function inbox(base: string, cookie: string): Promise<NotificationsView> {
  const response = await fetch(`${base}/bff/notifications`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return await response.json() as NotificationsView;
}

function templates(view: NotificationsView): NotificationTemplate[] {
  return view.notifications.map((draft) => draft.template);
}

function kycRun(scenario: KycScenario, reviewTimeoutSeconds = 3_600) {
  let clock = 1_790_000_000_000;
  const kyc = createKycService({ seed: "miniapp-notification-test", scenario, reviewTimeoutSeconds, clock: () => clock });
  const seen: [string, KycVerificationState][] = [];
  kyc.subscribe((subject, state) => {
    seen.push([subject, state]);
  });
  return {
    kyc,
    seen,
    advance(seconds: number) {
      clock += seconds * 1_000;
    }
  };
}

describe("notification outbox: drafts only, bounded and isolated", () => {
  it("records undelivered test-mode drafts with deterministic ids and the server clock", () => {
    let clock = 1_000;
    const first = createNotificationOutbox({ clock: () => clock });
    const second = createNotificationOutbox({ clock: () => clock });
    const draft = first.record("tg-a", "kyc_submitted");
    assert.deepEqual(draft, {
      id: draft.id,
      createdAt: 1_000,
      channel: "telegram-draft",
      template: "kyc_submitted",
      locale: "ru",
      text: notificationTexts.kyc_submitted,
      mode: "test",
      delivered: false,
      read: false
    });
    assert.match(draft.id, notificationIdPattern);
    assert.equal(second.record("tg-a", "kyc_submitted").id, draft.id);
    clock = 2_000;
    const next = first.record("tg-a", "kyc_submitted");
    assert.notEqual(next.id, draft.id);
    assert.equal(next.createdAt, 2_000);
    assert.notEqual(first.record("tg-b", "kyc_submitted").id, draft.id);
  });

  it("returns drafts newest-first and caps the list", () => {
    let clock = 0;
    const outbox = createNotificationOutbox({ clock: () => clock });
    for (const template of ["session_login", "kyc_submitted", "kyc_in_review", "kyc_approved"] as const) {
      clock += 1;
      outbox.record("tg-a", template);
    }
    assert.deepEqual(outbox.list("tg-a").map((draft) => draft.template), ["kyc_approved", "kyc_in_review", "kyc_submitted", "session_login"]);
    assert.deepEqual(outbox.list("tg-a", 2).map((draft) => draft.createdAt), [4, 3]);
    assert.deepEqual(outbox.list("tg-a", -1), []);
  });

  it("evicts the oldest drafts beyond the per-subject bound without reusing ids", () => {
    const outbox = createNotificationOutbox({ clock: () => 0, maxPerSubject: 3 });
    const ids = Array.from({ length: 5 }, () => outbox.record("tg-a", "session_login").id);
    outbox.record("tg-b", "session_login");
    assert.deepEqual(outbox.list("tg-a").map((draft) => draft.id), ids.slice(2).reverse());
    assert.equal(new Set(ids).size, 5);
    assert.equal(outbox.list("tg-b").length, 1);
    assert.equal(outbox.size(), 4);
  });

  it("evicts the globally oldest drafts beyond the total bound", () => {
    const outbox = createNotificationOutbox({ clock: () => 0, maxPerSubject: 10, maxTotal: 4 });
    outbox.record("tg-a", "session_login");
    outbox.record("tg-b", "session_login");
    outbox.record("tg-a", "kyc_submitted");
    outbox.record("tg-c", "session_login");
    outbox.record("tg-c", "kyc_submitted");
    assert.equal(outbox.size(), 4);
    assert.deepEqual(outbox.list("tg-a").map((draft) => draft.template), ["kyc_submitted"]);
    assert.equal(outbox.list("tg-b").length, 1);
    assert.equal(outbox.list("tg-c").length, 2);
    assert.throws(() => createNotificationOutbox({ clock: () => 0, maxTotal: 0 }), RangeError);
    assert.throws(() => createNotificationOutbox({ clock: () => 0, maxPerSubject: 1.5 }), RangeError);
  });

  it("marks only the subject's own drafts read and returns copies", () => {
    const outbox = createNotificationOutbox({ clock: () => 0 });
    const own = outbox.record("tg-a", "session_login");
    const other = outbox.record("tg-b", "session_login");
    assert.equal(outbox.markRead("tg-a", [other.id]), 0);
    assert.equal(outbox.unread("tg-b"), 1);
    assert.equal(outbox.markRead("tg-a", [own.id, other.id]), 1);
    assert.equal(outbox.markRead("tg-a", [own.id]), 0);
    assert.equal(outbox.unread("tg-a"), 0);
    assert.equal(outbox.list("tg-a")[0].read, true);
    assert.equal(outbox.list("tg-b")[0].read, false);
    const copy = outbox.list("tg-b")[0];
    copy.read = true;
    assert.equal(outbox.unread("tg-b"), 1);
  });

  it("only accepts fixed templates whose texts are short, test-marked and free of PII, providers or amounts", () => {
    const outbox = createNotificationOutbox({ clock: () => 0 });
    assert.throws(() => outbox.record("tg-a", "Переведите 100 USDT" as NotificationTemplate), RangeError);
    assert.equal(outbox.size(), 0);
    for (const [template, text] of Object.entries(notificationTexts)) {
      assert.match(text, /^Тестовый режим\. /, template);
      assert.ok(text.length <= 80, template);
      assert.doesNotMatch(text, /\d|₽|RUB|USDT|TON|sim-|tg-|SC-DEV|провайдер|provider|симулятор/i, template);
    }
  });

  it("rejects prototype property names as templates instead of storing non-string text", () => {
    const outbox = createNotificationOutbox({ clock: () => 0 });
    for (const template of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"] as unknown as NotificationTemplate[]) {
      assert.throws(() => outbox.record("tg-a", template), RangeError, template);
    }
    assert.equal(outbox.size(), 0);
    for (const draft of outbox.list("tg-a")) {
      assert.equal(typeof draft.text, "string");
    }
  });

  it("bounds per-subject id sequences together with the drafts", () => {
    const outbox = createNotificationOutbox({ clock: () => 0, maxPerSubject: 1, maxTotal: 2 });
    const first = outbox.record("tg-a", "session_login");
    outbox.record("tg-b", "session_login");
    const pending = outbox.record("tg-c", "session_login");
    // tg-a's only draft was globally evicted, so its sequence entry must go too.
    const again = outbox.record("tg-a", "session_login");
    assert.equal(again.id, first.id);
    // tg-c kept a live draft, so its sequence survives and ids stay unique.
    assert.notEqual(outbox.record("tg-c", "session_login").id, pending.id);
  });

  it("has no network, Telegram Bot API or token access in the outbox module", async () => {
    const source = await readFile(new URL("./notifications.js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\(|node:https?|node:net|node:dgram|api\.telegram\.org|sendMessage|bot_?token|BOT_TOKEN/i);
  });
});

describe("notification sources: verified KYC transitions only", () => {
  const subject = "tg-0123456789abcdef";

  it("emits submitted → in review → approved from verified callbacks only", async () => {
    const run = kycRun("approve");
    await run.kyc.submit(subject);
    assert.deepEqual(run.seen, [[subject, "submitted"]]);
    run.advance(600);
    const [review, approval] = run.kyc.drainDeliveries();
    assert.deepEqual(run.kyc.receiveCallback({ headers: {}, body: approval.body }, approval.deliverAt), { verified: false, reason: "missing_header" });
    const forged = Buffer.from(review.body.toString("utf8").replace("\"in_review\"", "\"approved\""), "utf8");
    assert.deepEqual(run.kyc.receiveCallback({ headers: review.headers, body: forged }, review.deliverAt), { verified: false, reason: "signature_mismatch" });
    assert.equal(run.kyc.receiveCallback(approval, approval.deliverAt).verified, true);
    assert.equal(run.kyc.receiveCallback(approval, approval.deliverAt).verified, false);
    assert.deepEqual(run.seen, [[subject, "submitted"]]);
    assert.deepEqual(run.kyc.receiveCallback(review, review.deliverAt), { verified: true, action: "applied" });
    assert.deepEqual(run.seen.map(([, state]) => state), ["submitted", "in_review", "approved"]);
  });

  it("emits rejected, needs-more-data, timed-out and unavailable outcomes once", async () => {
    for (const [scenario, target] of [
      ["reject", "rejected"],
      ["needs_more_data", "needs_more_data"],
      ["pending_timeout", "timed_out"]
    ] as const) {
      const run = kycRun(scenario, 600);
      await run.kyc.submit(subject);
      for (let step = 0; step < 120; step += 1) {
        run.advance(10);
        run.kyc.view(subject, "kyc-gated");
      }
      const states = run.seen.map(([, state]) => state);
      assert.equal(states[0], "submitted", scenario);
      assert.ok(states.includes("in_review"), scenario);
      assert.equal(states.at(-1), target, scenario);
      assert.equal(states.filter((state) => state === target).length, 1, scenario);
    }
    const outage = kycRun("provider_outage");
    await assert.rejects(outage.kyc.submit(subject));
    await assert.rejects(outage.kyc.submit(subject));
    assert.deepEqual(outage.seen, [[subject, "unavailable"]]);
  });

  it("ignores callbacks for a superseded application after reset", async () => {
    const run = kycRun("approve");
    await run.kyc.submit(subject);
    run.advance(600);
    const deliveries = run.kyc.drainDeliveries();
    run.kyc.reset(subject);
    for (const delivery of deliveries) run.kyc.receiveCallback(delivery, delivery.deliverAt);
    assert.deepEqual(run.seen, [[subject, "submitted"]]);
  });
});

describe("notification routes: session, CSRF and strict input", () => {
  it("requires a session and rejects query parameters and X-Device-Id", async () => {
    const running = await start(config());
    try {
      assert.equal((await fetch(`${running.base}/bff/notifications`)).status, 401);
      const forged = { cookie: "solidchange_ma_session=00000000-0000-4000-8000-000000000000" };
      assert.equal((await fetch(`${running.base}/bff/notifications`, { headers: forged })).status, 401);
      const cookie = await devLogin(running.base);
      for (const query of ["?limit=100", "?subject=tg-other", "?"]) {
        const response = await fetch(`${running.base}/bff/notifications${query}`, { headers: { cookie } });
        assert.equal(response.status, query === "?" ? 200 : 400, query);
      }
      const device = await fetch(`${running.base}/bff/notifications`, {
        headers: { cookie, "x-device-id": "6f1c2f9e-5d5a-4b1c-9c1e-2f0f7c9a1b2c" }
      });
      assert.equal(device.status, 400);
      const view = await inbox(running.base, cookie);
      assert.equal(view.mode, "test");
      assert.equal(view.delivery, "disabled");
      assert.deepEqual(templates(view), ["session_login"]);
      assert.equal(view.unread, 1);
      assert.equal(view.notifications[0].delivered, false);
      assert.equal(view.notifications[0].createdAt, now);
    } finally {
      await running.close();
    }
  });

  it("applies exact-Origin CSRF and strict body rules to read-marking", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      const [draft] = (await inbox(running.base, cookie)).notifications;
      for (const bad of ["http://evil.example", "null", `${origin}/`]) {
        assert.equal((await post(running.base, "/bff/notifications/read", { ids: draft.id }, { cookie, origin: bad })).status, 403, bad);
      }
      const missing = await fetch(`${running.base}/bff/notifications/read`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ ids: draft.id })
      });
      assert.equal(missing.status, 403);
      assert.equal((await post(running.base, "/bff/notifications/read", { ids: draft.id })).status, 401);
      const plain = await fetch(`${running.base}/bff/notifications/read`, {
        method: "POST",
        headers: { "content-type": "text/plain", origin, cookie },
        body: JSON.stringify({ ids: draft.id })
      });
      assert.equal(plain.status, 415);
      for (const body of [
        {},
        { ids: draft.id, read: "false" },
        { ids: draft.id, subject: "tg-other" },
        { ids: "" },
        { ids: `${draft.id},${draft.id}` },
        { ids: `${draft.id},` },
        { ids: "ntf_zz" },
        { ids: Array.from({ length: 21 }, (_, index) => `ntf_${index.toString(16).padStart(24, "0")}`).join(",") },
        [draft.id]
      ]) {
        assert.equal((await post(running.base, "/bff/notifications/read", body, { cookie })).status, 400, JSON.stringify(body));
      }
      const device = await post(running.base, "/bff/notifications/read", { ids: draft.id }, {
        cookie,
        "x-device-id": "6f1c2f9e-5d5a-4b1c-9c1e-2f0f7c9a1b2c"
      });
      assert.equal(device.status, 400);
      assert.equal((await inbox(running.base, cookie)).unread, 1);

      const marked = await post(running.base, "/bff/notifications/read", { ids: draft.id }, { cookie });
      assert.equal(marked.status, 200);
      assert.deepEqual(await marked.json(), { marked: 1, unread: 0 });
      assert.equal((await inbox(running.base, cookie)).notifications[0].read, true);
    } finally {
      await running.close();
    }
  });

  it("isolates drafts between subjects and marks only the caller's own ids", async () => {
    const running = await start(config({ telegramBotToken: syntheticToken }));
    try {
      const alice = await telegramLogin(running.base, 41);
      const bob = await telegramLogin(running.base, 42);
      const aliceView = await inbox(running.base, alice);
      const bobView = await inbox(running.base, bob);
      assert.equal(aliceView.notifications.length, 1);
      assert.equal(bobView.notifications.length, 1);
      assert.notEqual(aliceView.notifications[0].id, bobView.notifications[0].id);

      const cross = await post(running.base, "/bff/notifications/read", { ids: bobView.notifications[0].id }, { cookie: alice });
      assert.deepEqual(await cross.json(), { marked: 0, unread: 1 });
      assert.equal((await inbox(running.base, bob)).unread, 1);

      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie: alice })).status, 202);
      assert.deepEqual(templates(await inbox(running.base, alice)), ["kyc_submitted", "session_login"]);
      assert.deepEqual(templates(await inbox(running.base, bob)), ["session_login"]);
    } finally {
      await running.close();
    }
  });

  it("never creates drafts from client input or unverified callbacks", async () => {
    const kyc = createKycService({ seed: "miniapp-notification-routes", scenario: "approve", reviewTimeoutSeconds: 3_600, clock: () => now });
    const running = await start(config(), kyc);
    try {
      const cookie = await devLogin(running.base);
      for (const [path, body] of [
        ["/bff/notifications", { template: "kyc_approved" }],
        ["/bff/notifications/drafts", { text: "Тестовый режим" }],
        ["/bff/notifications/send", { ids: "x" }],
        ["/bff/kyc/applications", { status: "approved" }]
      ] as const) {
        assert.notEqual((await post(running.base, path, body, { cookie })).status, 200, path);
      }
      assert.equal((await fetch(`${running.base}/bff/notifications/read`, { headers: { cookie } })).status, 404);
      assert.deepEqual(templates(await inbox(running.base, cookie)), ["session_login"]);

      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 202);
      now += 600_000;
      const [review, approval] = kyc.drainDeliveries();
      const forged = Buffer.from(review.body.toString("utf8").replace("\"in_review\"", "\"approved\""), "utf8");
      assert.equal(kyc.receiveCallback({ headers: review.headers, body: forged }, review.deliverAt).verified, false);
      assert.equal(kyc.receiveCallback({ headers: {}, body: approval.body }, approval.deliverAt).verified, false);
      assert.deepEqual(templates(await inbox(running.base, cookie)), ["kyc_submitted", "session_login"]);
      assert.equal((await fetch(`${running.base}/bff/session`, { headers: { cookie } })).status, 200);
    } finally {
      await running.close();
    }
  });
});

describe("notification integration: gated login → KYC submit → approval", () => {
  it("records a draft for every verified step and none of them is delivered", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      assert.deepEqual(templates(await inbox(running.base, cookie)), ["session_login"]);
      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 202);
      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 200);
      for (let step = 0; step < 120; step += 1) {
        now += 10_000;
        const session = await (await fetch(`${running.base}/bff/session`, { headers: { cookie } })).json() as SessionView;
        if (session.kyc === "verified") break;
      }
      const view = await inbox(running.base, cookie);
      assert.deepEqual(templates(view), ["kyc_approved", "kyc_in_review", "kyc_submitted", "session_login"]);
      assert.equal(view.unread, 4);
      const createdAt = view.notifications.map((draft) => draft.createdAt);
      assert.deepEqual([...createdAt].sort((a, b) => b - a), createdAt);
      const session = await (await fetch(`${running.base}/bff/session`, { headers: { cookie } })).json() as SessionView;
      const text = JSON.stringify(view);
      assert.ok(!text.includes(session.customerRef));
      assert.doesNotMatch(text, /sim-|kyc-sim|applicant|provider|tg-[0-9a-f]{16}/);
      for (const draft of view.notifications) {
        assert.equal(draft.channel, "telegram-draft");
        assert.equal(draft.delivered, false);
        assert.equal(draft.mode, "test");
        assert.equal(draft.locale, "ru");
      }

      const marked = await post(running.base, "/bff/notifications/read", {
        ids: view.notifications.map((draft) => draft.id).join(",")
      }, { cookie });
      assert.deepEqual(await marked.json(), { marked: 4, unread: 0 });

      const relogin = await devLogin(running.base);
      const after = await inbox(running.base, relogin);
      assert.deepEqual(templates(after), ["session_login", "kyc_approved", "kyc_in_review", "kyc_submitted", "session_login"]);
      assert.equal(after.unread, 1);
    } finally {
      await running.close();
    }
  });
});
