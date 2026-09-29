import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadServerConfig } from "./config.js";

const configurationEnvironment = [
  "BACKOFFICE_AUDIT_STORAGE",
  "BACKOFFICE_AUDIT_RETENTION_DAYS",
  "BACKOFFICE_AUDIT_DATABASE_URL",
  "BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS",
  "BACKOFFICE_STEP_UP_GRANT_TTL_SECONDS",
  "BACKOFFICE_STEP_UP_MAX_ATTEMPTS",
  "BACKOFFICE_SIGNING_ROTATION_SECONDS",
  "BACKOFFICE_SIGNING_RETAINED_KEYS"
] as const;
const original = Object.fromEntries(
  configurationEnvironment.map((name) => [name, process.env[name]])
);

afterEach(() => {
  for (const name of configurationEnvironment) {
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
    assert.deepEqual(config.stepUp, {
      provider: "synthetic-dev",
      challengeTtlSeconds: 300,
      grantTtlSeconds: 60,
      maxAttempts: 3
    });
    assert.deepEqual(config.signing, {
      backend: "ephemeral-dev",
      rotationSeconds: 900,
      retainedVerificationKeys: 2
    });
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

  it("rejects unsafe step-up lifecycle settings", () => {
    process.env.BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS = "29";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS/);
    delete process.env.BACKOFFICE_STEP_UP_CHALLENGE_TTL_SECONDS;
    process.env.BACKOFFICE_STEP_UP_MAX_ATTEMPTS = "6";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_STEP_UP_MAX_ATTEMPTS/);
  });

  it("rejects unsafe signing lifecycle settings", () => {
    process.env.BACKOFFICE_SIGNING_ROTATION_SECONDS = "59";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_SIGNING_ROTATION_SECONDS/);
    delete process.env.BACKOFFICE_SIGNING_ROTATION_SECONDS;
    process.env.BACKOFFICE_SIGNING_RETAINED_KEYS = "0";
    assert.throws(() => loadServerConfig(), /BACKOFFICE_SIGNING_RETAINED_KEYS/);
  });
});
