import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateChart, validatePostingRules } from "../src/ledger.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function readRepositoryFile(path) {
  return readFileSync(join(root, "..", "..", path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
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
const postingRules = readJson("posting-rules.json");
validatePostingRules(postingRules, chart);

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
const verificationMigration = read("migrations/0002_ledger_verification_views.sql");
const acceptanceMigration = read("migrations/0003_ledger_acceptance_seal.sql");
const migrations = `${migration}\n${verificationMigration}\n${acceptanceMigration}`;
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
  !migrations.includes("GRANT INSERT ON TABLE"),
  "Migrations must not provision a runtime writer"
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
for (const required of [
  "CREATE VIEW financial_core.ledger_account_projections",
  "CREATE VIEW financial_core.ledger_trial_balance",
  "WITH (security_invoker = TRUE)",
  "REVOKE ALL ON financial_core.ledger_account_projections FROM PUBLIC",
  "REVOKE ALL ON financial_core.ledger_trial_balance FROM PUBLIC"
]) {
  assert(verificationMigration.includes(required), `Verification migration is missing ${required}`);
}
assert(
  !/CREATE MATERIALIZED VIEW/i.test(verificationMigration),
  "Ledger verification must remain a rebuildable read-only projection"
);
for (const required of [
  "CREATE TABLE financial_core.posting_rule_registry",
  "CREATE TABLE financial_core.ledger_journal_seals",
  "ledger_journals_posting_rule_fk",
  "CREATE FUNCTION financial_core.reject_sealed_journal_entry",
  "CREATE OR REPLACE FUNCTION financial_core.validate_entry_amount",
  "CREATE OR REPLACE FUNCTION financial_core.assert_journal_complete",
  "CREATE CONSTRAINT TRIGGER ledger_journal_seals_complete",
  "pre-seal journals require independent revalidation",
  "journal % is sealed",
  "actor is not permitted by its posting rule",
  "entries violate its posting rule",
  "missing its immutable acceptance seal",
  "amount must be finite",
  "COLLATE \"C\"",
  "jsonb_array_elements(expected_entry_pattern)",
  "NEW.amount::TEXT"
]) {
  assert(
    acceptanceMigration.includes(required),
    `Acceptance migration is missing ${required}`
  );
}
assert(
  !acceptanceMigration.includes("trim_scale(NEW.amount)"),
  "PostgreSQL precision must count the same lexical digits as JavaScript"
);
for (const rule of postingRules.rules) {
  assert(
    acceptanceMigration.includes(`'${rule.journal_type}'`) &&
      acceptanceMigration.includes(`'${rule.posting_rule_version}'`),
    `Database registry is missing ${rule.journal_type}`
  );
  for (const actorType of rule.allowed_actor_types) {
    assert(
      acceptanceMigration.includes(`ARRAY['${actorType}']`),
      `Database registry is missing actor ${actorType}`
    );
  }
  for (const leg of rule.entry_pattern) {
    assert(
      acceptanceMigration.includes(
        `"definition_code": "${leg.definition_code}", "side": "${leg.side}"`
      ),
      `Database registry is missing ${leg.definition_code}|${leg.side}`
    );
  }
}

for (const [fixture, evidence] of [
  ["tests/postgres-reject-late-entry.sql", "sequence_number"],
  ["tests/postgres-reject-unregistered-rule.sql", "UNREGISTERED_BALANCED_RULE"],
  ["tests/postgres-reject-rule-actor.sql", "'OPERATOR'"],
  ["tests/postgres-reject-rule-pattern.sql", "'CREDIT'"],
  ["tests/postgres-precision-boundary.sql", "repeat('9', 76)"],
  ["tests/postgres-reject-precision.sql", "repeat('9', 77)"],
  ["tests/postgres-reject-nonfinite.sql", "'NaN'::NUMERIC"],
  ["tests/postgres-reject-nonfinite.sql", "ARRAY['Infinity', '-Infinity']"],
  ["tests/postgres-chart-of-accounts.sql", "jsonb_to_recordset"],
  ["tests/postgres-chart-of-accounts.sql", "definition_code COLLATE \"C\""],
  ["scripts/verify-postgres-chart-of-accounts.mjs", "assert.deepStrictEqual"],
  ["scripts/verify-postgres-chart-of-accounts.mjs", "postgres-chart-of-accounts-ok"],
  ["tests/postgres-posting-rule-registry.sql", "jsonb_build_object"],
  ["tests/postgres-posting-rule-registry.sql", "journal_type COLLATE \"C\""],
  ["scripts/verify-postgres-rule-registry.mjs", "assert.deepStrictEqual"],
  ["scripts/verify-postgres-rule-registry.mjs", "postgres-posting-rule-registry-ok"],
  ["tests/postgres-concurrency.sh", "concurrent-late-entry-ok"],
  ["tests/postgres-concurrency.sh", "pg_try_advisory_lock"],
  ["tests/runtime-writer-grants.sql", "REVOKE ALL PRIVILEGES ON ALL TABLES"],
  ["tests/runtime-writer-grants.sql", "GRANT INSERT ON TABLE"],
  ["tests/postgres-runtime-privileges.sh", "runtime-writer-privileges-ok"],
  ["tests/postgres-runtime-privileges.sh", "TRUNCATE financial_core.ledger_entries"],
  ["tests/postgres-runtime-privileges.sh", "DISABLE TRIGGER ALL"]
]) {
  assert(read(fixture).includes(evidence), `${fixture} is missing ${evidence}`);
}
assert(
  ![
    "GRANT ALL",
    "GRANT UPDATE",
    "GRANT DELETE",
    "GRANT TRUNCATE",
    "GRANT REFERENCES",
    "GRANT TRIGGER",
    "GRANT CREATE",
    "GRANT EXECUTE"
  ].some((grant) => read("tests/runtime-writer-grants.sql").includes(grant)),
  "Runtime writer profile contains a forbidden grant"
);
const commandDigestVector = readJson("tests/command-digest-vector.json");
const computedCommandDigest = createHash("sha256")
  .update(JSON.stringify(canonicalize(commandDigestVector.command)))
  .digest("hex");
assert(
  computedCommandDigest === commandDigestVector.expected_digest,
  "Canonical command digest vector does not match its command"
);
assert(
  commandDigestVector.command.entries.every(
    (entry) => entry.asset_code === commandDigestVector.asset.code
  ),
  "Canonical command digest entries must use the configured vector asset"
);
assert(
  read("tests/ledger.test.mjs").includes("tests\", \"command-digest-vector.json") &&
    read("tests/postgres-smoke.sql").includes(":'command_vector_json'::JSONB"),
  "JavaScript and PostgreSQL evidence must consume the canonical command digest vector"
);
assert(
  read("tests/postgres-smoke.sql").includes("SELECT 1 / 0"),
  "PostgreSQL smoke must fail when the canonical command vector is missing"
);

const readme = read("README.md");
for (const required of [
  "## Status and authority",
  "## Foundation invariants",
  "## PostgreSQL transaction contract",
  "## Explicit exclusions",
  "Runtime boundary: `dev-dry-run`",
  "PostgreSQL remains the proposed target under D-009",
  "Finance approval gate",
  "Session D"
]) {
  assert(readme.includes(required), `README is missing ${required}`);
}

const approvalPack = readRepositoryFile(
  "Documentation/regulated-core/finance-ledger-approval-pack.md"
);
for (const required of [
  "Review state: `PENDING`",
  "Finance approver:",
  "CTO approver:",
  "Security approver:",
  "Chat approval без commit SHA и evidence link не меняет `PENDING` на `APPROVED`",
  "## NO-GO"
]) {
  assert(approvalPack.includes(required), `Finance approval pack is missing ${required}`);
}

const workflow = readRepositoryFile(".github/workflows/financial-core-ci.yml");
for (const required of [
  "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
  "persist-credentials: false",
  "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
  "tests/postgres-reject-late-entry.sql",
  "tests/postgres-reject-unregistered-rule.sql",
  "tests/postgres-reject-rule-actor.sql",
  "tests/postgres-reject-rule-pattern.sql",
  "tests/postgres-reject-precision.sql",
  "tests/postgres-reject-nonfinite.sql",
  "tests/postgres-chart-of-accounts.sh",
  "tests/postgres-posting-rule-registry.sh",
  "tests/postgres-concurrency.sh",
  "tests/postgres-runtime-privileges.sh",
  "tests/command-digest-vector.json"
]) {
  assert(workflow.includes(required), `Financial core CI is missing ${required}`);
}

console.log(
  "Financial core ledger evidence is structurally consistent and remains dev-only."
);
