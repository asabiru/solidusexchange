import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { AuditEvent, AuditSourceEvent } from "../data/demo.js";
import type { AuditConfig } from "./config.js";
import {
  AuditIntegrityError,
  type AuditStore,
  AuditUnavailableError,
  type VerifiedAuditSnapshot
} from "./audit-store.js";
import {
  auditGenesisHash,
  buildAuditChain,
  buildAuditEvent,
  verifyAuditChain
} from "./controls.js";

const schemaVersion = 1;
const appendLockNamespace = 7_230;
const appendLockResource = 44_279;

interface AuditRow extends QueryResultRow {
  sequence: string;
  event_id: string;
  occurred_at: Date;
  actor: string;
  action: string;
  resource: string;
  outcome: string;
  evidence_digest: string;
  previous_hash: string;
  hash: string;
}

function parseOutcome(value: string): AuditSourceEvent["outcome"] {
  if (value === "recorded" || value === "denied" || value === "reviewed") return value;
  throw new AuditIntegrityError("Audit record has an unsupported outcome");
}

function toAuditEvent(row: AuditRow): AuditEvent {
  const source: AuditSourceEvent = {
    eventId: row.event_id,
    occurredAt: row.occurred_at.toISOString(),
    actor: row.actor,
    action: row.action,
    resource: row.resource,
    outcome: parseOutcome(row.outcome),
    evidenceDigest: row.evidence_digest
  };
  const event = buildAuditEvent(Number(row.sequence), row.previous_hash.trim(), source);
  if (event.hash !== row.hash.trim()) {
    throw new AuditIntegrityError("Stored audit hash does not match canonical content");
  }
  return event;
}

function verified(events: readonly AuditEvent[]): readonly AuditEvent[] {
  if (!verifyAuditChain(events)) throw new AuditIntegrityError();
  return Object.freeze(events);
}

export function buildPostgresPoolConfig(value: string): PoolConfig {
  const url = new URL(value);
  for (const parameter of [...url.searchParams.keys()]) {
    if (parameter.toLowerCase().startsWith("ssl")) url.searchParams.delete(parameter);
  }
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000
  };
}

export class PostgresAuditStore implements AuditStore {
  readonly #pool: Pool;
  readonly #retentionDays: number;

  constructor(config: AuditConfig) {
    if (!config.databaseUrl) throw new AuditUnavailableError();
    this.#retentionDays = config.retentionDays;
    this.#pool = new Pool(buildPostgresPoolConfig(config.databaseUrl));
  }

  async initialize(seed: readonly AuditSourceEvent[]): Promise<void> {
    const client = await this.#connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [appendLockNamespace, appendLockResource]
      );
      const schema = await client.query<{ schema_version: number }>(
        "SELECT schema_version FROM backoffice_control.audit_schema WHERE singleton = true"
      );
      if (schema.rows.length !== 1 || schema.rows[0].schema_version !== schemaVersion) {
        throw new AuditIntegrityError("Audit schema version is unavailable or incompatible");
      }

      const existing = await this.#read(client);
      if (existing.length === 0) {
        for (const event of buildAuditChain(seed)) {
          await this.#insert(client, event);
        }
      } else {
        verified(existing);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw this.#storeError(error);
    } finally {
      client.release();
    }
    await this.snapshot();
  }

  async snapshot(): Promise<VerifiedAuditSnapshot> {
    try {
      const events = verified(await this.#read(this.#pool));
      return {
        events,
        status: {
          backend: "postgresql",
          durable: true,
          retentionDays: this.#retentionDays,
          verified: true,
          length: events.length,
          headHash: events.at(-1)?.hash ?? auditGenesisHash
        }
      };
    } catch (error) {
      throw this.#storeError(error);
    }
  }

  async append(event: AuditSourceEvent, expectedHeadHash: string): Promise<AuditEvent> {
    const client = await this.#connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query(
        "SELECT pg_advisory_xact_lock($1, $2)",
        [appendLockNamespace, appendLockResource]
      );
      const events = verified(await this.#read(client));
      const headHash = events.at(-1)?.hash ?? auditGenesisHash;
      if (headHash !== expectedHeadHash) {
        throw new AuditIntegrityError("Audit head changed before append");
      }
      if (events.some((existing) => existing.eventId === event.eventId)) {
        throw new AuditIntegrityError("Audit event ID already exists");
      }
      const appended = buildAuditEvent(events.length + 1, headHash, event);
      await this.#insert(client, appended);
      await client.query("COMMIT");
      return appended;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw this.#storeError(error);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #connect(): Promise<PoolClient> {
    try {
      return await this.#pool.connect();
    } catch {
      throw new AuditUnavailableError();
    }
  }

  async #read(connection: Pool | PoolClient): Promise<readonly AuditEvent[]> {
    const result = await connection.query<AuditRow>(
      `SELECT sequence, event_id, occurred_at, actor, action, resource, outcome,
              evidence_digest, previous_hash, hash
         FROM backoffice_control.audit_events
        ORDER BY sequence ASC`
    );
    return result.rows.map(toAuditEvent);
  }

  async #insert(client: PoolClient, event: AuditEvent): Promise<void> {
    const retentionUntil = new Date(event.occurredAt);
    retentionUntil.setUTCDate(retentionUntil.getUTCDate() + this.#retentionDays);
    await client.query(
      `INSERT INTO backoffice_control.audit_events (
         sequence, event_id, occurred_at, actor, action, resource, outcome,
         evidence_digest, previous_hash, hash, retention_until
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.sequence,
        event.eventId,
        event.occurredAt,
        event.actor,
        event.action,
        event.resource,
        event.outcome,
        event.evidenceDigest,
        event.previousHash,
        event.hash,
        retentionUntil
      ]
    );
  }

  #storeError(error: unknown): AuditIntegrityError | AuditUnavailableError {
    if (error instanceof AuditIntegrityError) return error;
    return new AuditUnavailableError();
  }
}
