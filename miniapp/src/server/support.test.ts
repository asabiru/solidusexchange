import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityKind } from "../shared/api.js";
import { maxSupportMessageLength, maxSupportTopicLength, supportCategories } from "../shared/support.js";
import {
  SupportInputError,
  SupportLimitError,
  SupportRateLimitError,
  createSupportDesk,
  defaultSupportTtlMs,
  supportIdPattern
} from "./support.js";

const noActivity = () => undefined;

function draft(overrides: Partial<{ category: string; topic: string; message: string; activityId: string }> = {}) {
  return { category: "question", topic: "Вопрос о лимитах", message: "Синтетический текст обращения.", ...overrides };
}

function inputCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof SupportInputError, String(error));
    return error.code;
  }
  assert.fail("expected SupportInputError");
}

describe("support desk: validation", () => {
  it("creates received, test-only drafts with server-generated ids for every category", () => {
    const desk = createSupportDesk({ clock: () => 1_000 });
    const ids = new Set<string>();
    for (const category of supportCategories) {
      const view = desk.create("tg-a", draft({ category }), noActivity);
      assert.match(view.id, supportIdPattern);
      ids.add(view.id);
      assert.equal(view.category, category);
      assert.equal(view.mode, "test");
      assert.equal(view.delivery, "disabled");
      assert.equal(view.status, "received");
      assert.deepEqual(view.timeline, [{ status: "received", at: 1_000 }]);
      assert.equal(view.createdAt, 1_000);
      assert.equal(view.expiresAt, 1_000 + defaultSupportTtlMs);
      assert.equal(view.complaintAcknowledged, category === "complaint");
      assert.equal(view.activityRef, undefined);
    }
    assert.equal(ids.size, supportCategories.length);
    assert.deepEqual([...supportCategories], ["question", "operation_problem", "complaint", "data_request"]);
  });

  it("ignores client-chosen ids and statuses", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    const view = desk.create("tg-a", { ...draft(), id: "sup_000000000000000000000000", status: "closed" } as never, noActivity);
    assert.notEqual(view.id, "sup_000000000000000000000000");
    assert.equal(view.status, "received");
  });

  it("rejects unknown categories, including prototype property names", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    for (const category of ["", "Complaint", "refund", "toString", "__proto__", "constructor", "question "]) {
      assert.equal(inputCode(() => desk.create("tg-a", draft({ category }), noActivity)), "invalid_category", category);
    }
    assert.equal(desk.size(), 0);
  });

  it("rejects empty, oversized and control or bidi-override characters in the topic", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    for (const topic of ["", "   ", "a".repeat(maxSupportTopicLength + 1), "line\nbreak", "tab\tseparated", "nul\u0000", "bell\u0007", "esc\u001b[31m", "del\u007f", "\u202eabc", "\u2066x\u2069", "lone\ud800"]) {
      assert.equal(inputCode(() => desk.create("tg-a", draft({ topic }), noActivity)), "invalid_topic", JSON.stringify(topic));
    }
    assert.equal(desk.create("tg-a", draft({ topic: "т".repeat(maxSupportTopicLength) }), noActivity).topic.length, maxSupportTopicLength);
  });

  it("allows line feeds in the message but rejects other control characters and oversized text", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    for (const message of ["", "\n\n", "x".repeat(maxSupportMessageLength + 1), "carriage\rreturn", "tab\there", "nul\u0000", "esc\u001b[2J", "c1\u0085", "sep\u2028x", "\u202dbidi", "lone\udfff"]) {
      assert.equal(inputCode(() => desk.create("tg-a", draft({ message }), noActivity)), "invalid_message", JSON.stringify(message));
    }
    const multi = desk.create("tg-a", draft({ message: "  первая строка\nвторая строка  " }), noActivity);
    assert.equal(multi.message, "первая строка\nвторая строка");
    assert.equal(desk.create("tg-a", draft({ message: "я".repeat(maxSupportMessageLength) }), noActivity).message.length, maxSupportMessageLength);
  });

  it("keeps markup as literal plain text", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    const markup = "<img src=x onerror=alert(1)> & <b>жирный</b>";
    const view = desk.create("tg-a", draft({ topic: markup, message: markup }), noActivity);
    assert.equal(view.topic, markup);
    assert.equal(view.message, markup);
  });
});

describe("support desk: ownership", () => {
  it("lists and returns only the subject's own requests, newest first", () => {
    let now = 0;
    const desk = createSupportDesk({ clock: () => now });
    const first = desk.create("tg-a", draft({ topic: "первое" }), noActivity);
    now = 10;
    const second = desk.create("tg-a", draft({ topic: "второе" }), noActivity);
    const foreign = desk.create("tg-b", draft({ topic: "чужое" }), noActivity);
    assert.deepEqual(desk.list("tg-a").map((view) => view.id), [second.id, first.id]);
    assert.deepEqual(desk.list("tg-b").map((view) => view.id), [foreign.id]);
    assert.deepEqual(desk.list("tg-c"), []);
    assert.equal(desk.view("tg-a", first.id)?.id, first.id);
    assert.equal(desk.view("tg-a", foreign.id), undefined);
    assert.equal(desk.view("tg-b", first.id), undefined);
    for (const id of ["", "sup_", first.id.toUpperCase(), `${first.id}0`, "../sup", "constructor"]) assert.equal(desk.view("tg-a", id), undefined, id);
  });

  it("validates activity references through the owner lookup and keeps only id and kind", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    const asked: string[] = [];
    const own = (id: string): ActivityKind | undefined => {
      asked.push(id);
      return id === "act_aaaaaaaaaaaaaaaaaaaaaaaa" ? "quote_previewed" : undefined;
    };
    assert.equal(inputCode(() => desk.create("tg-a", draft({ activityId: "act_bbbbbbbbbbbbbbbbbbbbbbbb" }), own)), "invalid_reference");
    assert.equal(inputCode(() => desk.create("tg-a", draft({ activityId: "" }), own)), "invalid_reference");
    const view = desk.create("tg-a", draft({ activityId: "act_aaaaaaaaaaaaaaaaaaaaaaaa" }), own);
    assert.deepEqual(view.activityRef, { id: "act_aaaaaaaaaaaaaaaaaaaaaaaa", kind: "quote_previewed" });
    assert.deepEqual(asked, ["act_bbbbbbbbbbbbbbbbbbbbbbbb", "", "act_aaaaaaaaaaaaaaaaaaaaaaaa"]);
    assert.equal(desk.size(), 1);
  });
});

