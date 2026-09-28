import type { OperatorRole } from "../auth/access.js";

export interface OperatorSession {
  id: string;
  subject: string;
  email: string;
  name: string;
  role: OperatorRole;
  expiresAt: number;
}

export interface PendingLogin {
  nonce: string;
  verifier: string;
  expiresAt: number;
}

export class ExpiringStore<T extends { expiresAt: number }> {
  readonly #entries = new Map<string, T>();

  get(key: string): T | undefined {
    const value = this.#entries.get(key);
    if (!value) return undefined;
    if (value.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return value;
  }

  set(key: string, value: T): void {
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
}
