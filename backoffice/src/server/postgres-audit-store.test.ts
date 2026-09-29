import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildPostgresPoolConfig } from "./postgres-audit-store.js";

describe("PostgreSQL audit storage", () => {
  it("forces verified TLS and ignores URL-level SSL overrides", () => {
    const config = buildPostgresPoolConfig(
      "postgresql://audit:secret@db.example.test/control?sslmode=disable&sslrootcert=untrusted&application_name=backoffice"
    );
    assert.equal(typeof config.ssl === "object" && config.ssl !== null
      ? config.ssl.rejectUnauthorized
      : undefined, true);
    assert.equal(config.connectionString?.includes("sslmode"), false);
    assert.equal(config.connectionString?.includes("sslrootcert"), false);
    assert.equal(config.connectionString?.includes("application_name=backoffice"), true);
  });

  it("ships an append-only versioned schema", async () => {
    const migration = await readFile(
      new URL("../../migrations/0001_append_only_audit.sql", import.meta.url),
      "utf8"
    );
    assert.match(migration, /schema_version integer NOT NULL/);
    assert.match(migration, /stale or non-contiguous audit append/);
    assert.match(migration, /BEFORE INSERT ON backoffice_control\.audit_events/);
    assert.match(migration, /BEFORE UPDATE OR DELETE/);
    assert.match(migration, /BEFORE TRUNCATE/);
    assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE/);
    assert.match(migration, /retention_until timestamptz NOT NULL/);
  });
});
