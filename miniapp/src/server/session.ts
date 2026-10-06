export type KycState = "verified" | "kyc-gated";

export interface CustomerSession {
  id: string;
  subject: string;
  source: "telegram" | "dev-synthetic";
  kyc: KycState;
  expiresAt: number;
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

  delete(key: string): void {
    this.#entries.delete(key);
  }
}
