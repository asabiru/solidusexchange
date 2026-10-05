import type { OperatorRole } from "../auth/access.js";

export interface OperatorSession {
  id: string;
  subject: string;
  email: string;
  name: string;
  role: OperatorRole;
  deviceId?: string;
  expiresAt: number;
}

export interface PendingLogin {
  nonce: string;
  verifier: string;
  previousSessionId?: string;
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

  deleteWhere(predicate: (value: T) => boolean): void {
    for (const [key, value] of this.#entries) {
      if (predicate(value)) this.#entries.delete(key);
    }
  }
}
