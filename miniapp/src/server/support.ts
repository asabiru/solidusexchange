import { randomBytes } from "node:crypto";
import type { ActivityKind, SupportRequestView, SupportTimelineEntry } from "../shared/api.js";
import {
  type SupportCategory,
  type SupportStatus,
  isSupportCategory,
  isValidSupportMessage,
  isValidSupportTopic
} from "../shared/support.js";

export const supportIdPattern = /^sup_[0-9a-f]{24}$/;
export const defaultMaxSupportPerSubject = 10;
export const defaultMaxSupportTotal = 1_000;
export const defaultSupportTtlMs = 24 * 60 * 60 * 1_000;
export const defaultSupportRateLimit = 5;
export const defaultSupportRateWindowMs = 10 * 60 * 1_000;

export type SupportInputCode = "invalid_category" | "invalid_topic" | "invalid_message" | "invalid_reference";

export class SupportInputError extends Error {
  constructor(readonly code: SupportInputCode) {
    super(code);
    this.name = "SupportInputError";
  }
}

export class SupportRateLimitError extends Error {
  constructor() {
    super("support_rate_limited");
    this.name = "SupportRateLimitError";
  }
}

export class SupportLimitError extends Error {
  constructor(readonly code: "support_limit_reached" | "support_capacity") {
    super(code);
    this.name = "SupportLimitError";
  }
}

export interface SupportDraftInput {
  category: string;
  topic: string;
  message: string;
  activityId?: string;
}

export type ActivityOwnerLookup = (id: string) => ActivityKind | undefined;

export interface SupportDeskOptions {
  clock: () => number;
  maxPerSubject?: number;
  maxTotal?: number;
  ttlMs?: number;
  rateLimit?: number;
  rateWindowMs?: number;
}

export interface SupportDesk {
  create(subject: string, input: SupportDraftInput, ownActivity: ActivityOwnerLookup): SupportRequestView;
  list(subject: string): readonly SupportRequestView[];
  view(subject: string, id: string): SupportRequestView | undefined;
  /** Synthetic fixtures and tests only: no route or operator can call this. */
  advance(subject: string, id: string, status: SupportStatus): SupportRequestView | undefined;
  size(): number;
}

interface Entry {
  subject: string;
  view: SupportRequestView;
}

const transitions: Readonly<Record<SupportStatus, readonly SupportStatus[]>> = Object.freeze({
  received: ["in_review", "closed"],
  in_review: ["answered", "closed"],
  answered: ["closed"],
  closed: []
});

function bound(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError("support bounds must be positive integers");
  return resolved;
}

function freezeView(view: SupportRequestView): SupportRequestView {
  return Object.freeze({
    ...view,
    ...(view.activityRef ? { activityRef: Object.freeze({ ...view.activityRef }) } : {}),
    timeline: Object.freeze(view.timeline.map((entry) => Object.freeze({ ...entry })))
  });
}

/**
 * Test-mode support request drafts. Nothing is sent to Telegram, email or any
 * other system and there is no operator: statuses only change through
 * `advance` in tests and synthetic fixtures. Bounded per subject and globally,
 * entries expire after a TTL and creation is rate limited per subject.
 */
export function createSupportDesk(options: SupportDeskOptions): SupportDesk {
  const maxPerSubject = bound(options.maxPerSubject, defaultMaxSupportPerSubject);
  const maxTotal = bound(options.maxTotal, defaultMaxSupportTotal);
  const ttlMs = bound(options.ttlMs, defaultSupportTtlMs);
  const rateLimit = bound(options.rateLimit, defaultSupportRateLimit);
  const rateWindowMs = bound(options.rateWindowMs, defaultSupportRateWindowMs);
  const entries = new Map<string, Entry>();
  const attempts = new Map<string, number[]>();

  function sweep(now: number): void {
    for (const [id, entry] of entries) if (entry.view.expiresAt <= now) entries.delete(id);
    for (const [subject, times] of attempts) {
      const recent = times.filter((at) => at > now - rateWindowMs);
      if (recent.length === 0) attempts.delete(subject);
      else attempts.set(subject, recent);
    }
  }

  function own(subject: string): Entry[] {
    return [...entries.values()].filter((entry) => entry.subject === subject);
  }

  return Object.freeze({
    create(subject: string, input: SupportDraftInput, ownActivity: ActivityOwnerLookup): SupportRequestView {
      const now = options.clock();
      sweep(now);
      const recent = attempts.get(subject) ?? [];
      if (recent.length >= rateLimit) throw new SupportRateLimitError();
      if (!isSupportCategory(input.category)) throw new SupportInputError("invalid_category");
      if (!isValidSupportTopic(input.topic)) throw new SupportInputError("invalid_topic");
      if (!isValidSupportMessage(input.message)) throw new SupportInputError("invalid_message");
      let activityRef: SupportRequestView["activityRef"];
      if (input.activityId !== undefined) {
        const kind = ownActivity(input.activityId);
        if (kind === undefined) throw new SupportInputError("invalid_reference");
        activityRef = { id: input.activityId, kind };
      }
      if (own(subject).length >= maxPerSubject) throw new SupportLimitError("support_limit_reached");
      if (entries.size >= maxTotal) throw new SupportLimitError("support_capacity");
      attempts.set(subject, [...recent, now]);
      const category: SupportCategory = input.category;
      const view = freezeView({
        id: `sup_${randomBytes(12).toString("hex")}`,
        mode: "test",
        delivery: "disabled",
        category,
        topic: input.topic.trim(),
        message: input.message.trim(),
        ...(activityRef ? { activityRef } : {}),
        status: "received",
        timeline: [{ status: "received", at: now }],
        complaintAcknowledged: category === "complaint",
        createdAt: now,
        expiresAt: now + ttlMs
      });
      entries.set(view.id, { subject, view });
      return view;
    },

    list(subject: string): readonly SupportRequestView[] {
      sweep(options.clock());
      return own(subject).reverse().map((entry) => entry.view);
    },

    view(subject: string, id: string): SupportRequestView | undefined {
      if (!supportIdPattern.test(id)) return undefined;
      sweep(options.clock());
      const entry = entries.get(id);
      return entry?.subject === subject ? entry.view : undefined;
    },

    advance(subject: string, id: string, status: SupportStatus): SupportRequestView | undefined {
      const now = options.clock();
      sweep(now);
      const entry = entries.get(id);
      if (entry?.subject !== subject || !transitions[entry.view.status].includes(status)) return undefined;
      const timeline: SupportTimelineEntry[] = [...entry.view.timeline, { status, at: now }];
      entry.view = freezeView({ ...entry.view, status, timeline });
      return entry.view;
    },

    size(): number {
      sweep(options.clock());
      return entries.size;
    }
  });
}
