import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { auditDatabaseUrl, FILES, prepareDevMaterial } from "../scripts/dev-material.mjs";

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "dev-material-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const read = (directory, file) => readFile(path.join(directory, file), "utf8").then((text) => text.trim());

test("generates every synthetic file with restrictive modes for private material", async () => {
  await withDirectory(async (directory) => {
    const result = await prepareDevMaterial({ directory });
    assert.deepEqual(result.sources, {
      customerApiTokenKey: "generated",
      auditSuperuserPassword: "generated",
      auditRuntimePassword: "generated",
      tls: "generated"
    });
    assert.deepEqual((await readdir(directory)).sort(), Object.values(FILES).sort());
    assert.match(await read(directory, FILES.customerApiTokenKey), /^[0-9a-f]{64}$/);
    for (const file of [FILES.auditSuperuserPassword, FILES.serverPrivateKey]) {
      assert.equal((await stat(path.join(directory, file))).mode & 0o777, 0o400, file);
    }
    for (const file of [FILES.customerApiTokenKey, FILES.auditDatabaseUrl, FILES.caCertificate]) {
      assert.equal((await stat(path.join(directory, file))).mode & 0o777, 0o444, file);
    }
    const runtimePassword = await read(directory, FILES.auditRuntimePassword);
    assert.equal(await read(directory, FILES.auditDatabaseUrl), auditDatabaseUrl(runtimePassword));
    const ca = new X509Certificate(await readFile(path.join(directory, FILES.caCertificate)));
    const server = new X509Certificate(await readFile(path.join(directory, FILES.serverCertificate)));
    assert.equal(server.checkIssued(ca), true);
  });
});

test("audit database URL targets the loopback runtime role only", () => {
  const url = new URL(auditDatabaseUrl("synthetic_password-value.0123456789"));
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.username, "backoffice_runtime");
  assert.equal(url.pathname, "/solidchange_audit");
});

test("takes well-formed values from the local .env", async () => {
  await withDirectory(async (directory) => {
    const env = {
      SOLIDCHANGE_DEV_CUSTOMER_API_TOKEN_KEY: "ab".repeat(32),
      SOLIDCHANGE_DEV_AUDIT_DB_SUPERUSER_PASSWORD: "local-superuser-placeholder-value",
      SOLIDCHANGE_DEV_AUDIT_DB_RUNTIME_PASSWORD: "local-runtime-placeholder-value"
    };
    const result = await prepareDevMaterial({ directory, env });
    assert.equal(result.sources.customerApiTokenKey, "env");
    assert.equal(result.sources.auditRuntimePassword, "env");
    assert.equal(await read(directory, FILES.customerApiTokenKey), "ab".repeat(32));
    assert.equal(await read(directory, FILES.auditSuperuserPassword), env.SOLIDCHANGE_DEV_AUDIT_DB_SUPERUSER_PASSWORD);
  });
});

test("rejects malformed overrides instead of using them", async () => {
  await withDirectory(async (directory) => {
    for (const env of [
      { SOLIDCHANGE_DEV_CUSTOMER_API_TOKEN_KEY: "AB".repeat(32) },
      { SOLIDCHANGE_DEV_CUSTOMER_API_TOKEN_KEY: "ab".repeat(31) },
      { SOLIDCHANGE_DEV_AUDIT_DB_RUNTIME_PASSWORD: "short" },
      { SOLIDCHANGE_DEV_AUDIT_DB_SUPERUSER_PASSWORD: "has spaces and is long enough to pass length" }
    ]) {
      await assert.rejects(prepareDevMaterial({ directory, env }), /has an invalid format/);
    }
  });
});

test("keeps database passwords across restarts but rotates the token key and TLS material", async () => {
  await withDirectory(async (directory) => {
    await prepareDevMaterial({ directory });
    const before = {
      superuser: await read(directory, FILES.auditSuperuserPassword),
      runtime: await read(directory, FILES.auditRuntimePassword),
      token: await read(directory, FILES.customerApiTokenKey),
      key: await read(directory, FILES.serverPrivateKey)
    };
    const result = await prepareDevMaterial({ directory });
    assert.equal(result.sources.auditSuperuserPassword, "kept");
    assert.equal(result.sources.auditRuntimePassword, "kept");
    assert.equal(await read(directory, FILES.auditSuperuserPassword), before.superuser);
    assert.equal(await read(directory, FILES.auditRuntimePassword), before.runtime);
    assert.notEqual(await read(directory, FILES.customerApiTokenKey), before.token);
    assert.notEqual(await read(directory, FILES.serverPrivateKey), before.key);
    assert.deepEqual((await readdir(directory)).filter((file) => file.endsWith(".tmp")), []);
  });
});