describe("support desk: bounds, TTL and rate limit", () => {
  it("caps open requests per subject without affecting other subjects", () => {
    const desk = createSupportDesk({ clock: () => 0, maxPerSubject: 2, rateLimit: 10 });
    desk.create("tg-a", draft(), noActivity);
    desk.create("tg-a", draft(), noActivity);
    assert.throws(() => desk.create("tg-a", draft(), noActivity), (error: unknown) => error instanceof SupportLimitError && error.code === "support_limit_reached");
    assert.equal(desk.list("tg-a").length, 2);
    assert.equal(desk.create("tg-b", draft(), noActivity).status, "received");
  });

  it("caps requests globally", () => {
    const desk = createSupportDesk({ clock: () => 0, maxTotal: 2 });
    desk.create("tg-a", draft(), noActivity);
    desk.create("tg-b", draft(), noActivity);
    assert.throws(() => desk.create("tg-c", draft(), noActivity), (error: unknown) => error instanceof SupportLimitError && error.code === "support_capacity");
    assert.equal(desk.size(), 2);
  });

  it("expires requests after the TTL and frees their capacity", () => {
    let now = 0;
    const desk = createSupportDesk({ clock: () => now, ttlMs: 1_000, maxPerSubject: 1, maxTotal: 1 });
    const old = desk.create("tg-a", draft(), noActivity);
    now = 999;
    assert.equal(desk.view("tg-a", old.id)?.id, old.id);
    now = 1_000;
    assert.equal(desk.view("tg-a", old.id), undefined);
    assert.deepEqual(desk.list("tg-a"), []);
    assert.equal(desk.size(), 0);
    assert.equal(desk.create("tg-b", draft(), noActivity).expiresAt, 2_000);
  });

  it("rate limits successful creations per subject in a sliding window", () => {
    let now = 0;
    const desk = createSupportDesk({ clock: () => now, rateLimit: 2, rateWindowMs: 1_000 });
    assert.equal(inputCode(() => desk.create("tg-a", draft({ topic: "" }), noActivity)), "invalid_topic");
    desk.create("tg-a", draft(), noActivity);
    now = 500;
    desk.create("tg-a", draft(), noActivity);
    assert.throws(() => desk.create("tg-a", draft(), noActivity), SupportRateLimitError);
    assert.throws(() => desk.create("tg-a", draft({ category: "nope" }), noActivity), SupportRateLimitError);
    assert.equal(desk.create("tg-b", draft(), noActivity).status, "received");
    now = 1_000;
    desk.create("tg-a", draft(), noActivity);
    assert.throws(() => desk.create("tg-a", draft(), noActivity), SupportRateLimitError);
    now = 1_500;
    assert.equal(desk.create("tg-a", draft(), noActivity).status, "received");
  });

  it("rejects non-positive or fractional bounds", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      for (const name of ["maxPerSubject", "maxTotal", "ttlMs", "rateLimit", "rateWindowMs"]) {
        assert.throws(() => createSupportDesk({ clock: () => 0, [name]: bad }), RangeError, `${name}=${bad}`);
      }
    }
  });
});

describe("support desk: status timeline", () => {
  it("advances only along received → in review → answered/closed for the owner", () => {
    let now = 0;
    const desk = createSupportDesk({ clock: () => now });
    const view = desk.create("tg-a", draft(), noActivity);
    assert.equal(desk.advance("tg-b", view.id, "in_review"), undefined);
    assert.equal(desk.advance("tg-a", view.id, "answered"), undefined);
    assert.equal(desk.advance("tg-a", view.id, "received"), undefined);
    now = 10;
    assert.equal(desk.advance("tg-a", view.id, "in_review")?.status, "in_review");
    now = 20;
    assert.equal(desk.advance("tg-a", view.id, "answered")?.status, "answered");
    now = 30;
    const closed = desk.advance("tg-a", view.id, "closed");
    assert.deepEqual(closed?.timeline, [
      { status: "received", at: 0 },
      { status: "in_review", at: 10 },
      { status: "answered", at: 20 },
      { status: "closed", at: 30 }
    ]);
    assert.equal(desk.advance("tg-a", view.id, "in_review"), undefined);
    assert.equal(desk.view("tg-a", view.id)?.status, "closed");
    assert.equal(view.status, "received");
  });

  it("returns frozen views that callers cannot modify", () => {
    const desk = createSupportDesk({ clock: () => 0 });
    const view = desk.create("tg-a", draft({ activityId: "act_aaaaaaaaaaaaaaaaaaaaaaaa" }), () => "session_login");
    assert.ok(Object.isFrozen(view));
    assert.ok(Object.isFrozen(view.timeline));
    assert.ok(Object.isFrozen(view.timeline[0]));
    assert.ok(Object.isFrozen(view.activityRef));
    assert.throws(() => {
      (view as { status: string }).status = "closed";
    }, TypeError);
    assert.equal(desk.view("tg-a", view.id)?.status, "received");
  });
});
