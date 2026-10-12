import type { SessionStorageConfig } from "./config.js";
import { type SessionStore, createMemorySessionStore } from "./session-store.js";
import { createPostgresSessionStore } from "./postgres-session-store.js";

export async function createSessionStore(
  config: SessionStorageConfig | undefined
): Promise<SessionStore> {
  const storage = config?.storage ?? "memory";
  if (storage === "memory") {
    const store = createMemorySessionStore();
    await store.initialize();
    return store;
  }

  const store = createPostgresSessionStore({ dsn: config?.databaseUrl });
  try {
    await store.initialize();
    return store;
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}
