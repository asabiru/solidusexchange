// Generates dev-only synthetic secrets for the local stack at container start.
// Values may instead come from a gitignored infra/local/.env; nothing is baked
// into images or committed.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDevTlsMaterial } from "./x509.mjs";

export const DEFAULT_DIRECTORY = "/run/solidchange-dev";
export const AUDIT_DATABASE = Object.freeze({
  host: "127.0.0.1",
  port: 5432,
  name: "solidchange_audit",
  runtimeRole: "backoffice_runtime"
});

const TOKEN_KEY = /^[0-9a-f]{64}$/;
const PASSWORD = /^[A-Za-z0-9._~-]{24,128}$/;

export const FILES = Object.freeze({
  customerApiTokenKey: "customer-api-dev-token.key",
  auditSuperuserPassword: "audit-db-superuser.password",
  auditRuntimePassword: "audit-db-runtime.password",
  auditDatabaseUrl: "backoffice-audit-database.url",
  caCertificate: "dev-ca.crt",
  serverCertificate: "audit-db-server.crt",
  serverPrivateKey: "audit-db-server.key"
});

function fromEnv(env, name, pattern) {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!pattern.test(value)) throw new Error(`${name} has an invalid format`);
  return value;
}

async function existing(directory, file, pattern) {
  try {
    const value = (await readFile(path.join(directory, file), "utf8")).trim();
    return pattern.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function writeAtomically(directory, file, contents, mode) {
  const target = path.join(directory, file);
  const temporary = path.join(directory, `.${file}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temporary, contents, { mode, flag: "wx" });
  await rename(temporary, target);
}

export function auditDatabaseUrl(runtimePassword) {
  const { host, port, name, runtimeRole } = AUDIT_DATABASE;
  return `postgresql://${runtimeRole}:${encodeURIComponent(runtimePassword)}@${host}:${port}/${name}`;
}

export async function prepareDevMaterial({ directory = DEFAULT_DIRECTORY, env = {}, now = new Date() } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const sources = {};

  let tokenKey = fromEnv(env, "SOLIDCHANGE_DEV_CUSTOMER_API_TOKEN_KEY", TOKEN_KEY);
  sources.customerApiTokenKey = tokenKey ? "env" : "generated";
  tokenKey ??= randomBytes(32).toString("hex");

  const passwords = {};
  for (const [key, variable, file] of [
    ["auditSuperuserPassword", "SOLIDCHANGE_DEV_AUDIT_DB_SUPERUSER_PASSWORD", FILES.auditSuperuserPassword],
    ["auditRuntimePassword", "SOLIDCHANGE_DEV_AUDIT_DB_RUNTIME_PASSWORD", FILES.auditRuntimePassword]
  ]) {
    const configured = fromEnv(env, variable, PASSWORD);
    const kept = configured ? undefined : await existing(directory, file, PASSWORD);
    sources[key] = configured ? "env" : kept ? "kept" : "generated";
    passwords[key] = configured ?? kept ?? randomBytes(32).toString("base64url");
  }

  const tls = createDevTlsMaterial({ now });
  sources.tls = "generated";

  await writeAtomically(directory, FILES.customerApiTokenKey, `${tokenKey}\n`, 0o444);
  await writeAtomically(directory, FILES.auditSuperuserPassword, `${passwords.auditSuperuserPassword}\n`, 0o400);
  await writeAtomically(directory, FILES.auditRuntimePassword, `${passwords.auditRuntimePassword}\n`, 0o444);
  await writeAtomically(directory, FILES.auditDatabaseUrl, `${auditDatabaseUrl(passwords.auditRuntimePassword)}\n`, 0o444);
  await writeAtomically(directory, FILES.caCertificate, tls.caCertificatePem, 0o444);
  await writeAtomically(directory, FILES.serverCertificate, tls.serverCertificatePem, 0o444);
  await writeAtomically(directory, FILES.serverPrivateKey, tls.serverPrivateKeyPem, 0o400);

  return Object.freeze({ directory, sources: Object.freeze(sources), tlsNotAfter: tls.notAfter });
}

async function main() {
  try {
    const result = await prepareDevMaterial({
      directory: process.env.SOLIDCHANGE_DEV_MATERIAL_DIR || DEFAULT_DIRECTORY,
      env: process.env
    });
    const summary = Object.entries(result.sources).map(([key, source]) => `${key}=${source}`).join(" ");
    console.log(`dev-only synthetic material ready in ${result.directory} (${summary}); TLS valid until ${result.tlsNotAfter.toISOString()}`);
  } catch (error) {
    console.error(`dev material generation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
