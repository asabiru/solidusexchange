import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateChart } from "../src/ledger.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tableBody(sql, name) {
  const match = sql.match(
    new RegExp(`CREATE TABLE financial_core\\.${name} \\(([\\s\\S]*?)\\n\\);`)
  );
  assert(match, `Missing table ${name}`);
  return match[1];
}

const packageJson = readJson("package.json");
assert(packageJson.private === true, "Financial core package must remain private");
assert(packageJson.dependencies === undefined, "Financial core must remain dependency-free");
assert(packageJson.devDependencies === undefined, "Financial core must remain dependency-free");

const chart = readJson("chart-of-accounts.json");
validateChart(chart);

const commandSchema = readJson("schemas/posting-command.schema.json");
assert(commandSchema.additionalProperties === false, "Posting command must reject unknown fields");
assert(commandSchema.properties?.entries?.minItems === 2, "Posting command requires two entries");
assert(
  commandSchema.properties?.entries?.maxItems === 1000,
  "Posting command must have a bounded entry count"
);
assert(
  commandSchema.properties?.entries?.items?.properties?.amount?.$ref ===
    "#/$defs/decimalAmount",
  "Posting amounts must use the decimal string schema"
);
assert(
  commandSchema.$defs?.decimalAmount?.type === "string",
  "Posting amounts cannot use JSON numbers"
);
assert(
  commandSchema.properties?.actor?.properties?.type?.enum?.includes("AI_AGENT") !== true,
  "AI agents must not have ledger posting authority"
);
assert(
  !commandSchema.required.includes("accepted_at") &&
    commandSchema.properties?.accepted_at === undefined,
  "The posting service, not the caller, must stamp accepted_at"
);

const migration = read("migrations/0001_ledger_foundation.sql");
for (const required of [
  "CREATE SCHEMA financial_core",
  "CREATE TABLE financial_core.ledger_assets",
  "CREATE TABLE financial_core.account_definitions",
  "CREATE TABLE financial_core.ledger_accounts",
  "CREATE TABLE financial_core.ledger_journals",
  "CREATE TABLE financial_core.ledger_entries",
  "CREATE TABLE financial_core.ledger_idempotency_registry",
  "CREATE TABLE financial_core.ledger_outbox_events",
  "CREATE TABLE financial_core.ledger_outbox_delivery_attempts",
  "CREATE FUNCTION financial_core.reject_mutation",
  "CREATE FUNCTION financial_core.assert_journal_complete",
  "DEFERRABLE INITIALLY DEFERRED",
  "REVOKE ALL ON SCHEMA financial_core FROM PUBLIC"
]) {
  assert(migration.includes(required), `Migration is missing ${required}`);
}

for (const table of [
  "account_definitions",
  "ledger_accounts",
  "ledger_assets",
  "ledger_entries",
  "ledger_idempotency_registry",
  "ledger_journals",
  "ledger_outbox_delivery_attempts",
  "ledger_outbox_events",
  "schema_migrations"
]) {
  assert(
    migration.includes(`BEFORE UPDATE OR DELETE ON financial_core.${table}`),
    `${table} is missing append-only protection`
  );
}

assert(
  !/\b(DOUBLE PRECISION|REAL|MONEY)\b/i.test(migration),
  "Unsafe monetary database type detected"
);
assert(
  !/\bINSERT INTO financial_core\.ledger_assets\b/i.test(migration),
  "Migration must not enable or seed production assets"
);
assert(
  !/\bbalance\b/i.test(tableBody(migration, "ledger_accounts")),
  "Ledger accounts cannot contain a mutable balance"
);
assert(
  !/\bbalance\b/i.test(tableBody(migration, "ledger_journals")),
  "Ledger journals cannot contain a mutable balance"
);
assert(
  !/\bbalance\b/i.test(tableBody(migration, "ledger_entries")),
  "Ledger entries cannot contain a mutable balance"
);
assert(
  migration.match(/DEFERRABLE INITIALLY DEFERRED/g)?.length === 4,
  "Every journal component must participate in deferred acceptance checks"
);
assert(
  migration.includes("entry_count > 1000"),
  "Database journal entry count must be bounded"
);
assert(
  migration.includes("internal.ledger.journal-accepted.v1"),
  "Immutable internal outbox event is missing"
);
assert(
  migration.includes("payload - ARRAY['journal_id', 'command_digest'] = '{}'::JSONB"),
  "Outbox payload must remain reference-only"
);

const readme = read("README.md");
for (const required of [
  "## Status and authority",
  "## Foundation invariants",
  "## PostgreSQL transaction contract",
  "## Explicit exclusions",
  "Runtime boundary: `dev-dry-run`",
  "PostgreSQL remains the proposed target under D-009",
  "Session D"
]) {
  assert(readme.includes(required), `README is missing ${required}`);
}

console.log(
  "Financial core ledger foundation is structurally consistent and remains dev-only."
);
