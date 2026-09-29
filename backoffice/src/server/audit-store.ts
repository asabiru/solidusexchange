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

export class MemoryAuditStore implements AuditStore {
  readonly #retentionDays: number;
  #events: readonly AuditEvent[];

  constructor(source: readonly AuditSourceEvent[], retentionDays: number) {
    this.#retentionDays = retentionDays;
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
