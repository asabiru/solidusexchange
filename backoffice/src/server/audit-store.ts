import type { AuditEvent, AuditSourceEvent } from "../data/demo.js";
import {
  auditGenesisHash,
  buildAuditChain,
  buildAuditEvent,
  verifyAuditChain
} from "./controls.js";

export type AuditBackend = "synthetic-memory" | "postgresql";

export interface AuditStoreStatus {
  backend: AuditBackend;
  durable: boolean;
  retentionDays: number;
  verified: true;
  length: number;
  headHash: string;
}

export interface VerifiedAuditSnapshot {
  events: readonly AuditEvent[];
  status: AuditStoreStatus;
}

export interface AuditStore {
  snapshot(): Promise<VerifiedAuditSnapshot>;
  append(event: AuditSourceEvent, expectedHeadHash: string): Promise<AuditEvent>;
  close(): Promise<void>;
}

export class AuditStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditStoreError";
  }
}

export class AuditIntegrityError extends AuditStoreError {
  constructor(message = "Audit chain integrity verification failed") {
    super(message);
    this.name = "AuditIntegrityError";
  }
}

export class AuditUnavailableError extends AuditStoreError {
  constructor(message = "Audit storage is unavailable") {
    super(message);
    this.name = "AuditUnavailableError";
  }
}

// Bounded in-memory chain: every audited view appends one event, so without a
// cap the store (and the O(n) chain re-verification on each operation) would
// grow without bound for the life of the server. Once full it fails closed —
// appends throw and audited views answer 503 rather than grow silently.
export class MemoryAuditStore implements AuditStore {
  readonly #retentionDays: number;
  readonly #maxEvents: number;
  #events: readonly AuditEvent[];

  constructor(source: readonly AuditSourceEvent[], retentionDays: number, maxEvents = 10_000) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < source.length) {
      throw new AuditUnavailableError("Audit capacity cannot hold the seed chain");
    }
    this.#retentionDays = retentionDays;
    this.#maxEvents = maxEvents;
    this.#events = buildAuditChain(source);
    this.#verifiedEvents();
  }

  async snapshot(): Promise<VerifiedAuditSnapshot> {
    const events = this.#verifiedEvents();
    return {
      events,
      status: {
        backend: "synthetic-memory",
        durable: false,
        retentionDays: this.#retentionDays,
        verified: true,
        length: events.length,
        headHash: events.at(-1)?.hash ?? auditGenesisHash
      }
    };
  }

  async append(event: AuditSourceEvent, expectedHeadHash: string): Promise<AuditEvent> {
    const events = this.#verifiedEvents();
    const headHash = events.at(-1)?.hash ?? auditGenesisHash;
    if (headHash !== expectedHeadHash) {
      throw new AuditIntegrityError("Audit head changed before append");
    }
    if (events.some((existing) => existing.eventId === event.eventId)) {
      throw new AuditIntegrityError("Audit event ID already exists");
    }
    if (events.length >= this.#maxEvents) {
      throw new AuditUnavailableError("Audit capacity is exhausted");
    }
    const next = buildAuditEvent(
      events.length + 1,
      headHash,
      event
    );
    this.#events = Object.freeze([...events, next]);
    return next;
  }

  async close(): Promise<void> {}

  #verifiedEvents(): readonly AuditEvent[] {
    if (!verifyAuditChain(this.#events)) throw new AuditIntegrityError();
    return this.#events;
  }
}
