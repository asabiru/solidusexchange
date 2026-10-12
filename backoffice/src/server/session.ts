export interface PendingLogin {
  nonce: string;
  verifier: string;
  /**
   * `sub` is unknowable until the token verifies, so the outstanding bound
   * keys on the initiating identity: the live session's subject when one
   * exists, otherwise the chain of transaction cookies this browser
   * presented (self-rooted on a first login).
   */
  initiator: string;
  previousSessionToken?: string;
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

  take(key: string): T | undefined {
    const value = this.get(key);
    this.#entries.delete(key);
    return value;
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  /** Keeps only the `limit` most recently stored entries matching `match`. */
  retainNewest(match: (value: T) => boolean, limit: number): void {
    const matching = [...this.#entries].filter(([, value]) => match(value));
    for (const [key] of matching.slice(0, Math.max(0, matching.length - limit))) {
      this.#entries.delete(key);
    }
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

  deleteWhere(predicate: (value: T) => boolean): void {
    for (const [key, value] of this.#entries) {
      if (predicate(value)) this.#entries.delete(key);
    }
  }
}
