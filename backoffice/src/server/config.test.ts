import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadServerConfig } from "./config.js";

const auditEnvironment = [
  "BACKOFFICE_AUDIT_STORAGE",
  "BACKOFFICE_AUDIT_RETENTION_DAYS",
  "BACKOFFICE_AUDIT_DATABASE_URL"
] as const;
const original = Object.fromEntries(
  auditEnvironment.map((name) => [name, process.env[name]])
);

afterEach(() => {
  for (const name of auditEnvironment) {
    const value = original[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("audit configuration", () => {
  it("uses an explicit non-durable development default", () => {
    delete process.env.BACKOFFICE_AUDIT_STORAGE;
    delete process.env.BACKOFFICE_AUDIT_DATABASE_URL;
    const config = loadServerConfig();
    assert.equal(config.audit.storage, "memory");
    assert.equal(config.audit.retentionDays, 2_555);
  });

  it("requires a PostgreSQL URL when durable storage is selected", () => {
    process.env.BACKOFFICE_AUDIT_STORAGE = "postgresql";
    delete process.env.BACKOFFICE_AUDIT_DATABASE_URL;
    assert.throws(
      () => loadServerConfig(),
      /BACKOFFICE_AUDIT_DATABASE_URL is required/
    );
  });

  it("rejects unsupported storage and retention policy", () => {
    process.env.BACKOFFICE_AUDIT_STORAGE = "filesystem";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_AUDIT_STORAGE/);
    process.env.BACKOFFICE_AUDIT_STORAGE = "memory";
    process.env.BACKOFFICE_AUDIT_RETENTION_DAYS = "0";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_AUDIT_RETENTION_DAYS/);
  });
});
