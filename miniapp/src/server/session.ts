import { createHmac, randomBytes } from "node:crypto";

export type KycState = "verified" | "kyc-gated";

export const sessionHandlePattern = /^ses_[0-9a-f]{32}$/;
/** Last-seen is refreshed at most once per minute per session. */
export const lastSeenGranularityMs = 60_000;

export interface CustomerSession {
  id: string;
  subject: string;
  source: "telegram" | "dev-synthetic";
  kyc: KycState;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

/**
 * Opaque per-process session handles: an HMAC of the session id under a key
 * that never leaves memory, so a handle cannot be turned back into a cookie.
 */
export function createSessionHandles(key: Buffer = randomBytes(32)): (id: string) => string {
  return (id) => `ses_${createHmac("sha256", key).update(`solidchange-miniapp-session-handle|${id}`).digest("hex").slice(0, 32)}`;
}

export class ExpiringStore<T extends { expiresAt: number }> {
  readonly #entries = new Map<string, T>();
  readonly #clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.#clock = clock;
  }

  get(key: string): T | undefined {
    const value = this.#entries.get(key);
    if (!value) return undefined;
    if (value.expiresAt <= this.#clock()) {
      this.#entries.delete(key);
      return undefined;
    }
    return value;
  }

  set(key: string, value: T): void {
    const now = this.#clock();
    for (const [entryKey, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(entryKey);
    }
    this.#entries.set(key, value);
  }

  /** Keeps only the `limit` most recently stored entries matching `match`. */
  retainNewest(match: (value: T) => boolean, limit: number): void {
    const matching = [...this.#entries].filter(([, value]) => match(value));
    for (const [key] of matching.slice(0, Math.max(0, matching.length - limit))) {
      this.#entries.delete(key);
    }
  }

  /** Unexpired entries matching `match`, in insertion order. */
  entries(match: (value: T) => boolean): readonly (readonly [string, T])[] {
    const now = this.#clock();
    return [...this.#entries].filter(([, value]) => value.expiresAt > now && match(value));
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  /** Number of unexpired entries. */
  size(): number {
    const now = this.#clock();
    let count = 0;
    for (const entry of this.#entries.values()) {
      if (entry.expiresAt > now) count += 1;
    }
    return count;
  }
}
