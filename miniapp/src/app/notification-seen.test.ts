import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NotificationsView } from "../shared/api.js";
import type { LocaleStorage } from "./i18n.js";
import {
  loadSeenIds,
  notificationSeenStorageKey,
  rememberSeenIds,
  unseenNotifications,
  withLocalUnread
} from "./notification-seen.js";

const id = (value: number) => `ntf_${value.toString(16).padStart(24, "0")}`;

function memoryStorage(initial: Record<string, string> = {}): LocaleStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => (Object.hasOwn(values, key) ? values[key] ?? null : null),
    setItem: (key, value) => {
      values[key] = value;
    }
  };
}

const throwingStorage: LocaleStorage = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("storage disabled");
  }
};

function view(ids: readonly string[], read: readonly string[] = []): NotificationsView {
  return {
    mode: "test",
    delivery: "disabled",
    unread: ids.length - read.length,
    notifications: ids.map((value, index) => ({
      id: value,
      createdAt: 1_000 + index,
      channel: "telegram-draft" as const,
      template: "session_login" as const,
      locale: "ru" as const,
      text: "draft",
      mode: "test" as const,
      delivered: false as const,
      read: read.includes(value)
    }))
  };
}

describe("notification seen marker", () => {
  it("reads a stored id set and ignores malformed payloads", () => {
    assert.deepEqual(loadSeenIds(memoryStorage()), new Set());
    for (const bad of ["not-json", "{}", "123", "\"ntf_x\"", "[1, true, null]", "[\"ntf_zz\"]", "[\"__proto__\"]"]) {
      assert.deepEqual(loadSeenIds(memoryStorage({ [notificationSeenStorageKey]: bad })), new Set(), bad);
    }
    const stored = memoryStorage({ [notificationSeenStorageKey]: JSON.stringify([id(1), id(2)]) });
    assert.deepEqual(loadSeenIds(stored), new Set([id(1), id(2)]));
    assert.equal(loadSeenIds(undefined).size, 0);
    assert.equal(loadSeenIds(throwingStorage).size, 0);
  });

  it("merges new ids, dedupes and persists them under the solidchange key", () => {
    const storage = memoryStorage({ [notificationSeenStorageKey]: JSON.stringify([id(1)]) });
    const seen = rememberSeenIds(storage, [id(2), id(2), "garbage"]);
    assert.deepEqual([...seen].sort(), [id(1), id(2)].sort());
    assert.deepEqual(JSON.parse(storage.values[notificationSeenStorageKey] ?? "[]"), [id(1), id(2)]);
    assert.equal(storage.values[notificationSeenStorageKey]?.includes("garbage"), false);
    const before = storage.values[notificationSeenStorageKey];
    rememberSeenIds(storage, [id(1)]);
    assert.equal(storage.values[notificationSeenStorageKey], before);
  });

  it("keeps working without storage and still returns the merged set", () => {
    assert.deepEqual([...rememberSeenIds(undefined, [id(1)])], [id(1)]);
    assert.deepEqual([...rememberSeenIds(throwingStorage, [id(1)])], [id(1)]);
    assert.deepEqual(loadSeenIds(throwingStorage), new Set());
  });

  it("evicts the oldest ids beyond the cap", () => {
    const storage = memoryStorage();
    const many = Array.from({ length: 205 }, (_, index) => id(index + 1));
    const seen = rememberSeenIds(storage, many);
    assert.equal(seen.size, 200);
    assert.equal(seen.has(id(1)), false);
    assert.equal(seen.has(id(205)), true);
  });

  it("counts only drafts neither marked read nor seen locally", () => {
    const inbox = view([id(1), id(2), id(3)]);
    assert.equal(unseenNotifications(inbox, new Set()), 3);
    assert.equal(unseenNotifications(inbox, new Set([id(1), id(3)])), 1);
    const withRead = view([id(1), id(2)], [id(2)]);
    assert.equal(unseenNotifications(withRead, new Set()), 1);
  });

  it("rewrites the view badge from local seen state", () => {
    const storage = memoryStorage({ [notificationSeenStorageKey]: JSON.stringify([id(1)]) });
    const adjusted = withLocalUnread(view([id(1), id(2)]), storage);
    assert.equal(adjusted.unread, 1);
    assert.equal(adjusted.notifications.length, 2);
    assert.equal(adjusted.mode, "test");
  });
});
