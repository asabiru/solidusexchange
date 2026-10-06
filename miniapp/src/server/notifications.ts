import { createHash } from "node:crypto";
import type { NotificationDraft, NotificationTemplate } from "../shared/api.js";

export interface NotificationOutboxOptions {
  clock: () => number;
  maxPerSubject?: number;
  maxTotal?: number;
}

export interface NotificationOutbox {
  record(subject: string, template: NotificationTemplate): NotificationDraft;
  list(subject: string, limit?: number): readonly NotificationDraft[];
  unread(subject: string): number;
  markRead(subject: string, ids: readonly string[]): number;
  size(): number;
}

export const notificationIdPattern = /^ntf_[0-9a-f]{24}$/;
export const defaultMaxPerSubject = 20;
export const defaultMaxTotal = 1_000;

const marker = "Тестовый режим";

export const notificationTexts: Readonly<Record<NotificationTemplate, string>> = Object.freeze({
  session_login: `${marker}. Выполнен вход в SOLID.`,
  kyc_submitted: `${marker}. Заявка на проверку личности принята.`,
  kyc_in_review: `${marker}. Заявка на проверку личности рассматривается.`,
  kyc_approved: `${marker}. Проверка личности пройдена.`,
  kyc_rejected: `${marker}. Проверка личности не пройдена.`,
  kyc_needs_more_data: `${marker}. Для проверки личности нужны дополнительные данные.`,
  kyc_timed_out: `${marker}. Срок рассмотрения заявки истёк.`,
  kyc_unavailable: `${marker}. Сервис проверки личности временно недоступен.`,
  support_received: `${marker}. Обращение сохранено, его никто не получит.`,
  complaint_received: `${marker}. Жалоба сохранена, её никто не получит.`
});

interface Entry {
  subject: string;
  draft: NotificationDraft;
}

function bound(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError("outbox bounds must be positive integers");
  return resolved;
}

/**
 * Test-mode customer notification outbox. It only records drafts for
 * server-verified state changes; it never sends, has no network access and
 * never sees a bot token. Bounded per subject and globally (oldest first out).
 */
export function createNotificationOutbox(options: NotificationOutboxOptions): NotificationOutbox {
  const maxPerSubject = bound(options.maxPerSubject, defaultMaxPerSubject);
  const maxTotal = bound(options.maxTotal, defaultMaxTotal);
  const entries: Entry[] = [];
  const sequences = new Map<string, number>();

  function idOf(subject: string, sequence: number): string {
    const digest = createHash("sha256").update(`solidchange-miniapp-notification|${subject}|${sequence}`).digest("hex");
    return `ntf_${digest.slice(0, 24)}`;
  }

  function own(subject: string): Entry[] {
    return entries.filter((entry) => entry.subject === subject);
  }

  return Object.freeze({
    record(subject: string, template: NotificationTemplate): NotificationDraft {
      const text = notificationTexts[template];
      if (text === undefined) throw new RangeError("unknown notification template");
      const sequence = (sequences.get(subject) ?? 0) + 1;
      sequences.set(subject, sequence);
      const draft: NotificationDraft = {
        id: idOf(subject, sequence),
        createdAt: options.clock(),
        channel: "telegram-draft",
        template,
        locale: "ru",
        text,
        mode: "test",
        delivered: false,
        read: false
      };
      entries.push({ subject, draft });
      if (own(subject).length > maxPerSubject) {
        entries.splice(entries.findIndex((entry) => entry.subject === subject), 1);
      }
      while (entries.length > maxTotal) entries.shift();
      return { ...draft };
    },

    list(subject: string, limit = maxPerSubject): readonly NotificationDraft[] {
      return own(subject).reverse().slice(0, Math.max(0, limit)).map((entry) => ({ ...entry.draft }));
    },

    unread(subject: string): number {
      return own(subject).filter((entry) => !entry.draft.read).length;
    },

    markRead(subject: string, ids: readonly string[]): number {
      const wanted = new Set(ids);
      let marked = 0;
      for (const entry of own(subject)) {
        if (!entry.draft.read && wanted.has(entry.draft.id)) {
          entry.draft.read = true;
          marked += 1;
        }
      }
      return marked;
    },

    size(): number {
      return entries.length;
    }
  });
}
