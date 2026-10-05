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
assert(
  packageJson.scripts?.["verify:migrations"] ===
    "node scripts/verify-postgres-migration-source-catalog.mjs && node scripts/verify-postgres-migration-source-policy.mjs",
  "Financial core must verify the exact migration source catalog and policy"
);
assert(
  packageJson.scripts?.verify?.includes("npm run verify:migrations"),
  "Financial core verification must include migration source hashes"
);

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
const truncationMigration = read("migrations/0004_ledger_truncate_guard.sql");
const replicationGuardMigration = read(
  "migrations/0005_ledger_trigger_replication_guard.sql"
);
const invariantReplicationGuardMigration = read(
  "migrations/0006_ledger_invariant_replication_guard.sql"
);
const replicaReferenceGuardMigration = read(
  "migrations/0007_ledger_replica_reference_guard.sql"
);
const acceptanceArtifactGuardMigration = read(
  "migrations/0008_ledger_acceptance_artifact_guard.sql"
);
const acceptanceTimelineGuardMigration = read(
  "migrations/0009_ledger_acceptance_timeline_guard.sql"
);
const finiteTimestampGuardMigration = read(
  "migrations/0010_ledger_finite_timestamp_guard.sql"
);
const migrationSequenceGuardMigration = read(
  "migrations/0011_ledger_migration_sequence_guard.sql"
);
const migrations = [
  migration,
  verificationMigration,
  acceptanceMigration,
  truncationMigration,
  replicationGuardMigration,
  invariantReplicationGuardMigration,
  replicaReferenceGuardMigration,
  acceptanceArtifactGuardMigration,
  acceptanceTimelineGuardMigration,
  finiteTimestampGuardMigration,
  migrationSequenceGuardMigration
].join("\n");
assert(
  !migrations.includes("ALTER DEFAULT PRIVILEGES"),
  "Financial core migrations must not modify role-level default privileges"
);
for (const required of [
  "CREATE FUNCTION financial_core.validate_migration_sequence",
  "CREATE TRIGGER schema_migrations_validate_sequence",
  "ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence",
  "migration version % must follow installed version % with version %",
  "migration name % must encode version %",
  "migration applied_at must be later than installed version %"
]) {
  assert(
    migrationSequenceGuardMigration.includes(required),
    `Migration sequence guard is missing ${required}`
  );
}
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
for (const trigger of [
  "account_definitions_append_only",
  "account_definitions_reject_truncate",
  "ledger_accounts_append_only",
  "ledger_accounts_reject_truncate",
  "ledger_assets_append_only",
  "ledger_assets_reject_truncate",
  "ledger_entries_append_only",
  "ledger_entries_reject_truncate",
  "ledger_idempotency_append_only",
  "ledger_idempotency_reject_truncate",
  "ledger_journal_seals_append_only",
  "ledger_journal_seals_reject_truncate",
  "ledger_journals_append_only",
  "ledger_journals_reject_truncate",
  "ledger_delivery_attempts_append_only",
  "ledger_delivery_attempts_reject_truncate",
  "ledger_outbox_append_only",
  "ledger_outbox_reject_truncate",
  "posting_rule_registry_append_only",
  "posting_rule_registry_reject_truncate",
  "schema_migrations_append_only",
  "schema_migrations_reject_truncate"
]) {
  assert(
    replicationGuardMigration.includes(`ENABLE ALWAYS TRIGGER ${trigger}`),
    `${trigger} is not enforced in every replication mode`
  );
}
for (const trigger of [
  "ledger_accounts_validate",
  "ledger_entries_validate_amount",
  "ledger_entries_reject_sealed_journal",
  "ledger_journals_complete",
  "ledger_entries_complete",
  "ledger_idempotency_complete",
  "ledger_outbox_complete",
  "ledger_journal_seals_complete"
]) {
  assert(
    invariantReplicationGuardMigration.includes(`ENABLE ALWAYS TRIGGER ${trigger}`),
    `${trigger} is not enforced in every replication mode`
  );
}
for (const required of [
  "account definition %/% does not exist",
  "asset % does not exist",
  "journal % does not exist",
  "references missing posting rule",
  "entries violate reference integrity",
  "CREATE FUNCTION financial_core.validate_delivery_attempt_reference",
  "outbox event % does not exist",
  "ENABLE ALWAYS TRIGGER ledger_delivery_attempts_validate_outbox",
  "REVOKE ALL ON FUNCTION financial_core.validate_delivery_attempt_reference() FROM PUBLIC"
]) {
  assert(
    replicaReferenceGuardMigration.includes(required),
    `Replica reference guard is missing ${required}`
  );
}
for (const table of [
  "account_definitions",
  "ledger_accounts",
  "ledger_assets",
  "ledger_entries",
  "ledger_idempotency_registry",
  "ledger_journal_seals",
  "ledger_journals",
  "ledger_outbox_delivery_attempts",
  "ledger_outbox_events",
  "posting_rule_registry",
  "schema_migrations"
]) {
  assert(
    truncationMigration.includes(`BEFORE TRUNCATE ON financial_core.${table}`),
    `${table} is missing owner-level truncation protection`
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
for (const required of [
  "CREATE FUNCTION financial_core.validate_acceptance_artifact_timestamp",
  "ledger_idempotency_validate_acceptance_timestamp",
  "ledger_outbox_validate_acceptance_timestamp",
  "ENABLE ALWAYS TRIGGER ledger_idempotency_validate_acceptance_timestamp",
  "ENABLE ALWAYS TRIGGER ledger_outbox_validate_acceptance_timestamp",
  "artifact_at IS DISTINCT FROM expected_accepted_at",
  "REVOKE ALL ON FUNCTION financial_core.validate_acceptance_artifact_timestamp()"
]) {
  assert(
    acceptanceArtifactGuardMigration.includes(required),
    `Acceptance artifact guard is missing ${required}`
  );
}
for (const required of [
  "CREATE OR REPLACE FUNCTION financial_core.assert_journal_complete",
  "target_journal.created_at IS DISTINCT FROM target_journal.accepted_at",
  "created_at IS DISTINCT FROM target_journal.accepted_at",
  "creation timestamp does not match acceptance timestamp",
  "entry timestamp does not match acceptance timestamp"
]) {
  assert(
    acceptanceTimelineGuardMigration.includes(required),
    `Acceptance timeline guard is missing ${required}`
  );
}
for (const required of [
  "schema_migrations_applied_at_finite",
  "ledger_assets_created_at_finite",
  "account_definitions_created_at_finite",
  "ledger_accounts_created_at_finite",
  "ledger_journals_effective_at_finite",
  "ledger_journals_accepted_at_finite",
  "ledger_journals_created_at_finite",
  "ledger_entries_created_at_finite",
  "ledger_idempotency_first_seen_at_finite",
  "ledger_outbox_created_at_finite",
  "ledger_delivery_attempts_attempted_at_finite",
  "posting_rule_registry_created_at_finite",
  "ledger_journal_seals_sealed_at_finite",
  "CHECK (pg_catalog.isfinite"
]) {
  assert(
    finiteTimestampGuardMigration.includes(required),
    `Finite timestamp guard is missing ${required}`
  );
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
  ["tests/runtime-writer-grants.sql", "rolcanlogin = FALSE"],
  ["tests/runtime-writer-grants.sql", "rolconfig IS NULL"],
  ["tests/runtime-writer-grants.sql", "REVOKE TEMPORARY ON DATABASE :\"DBNAME\" FROM PUBLIC"],
  ["tests/postgres-runtime-privileges.sh", "runtime-writer-privileges-ok"],
  ["tests/postgres-runtime-privileges.sh", "TRUNCATE financial_core.ledger_entries"],
  ["tests/postgres-runtime-privileges.sh", "DISABLE TRIGGER ALL"],
  ["tests/postgres-runtime-privileges.sh", "verify_runtime_catalog"],
  [
    "tests/postgres-runtime-privileges.sh",
    "GRANT INSERT ON TABLE financial_core.schema_migrations TO $runtime_role"
  ],
  [
    "tests/postgres-runtime-privileges.sh",
    "GRANT UPDATE (actor_id) ON TABLE financial_core.ledger_journals TO $runtime_role"
  ],
  [
    "tests/postgres-runtime-privileges.sh",
    "GRANT financial_core_runtime_parent_test TO $runtime_role"
  ],
  ["tests/postgres-runtime-privileges.sh", "ALTER ROLE $runtime_role LOGIN"],
  [
    "tests/postgres-runtime-privileges.sh",
    "ALTER ROLE $runtime_role SET search_path = public"
  ],
  [
    "tests/postgres-runtime-privileges.sh",
    "ALTER SCHEMA financial_core OWNER TO $runtime_role"
  ],
  ["tests/postgres-runtime-privileges.sh", "WITH GRANT OPTION"],
  [
    "tests/postgres-runtime-privileges.sh",
    "GRANT TEMPORARY ON DATABASE \\\"$PGDATABASE\\\" TO PUBLIC"
  ],
  [
    "tests/postgres-runtime-privileges.sh",
    "CREATE DOMAIN pg_temp.timestamptz AS pg_catalog.date"
  ],
  [
    "tests/postgres-runtime-privileges.sh",
    "permission denied for table schema_migrations"
  ],
  [
    "tests/postgres-runtime-privileges.sh",
    "postgres-runtime-privilege-catalog-negative-ok"
  ],
  ["tests/postgres-runtime-privilege-catalog.sql", "pg_catalog.aclexplode(attribute.attacl)"],
  ["tests/postgres-runtime-privilege-catalog.sql", "pg_catalog.pg_auth_members"],
  ["tests/postgres-runtime-privilege-catalog.sql", "pg_catalog.pg_default_acl"],
  ["tests/postgres-runtime-privilege-catalog.sql", "pg_catalog.acldefault('d', database.datdba)"],
  ["tests/postgres-runtime-privilege-catalog.sql", "role.rolcanlogin"],
  ["tests/postgres-runtime-privilege-catalog.sql", "'owns_financial_objects'"],
  [
    "scripts/verify-postgres-runtime-privilege-catalog.mjs",
    "can_login: false"
  ],
  [
    "scripts/verify-postgres-runtime-privilege-catalog.mjs",
    "configuration: []"
  ],
  [
    "scripts/verify-postgres-runtime-privilege-catalog.mjs",
    'grant("database", "current_database", "CONNECT", "public")'
  ],
  [
    "scripts/verify-postgres-runtime-privilege-catalog.mjs",
    "owns_financial_objects: false"
  ],
  [
    "scripts/verify-postgres-runtime-privilege-catalog.mjs",
    "PostgreSQL runtime role or privileges differ from the reviewed least-privilege profile"
  ],
  ["tests/postgres-owner-truncate-guard.sh", "TRUNCATE TABLE"],
  ["tests/postgres-owner-truncate-guard.sh", "postgres-owner-truncate-guard-ok"],
  ["tests/postgres-immutability-catalog.sql", "pg_catalog.pg_trigger"],
  ["tests/postgres-immutability-catalog.sql", "pg_catalog.pg_get_triggerdef"],
  [
    "tests/postgres-immutability-catalog.sql",
    "trigger_function.proname = 'reject_mutation'"
  ],
  ["scripts/verify-postgres-immutability-catalog.mjs", "assert.deepStrictEqual"],
  [
    "scripts/verify-postgres-immutability-catalog.mjs",
    "postgres-immutability-catalog-ok"
  ],
  [
    "scripts/verify-postgres-immutability-catalog.mjs",
    "PostgreSQL immutability trigger definitions differ from the expected policy"
  ],
  ["tests/postgres-immutability-catalog.sh", "WHEN (false)"],
  [
    "tests/postgres-immutability-catalog.sh",
    "postgres-immutability-catalog-negative-ok"
  ],
  [
    "tests/postgres-immutability-catalog.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-immutability-catalog.sh",
    "postgres-replication-mode-immutability-ok"
  ],
  ["tests/postgres-trigger-function-catalog.sql", "procedure.prosrc"],
  [
    "tests/postgres-trigger-function-catalog.sql",
    "pg_catalog.has_function_privilege"
  ],
  ["tests/postgres-trigger-function-catalog.sql", "pg_catalog.aclexplode"],
  [
    "scripts/verify-postgres-trigger-function-catalog.mjs",
    "assert.deepStrictEqual"
  ],
  [
    "scripts/verify-postgres-trigger-function-catalog.mjs",
    "postgres-trigger-function-catalog-ok"
  ],
  ["tests/postgres-invariant-trigger-catalog.sql", "pg_catalog.pg_trigger"],
  [
    "scripts/verify-postgres-invariant-trigger-catalog.mjs",
    "assert.deepStrictEqual"
  ],
  [
    "scripts/verify-postgres-invariant-trigger-catalog.mjs",
    "postgres-invariant-trigger-catalog-ok"
  ],
  [
    "tests/postgres-invariant-trigger-catalog.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-invariant-trigger-catalog.sh",
    "postgres-replica-mode-invariants-ok"
  ],
  [
    "tests/postgres-replica-reference-integrity.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-replica-reference-integrity.sh",
    "account definition 1/MISSING_DEFINITION does not exist"
  ],
  [
    "tests/postgres-replica-reference-integrity.sh",
    "entries violate reference integrity"
  ],
  [
    "tests/postgres-replica-reference-integrity.sh",
    "postgres-replica-mode-reference-integrity-ok"
  ],
  [
    "tests/postgres-acceptance-artifact-integrity.sh",
    "SET session_replication_role = ${replication_mode}"
  ],
  [
    "tests/postgres-acceptance-artifact-integrity.sh",
    "ledger_idempotency_registry acceptance timestamp does not match journal"
  ],
  [
    "tests/postgres-acceptance-artifact-integrity.sh",
    "ledger_outbox_events acceptance timestamp does not match journal"
  ],
  [
    "tests/postgres-acceptance-artifact-integrity.sh",
    "creation timestamp does not match acceptance timestamp"
  ],
  [
    "tests/postgres-acceptance-artifact-integrity.sh",
    "entry timestamp does not match acceptance timestamp"
  ],
  [
    "tests/postgres-acceptance-artifact-integrity.sh",
    "postgres-acceptance-artifact-integrity-ok"
  ],
  [
    "tests/postgres-finite-timestamps.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-finite-timestamps.sh",
    "ledger_journals_accepted_at_finite"
  ],
  [
    "tests/postgres-finite-timestamps.sh",
    "ledger_journal_seals_sealed_at_finite"
  ],
  ["tests/postgres-finite-timestamps.sh", "postgres-finite-timestamps-ok"],
  ["tests/postgres-migration-history.sql", "financial_core.schema_migrations"],
  ["tests/postgres-migration-history.sql", "applied_in_version_order"],
  [
    "scripts/verify-postgres-migration-history.mjs",
    "PostgreSQL migration history differs from canonical manifest"
  ],
  [
    "scripts/verify-postgres-migration-history.mjs",
    "PostgreSQL migrations were not applied in canonical version order"
  ],
  [
    "scripts/verify-postgres-migration-history.mjs",
    "0011_ledger_migration_sequence_guard"
  ],
  [
    "tests/postgres-migration-history.sh",
    "9999_unreviewed_migration"
  ],
  [
    "tests/postgres-migration-history.sh",
    "OUT_OF_ORDER_DATABASE"
  ],
  [
    "tests/postgres-migration-history.sh",
    "Out-of-order PostgreSQL migration history unexpectedly passed."
  ],
  [
    "tests/postgres-migration-history.sh",
    "postgres-migration-order-negative-ok"
  ],
  [
    "tests/postgres-migration-history.sh",
    "migration version 13 must follow installed version 11 with version 12"
  ],
  [
    "tests/postgres-migration-history.sh",
    "migration name 0013_wrong_version must encode version 12"
  ],
  [
    "tests/postgres-migration-history.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-migration-history.sh",
    "postgres-migration-sequence-guard-ok"
  ],
  [
    "tests/postgres-migration-history.sh",
    "postgres-migration-history-negative-ok"
  ],
  ["tests/postgres-migration-history.sh", "ROLLBACK_DATABASE"],
  ["tests/postgres-migration-history.sh", "SELECT 1 / 0;"],
  [
    "tests/postgres-migration-history.sh",
    "to_regclass('financial_core.ledger_account_projections') IS NULL"
  ],
  ["tests/postgres-migration-history.sh", "postgres-migration-rollback-ok"],
  [
    "scripts/verify-postgres-migration-source-catalog.mjs",
    "PostgreSQL migration source files differ from canonical manifest"
  ],
  [
    "scripts/verify-postgres-migration-source-catalog.mjs",
    "PostgreSQL migration source digest differs for"
  ],
  [
    "scripts/verify-postgres-migration-source-catalog.mjs",
    "0011_ledger_migration_sequence_guard.sql"
  ],
  [
    "tests/postgres-migration-source-catalog.sh",
    "unreviewed source drift"
  ],
  [
    "tests/postgres-migration-source-catalog.sh",
    "9999_unreviewed_migration.sql"
  ],
  [
    "tests/postgres-migration-source-catalog.sh",
    "postgres-migration-source-catalog-negative-ok"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration source versions must form a contiguous sequence starting at 0001"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration must contain exactly one top-level BEGIN and COMMIT transaction boundary"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration history row must match its filename"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration must change history only through canonical history rows"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration must not use unreviewable procedural SQL"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration must not use Unicode-escaped identifiers"
  ],
  [
    "scripts/verify-postgres-migration-source-policy.mjs",
    "PostgreSQL migration must not execute psql meta-commands"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "0012_ledger_acceptance_seal.sql"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "ROLLBACK;"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "\\\\ir unreviewed.sql"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "PostgreSQL migration must record exactly one canonical history row"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "migration_policy_bypass"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "concatenated-dynamic-history-rewrite"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "single-quoted-dynamic-history-rewrite"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "unicode-escaped-history-write"
  ],
  [
    "tests/postgres-migration-source-policy.sh",
    "postgres-migration-source-policy-negative-ok"
  ],
  ["tests/postgres-state-snapshot.sql", "financial-core-state-v2"],
  ["tests/postgres-state-snapshot.sql", "jsonb_agg(row_data ORDER BY sort_key COLLATE \"C\")"],
  ["tests/postgres-state-snapshot.sql", "ledger_account_projections"],
  ["tests/postgres-state-snapshot.sql", "ledger_trial_balance"],
  ["tests/postgres-state-snapshot.sql", "pg_catalog.pg_sequences"],
  ["tests/postgres-state-snapshot.sql", "pg_catalog.query_to_xml"],
  ["tests/postgres-state-snapshot.sql", "'SELECT last_value, is_called FROM %I.%I'"],
  ["tests/postgres-backup-consistency.sql", "pg_advisory_lock(390039)"],
  ["tests/postgres-backup-consistency.sql", "backup-consistency-demo-001"],
  ["tests/postgres-backup-consistency.sql", "pg_sleep(10)"],
  ["tests/postgres-backup-continuity.sql", "restore_projection_baseline"],
  ["tests/postgres-backup-continuity.sql", "restore_trial_balance_baseline"],
  ["tests/postgres-backup-continuity.sql", "restore-continuity-demo-001"],
  ["tests/postgres-backup-continuity.sql", "restored trial balance did not remain balanced"],
  ["tests/postgres-backup-restore.sh", "pg_dump"],
  ["tests/postgres-backup-restore.sh", "pg_restore"],
  ["tests/postgres-backup-restore.sh", "*_restore_test"],
  ["tests/postgres-backup-restore.sh", "CONSISTENCY_RESTORE_DATABASE"],
  ["tests/postgres-backup-restore.sh", "CHAIN_RESTORE_DATABASE"],
  ["tests/postgres-backup-restore.sh", "tests/postgres-backup-consistency.sql"],
  ["tests/postgres-backup-restore.sh", "pre_transaction_snapshot"],
  ["tests/postgres-backup-restore.sh", "postgres-backup-consistency-ok"],
  ["tests/postgres-backup-restore.sh", "CORRUPT_RESTORE_DATABASE"],
  ["tests/postgres-backup-restore.sh", "truncate -s"],
  ["tests/postgres-backup-restore.sh", "--single-transaction"],
  ["tests/postgres-backup-restore.sh", "to_regnamespace('financial_core') IS NULL"],
  ["tests/postgres-backup-restore.sh", "postgres-backup-corruption-ok"],
  [
    "tests/postgres-backup-restore.sh",
    "--exclude-table-data=financial_core.ledger_outbox_events"
  ],
  [
    "tests/postgres-backup-restore.sh",
    "Incomplete financial-core restore unexpectedly matched the source recovery state."
  ],
  [
    "tests/postgres-backup-restore.sh",
    "postgres-backup-partial-restore-negative-ok"
  ],
  ["tests/postgres-backup-restore.sh", "SEQUENCE_STATE_RESTORE_DATABASE"],
  [
    "tests/postgres-backup-restore.sh",
    "SEQUENCE SET financial_core backup_sequence_state_probe"
  ],
  [
    "tests/postgres-backup-restore.sh",
    "Restore without sequence state unexpectedly matched the source recovery state."
  ],
  [
    "tests/postgres-backup-restore.sh",
    "postgres-backup-sequence-state-negative-ok"
  ],
  ["tests/postgres-backup-restore.sh", "postgres-backup-sequence-continuity-ok"],
  ["tests/postgres-backup-restore.sh", "verify_migration_history"],
  ["tests/postgres-backup-restore.sh", "0012_unreviewed_restore_drift"],
  [
    "tests/postgres-backup-restore.sh",
    "postgres-backup-migration-history-negative-ok"
  ],
  ["tests/postgres-backup-restore.sh", "tests/postgres-state-snapshot.sql"],
  ["tests/postgres-backup-restore.sh", "tests/postgres-backup-continuity.sql"],
  ["tests/postgres-backup-restore.sh", "tests/postgres-access-control-catalog.sh"],
  ["tests/postgres-backup-restore.sh", "financial_core_backup_scope_test"],
  ["tests/postgres-backup-restore.sh", "postgres-backup-restore-ok"],
  ["tests/postgres-backup-restore.sh", "Restore changed unrelated target state."],
  ["tests/postgres-backup-restore.sh", "Backup unexpectedly restored into an occupied financial-core target."],
  ["tests/postgres-backup-restore.sh", "Rejected restore changed the occupied financial-core target."],
  ["tests/postgres-backup-restore.sh", "Rejected restore changed unrelated target state."],
  ["tests/postgres-backup-restore.sh", "postgres-backup-collision-ok"],
  ["tests/postgres-backup-restore.sh", "postgres-backup-scope-isolation-ok"],
  ["tests/postgres-backup-restore.sh", "postgres-backup-continuity-ok"],
  ["tests/postgres-backup-restore.sh", "STALE_CHAIN_RESTORE_DATABASE"],
  [
    "tests/postgres-backup-restore.sh",
    "Stale first-generation financial-core restore unexpectedly matched the active recovery state."
  ],
  [
    "tests/postgres-backup-restore.sh",
    "Stale first-generation financial-core restore differs from its canonical recovery point."
  ],
  [
    "tests/postgres-backup-restore.sh",
    "Stale financial-core restore regression changed the source state."
  ],
  ["tests/postgres-backup-restore.sh", "postgres-backup-stale-chain-negative-ok"],
  ["tests/postgres-backup-restore.sh", "Second-generation restore differs from the active restored state."],
  ["tests/postgres-backup-restore.sh", "postgres-backup-chain-ok"],
  ["tests/postgres-constraint-catalog.sql", "pg_catalog.pg_constraint"],
  ["tests/postgres-constraint-catalog.sql", "pg_catalog.pg_index"],
  ["tests/postgres-constraint-catalog.sql", "pg_catalog.pg_get_constraintdef"],
  [
    "scripts/verify-postgres-constraint-catalog.mjs",
    "expectedCatalogSha256"
  ],
  [
    "scripts/verify-postgres-constraint-catalog.mjs",
    "postgres-constraint-catalog-ok"
  ],
  [
    "tests/postgres-constraint-catalog.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-constraint-catalog.sh",
    "ledger_entries_amount_check"
  ],
  [
    "tests/postgres-constraint-catalog.sh",
    "ledger_accounts_identity"
  ],
  [
    "tests/postgres-constraint-catalog.sh",
    "postgres-replica-mode-constraint-integrity-ok"
  ],
  ["tests/postgres-relation-catalog.sql", "pg_catalog.pg_attribute"],
  ["tests/postgres-relation-catalog.sql", "attribute.attnotnull"],
  ["tests/postgres-relation-catalog.sql", "relation.relkind"],
  ["tests/postgres-relation-catalog.sql", "relation.relpersistence"],
  ["tests/postgres-relation-catalog.sql", "pg_catalog.pg_get_viewdef"],
  [
    "scripts/verify-postgres-relation-catalog.mjs",
    "expectedCatalogSha256"
  ],
  [
    "scripts/verify-postgres-relation-catalog.mjs",
    "postgres-relation-catalog-ok"
  ],
  [
    "tests/postgres-relation-catalog.sh",
    "SET session_replication_role = replica"
  ],
  [
    "tests/postgres-relation-catalog.sh",
    'null value in column "command_digest"'
  ],
  [
    "tests/postgres-relation-catalog.sh",
    'null value in column "amount"'
  ],
  [
    "tests/postgres-relation-catalog.sh",
    'null value in column "payload"'
  ],
  [
    "tests/postgres-relation-catalog.sh",
    "postgres-replica-mode-not-null-integrity-ok"
  ],
  ["tests/postgres-access-control-catalog.sql", "pg_catalog.aclexplode"],
  ["tests/postgres-access-control-catalog.sql", "pg_catalog.pg_default_acl"],
  [
    "scripts/verify-postgres-access-control-catalog.mjs",
    "expectedCatalogSha256"
  ],
  [
    "scripts/verify-postgres-access-control-catalog.mjs",
    "PostgreSQL ownership or access-control catalog differs"
  ],
  [
    "tests/postgres-access-control-catalog.sh",
    "GRANT USAGE ON SCHEMA financial_core TO PUBLIC"
  ],
  [
    "tests/postgres-access-control-catalog.sh",
    "GRANT SELECT (amount) ON TABLE financial_core.ledger_entries TO PUBLIC"
  ],
  [
    "tests/postgres-access-control-catalog.sh",
    "GRANT EXECUTE ON FUNCTION financial_core.reject_mutation() TO PUBLIC"
  ],
  [
    "tests/postgres-access-control-catalog.sh",
    "postgres-access-control-catalog-negative-ok"
  ]
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
  "logical backup/restore regression",
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
  "synthetic logical backup/restore",
  "migration history точно соответствует migrations `0001`–`0011` и порядку их применения",
  "failed migration полностью откатывает schema objects и history row",
  "restored и second-generation databases обязаны пройти exact migration-history verifier",
  "structurally valid backup без committed outbox data проходит catalog и migration-history проверки, но отклоняется canonical state snapshot",
  "SHA-256 migration source catalog",
  "каждый migration source использует один atomic `BEGIN`/`COMMIT` boundary",
  "psql meta-commands и дополнительные transaction-control statements запрещены",
  "runtime writer test profile точно совпадает с reviewed least-privilege catalog",
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
  "tests/postgres-owner-truncate-guard.sh",
  "tests/postgres-immutability-catalog.sh",
  "tests/postgres-trigger-function-catalog.sh",
  "tests/postgres-migration-source-catalog.sh",
  "tests/postgres-migration-source-policy.sh",
  "tests/postgres-migration-history.sh",
  "tests/postgres-constraint-catalog.sh",
  "tests/postgres-relation-catalog.sh",
  "tests/postgres-access-control-catalog.sh",
  "tests/postgres-invariant-trigger-catalog.sh",
  "tests/postgres-replica-reference-integrity.sh",
  "tests/postgres-acceptance-artifact-integrity.sh",
  "tests/postgres-finite-timestamps.sh",
  "tests/postgres-backup-restore.sh",
  "tests/command-digest-vector.json"
]) {
  assert(workflow.includes(required), `Financial core CI is missing ${required}`);
}

console.log(
  "Financial core ledger evidence is structurally consistent and remains dev-only."
);
