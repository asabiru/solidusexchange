import type { NotificationsView } from "../shared/api.js";
import type { LocaleStorage } from "./i18n.js";

export const notificationSeenStorageKey = "solidchange.miniapp.notifications.seen";
const maxSeenIds = 200;
const seenIdPattern = /^ntf_[0-9a-f]{24}$/;

/** Accessing storage itself can throw (restricted modes); callers then pass undefined. */
export function notificationSeenStorage(): LocaleStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isSeenId(value: unknown): value is string {
  return typeof value === "string" && seenIdPattern.test(value);
}

/** Reads the cosmetic seen-set this browser recorded earlier; garbage parses as empty. */
export function loadSeenIds(storage: LocaleStorage | undefined): ReadonlySet<string> {
  try {
    const raw = storage?.getItem(notificationSeenStorageKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isSeenId));
  } catch {
    return new Set();
  }
}

/** Merges freshly displayed ids into the stored seen-set, evicting the oldest past the cap. */
export function rememberSeenIds(storage: LocaleStorage | undefined, ids: readonly string[]): ReadonlySet<string> {
  const seen = new Set(loadSeenIds(storage));
  let changed = false;
  for (const id of ids) {
    if (isSeenId(id) && !seen.has(id)) {
      seen.add(id);
      changed = true;
    }
  }
  if (!changed || !storage) return seen;
  const kept = [...seen].slice(-maxSeenIds);
  try {
    storage.setItem(notificationSeenStorageKey, JSON.stringify(kept));
    return new Set(kept);
  } catch {
    return seen;
  }
}

export function unseenNotifications(view: NotificationsView, seen: ReadonlySet<string>): number {
  return view.notifications.filter((draft) => !draft.read && !seen.has(draft.id)).length;
}

/** Rewrites the badge counter to the drafts this browser has not opened yet. */
export function withLocalUnread(view: NotificationsView, storage: LocaleStorage | undefined): NotificationsView {
  return { ...view, unread: unseenNotifications(view, loadSeenIds(storage)) };
}
