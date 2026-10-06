import { createHash, randomBytes } from "node:crypto";
import type {
  ActivityItem,
  AddressScreeningStatus,
  AddressScreeningView,
  KycVerificationState,
  QuotePreview,
  SessionSource
} from "../shared/api.js";

export const activityIdPattern = /^act_[0-9a-f]{24}$/;
export const maxActivityPerSubject = 50;
export const maxActivitySubjects = 1_000;

export interface ActivityLogOptions {
  clock: () => number;
  maxPerSubject?: number;
  maxSubjects?: number;
}

export type ScreeningStatusLookup = () => AddressScreeningStatus | undefined;

export interface ActivityLog {
  recordLogin(subject: string, source: SessionSource): void;
  recordSessionsRevoked(subject: string, scope: "single" | "others", count: number): void;
  recordKyc(subject: string, state: KycVerificationState): void;
  recordQuote(subject: string, quote: QuotePreview): void;
  recordScreening(subject: string, view: AddressScreeningView, current?: ScreeningStatusLookup): void;
  list(subject: string, limit?: number): readonly ActivityItem[];
  size(subject: string): number;
  subjects(): number;
}

interface Entry {
  item: ActivityItem;
  current?: ScreeningStatusLookup;
}

function bound(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError("activity bounds must be positive integers");
  return resolved;
}

/**
 * Test-mode customer activity history. Entries come only from server-side
 * events (session start and revocation, trusted KYC transitions, quote previews and address
 * screenings); clients cannot create them. Only display-safe fields are kept:
 * no addresses, provider references or personal data. Bounded per subject and
 * by subject count (least recently active subject first out).
 */
export function createActivityLog(options: ActivityLogOptions): ActivityLog {
  const maxPerSubject = bound(options.maxPerSubject, maxActivityPerSubject);
  const maxSubjects = bound(options.maxSubjects, maxActivitySubjects);
  const salt = randomBytes(16).toString("hex");
  const logs = new Map<string, Entry[]>();
  let sequence = 0;

  function nextId(subject: string): string {
    sequence += 1;
    const digest = createHash("sha256").update(`solidchange-miniapp-activity|${salt}|${subject}|${sequence}`).digest("hex");
    return `act_${digest.slice(0, 24)}`;
  }

  function append(subject: string, entry: Entry): void {
    const entries = logs.get(subject) ?? [];
    logs.delete(subject);
    logs.set(subject, entries);
    entries.push(entry);
    if (entries.length > maxPerSubject) entries.splice(0, entries.length - maxPerSubject);
    while (logs.size > maxSubjects) {
      const oldest = logs.keys().next().value;
      if (oldest === undefined) break;
      logs.delete(oldest);
    }
  }

  function refresh(entry: Entry): void {
    if (!entry.current || entry.item.kind !== "address_screened") return;
    const status = entry.current();
    if (status === undefined) {
      entry.current = undefined;
      return;
    }
    entry.item = Object.freeze({ ...entry.item, status });
    if (status !== "pending") entry.current = undefined;
  }

  return Object.freeze({
    recordLogin(subject: string, source: SessionSource): void {
      append(subject, { item: Object.freeze({ id: nextId(subject), at: options.clock(), kind: "session_login", source }) });
    },

    recordSessionsRevoked(subject: string, scope: "single" | "others", count: number): void {
      if (!Number.isSafeInteger(count) || count < 1) return;
      append(subject, { item: Object.freeze({ id: nextId(subject), at: options.clock(), kind: "session_revoked", scope, count }) });
    },

    recordKyc(subject: string, state: KycVerificationState): void {
      if (state === "not_started") return;
      append(subject, { item: Object.freeze({ id: nextId(subject), at: options.clock(), kind: `kyc_${state}` as const }) });
    },

    recordQuote(subject: string, quote: QuotePreview): void {
      append(subject, {
        item: Object.freeze({
          id: nextId(subject),
          at: options.clock(),
          kind: "quote_previewed",
          pair: `${quote.rate.base}/${quote.rate.quote}` as const,
          side: quote.from === quote.rate.base ? "sell" as const : "buy" as const,
          from: quote.from,
          to: quote.to,
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          fee: quote.fee,
          feeAsset: quote.feeAsset,
          rate: Object.freeze({ base: quote.rate.base, quote: quote.rate.quote, value: quote.rate.value }),
          executable: false
        })
      });
    },

    recordScreening(subject: string, view: AddressScreeningView, current?: ScreeningStatusLookup): void {
      append(subject, {
        item: Object.freeze({
          id: nextId(subject),
          at: options.clock(),
          kind: "address_screened",
          asset: view.asset,
          network: view.network,
          status: view.status,
          advisory: true,
          executable: false
        }),
        current: view.status === "pending" ? current : undefined
      });
    },

    list(subject: string, limit = maxPerSubject): readonly ActivityItem[] {
      const count = Math.min(Math.floor(limit), maxPerSubject);
      if (!(count >= 1)) return [];
      const newest = (logs.get(subject) ?? []).slice(-count).reverse();
      for (const entry of newest) refresh(entry);
      return newest.map((entry) => entry.item);
    },

    size(subject: string): number {
      return logs.get(subject)?.length ?? 0;
    },

    subjects(): number {
      return logs.size;
    }
  });
}
