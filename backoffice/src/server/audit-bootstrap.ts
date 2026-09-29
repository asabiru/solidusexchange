import type { AuditSourceEvent } from "../data/demo.js";
import type { AuditConfig } from "./config.js";
import { type AuditStore, MemoryAuditStore } from "./audit-store.js";
import { PostgresAuditStore } from "./postgres-audit-store.js";

export async function createAuditStore(
  config: AuditConfig,
  seed: readonly AuditSourceEvent[]
): Promise<AuditStore> {
  if (config.storage === "memory") {
    return new MemoryAuditStore(seed, config.retentionDays);
  }

  const store = new PostgresAuditStore(config);
  try {
    await store.initialize(seed);
    return store;
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
