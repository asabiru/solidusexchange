import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "..", "..");
const policy = JSON.parse(readFileSync(join(root, "custody-policy.json"), "utf8"));
const read = (path) => readFileSync(join(repositoryRoot, path), "utf8");

assert.equal(policy.runtime_boundary, "dev-dry-run");
assert.equal(policy.execution_authority, false);
assert.equal(policy.production_signing_enabled, false);
assert.equal(policy.key_material_allowed, false);
assert(policy.minimum_approvals >= 2);
assert(policy.required_approval_roles.includes("custody_maker"));
assert(policy.required_approval_roles.includes("custody_checker"));
assert(policy.allowed_assets.every(({ network }) =>
  network.endsWith("_TESTNET")
));

const source = read("packages/custody-core/src/unsigned-intent.mjs");
for (const required of [
  "maker and checker must be different humans",
  "intent_digest does not match command and policy",
  "production signing must remain disabled",
  "contains restricted custody material",
  'status: "unsigned_intent_ready"',
  "execution_authority: false"
]) {
  assert(source.includes(required), `Custody source is missing evidence: ${required}`);
}

const eventSource = read("packages/custody-core/src/custody-event.mjs");
for (const required of [
  "verifyUnsignedTransactionIntent",
  "createCustodyProjectionRegistry",
  'event_type: "CustodyIntentPrepared"',
  'status: "unsigned_intent_ready"',
  "execution_authority: false",
  "production_signing_enabled: false"
]) {
  assert(eventSource.includes(required), `Custody event source is missing evidence: ${required}`);
}
for (const prohibited of [
  "destination_reference:",
  "private_key",
  "raw_transaction",
  "signature",
  "signed_transaction"
]) {
  assert(!eventSource.includes(prohibited), `Custody event source contains prohibited material: ${prohibited}`);
}

const tests = read("packages/custody-core/tests/unsigned-intent.test.mjs");
for (const required of [
  "rejects missing maker-checker quorum",
  "rejects the same human as maker and checker",
  "rejects approval evidence bound to another intent",
  "rejects approval evidence after custody policy drift",
  "rejects raw addresses and key material",
  "rejects production execution or signing policy",
  "rejects custody policy containing key material"
]) {
  assert(tests.includes(required), `Custody tests are missing evidence: ${required}`);
}

const eventTests = read("packages/custody-core/tests/custody-event.test.mjs");
for (const required of [
  "projects an immutable reference-only CustodyIntentPrepared event",
  "returns the original event for an exact custody projection replay",
  "rejects conflicting custody projection replays",
  "rejects duplicate custody projection identities",
  "matches the canonical API domain event contract",
  "rejects tampered intent evidence",
  "rejects invalid or reused event identity",
  "rejects withdrawal approval continuity drift",
  "rejects events before approvals or after intent expiry",
  "rejects policy drift and signing-enabled policy"
]) {
  assert(eventTests.includes(required), `Custody event tests are missing evidence: ${required}`);
}

const readme = read("packages/custody-core/README.md");
for (const required of [
  "No private keys, mnemonic, seed, signature or raw transaction",
  "This package cannot sign or broadcast transactions",
  "D-002 and D-003 remain `Open`"
]) {
  assert(readme.includes(required), `Custody README is missing boundary: ${required}`);
}

const migration = read(
  "packages/custody-core/migrations/0001_custody_projection_outbox.sql"
);
for (const required of [
  "CREATE TABLE custody_core.custody_projection_outbox",
  "custody projection idempotency conflict",
  "custody projection identity conflict",
  "custody projection outbox is append-only",
  "ENABLE ALWAYS TRIGGER",
  "SECURITY DEFINER",
  "production_signing_enabled"
]) {
  assert(migration.includes(required), `Custody migration is missing evidence: ${required}`);
}

const postgresTests = read("packages/custody-core/tests/postgres-outbox.sql");
for (const required of [
  "exact custody projection replay was not recognized",
  "null request digest replay was accepted",
  "changed idempotent replay was accepted",
  "duplicate approval source identity was accepted",
  "mainnet custody projection was accepted",
  "signing-enabled custody projection was accepted",
  "custody outbox truncate was accepted",
  "replica-mode custody outbox update was accepted"
]) {
  assert(postgresTests.includes(required), `Custody PostgreSQL tests are missing evidence: ${required}`);
}

const runtimeGrants = read("packages/custody-core/tests/runtime-writer-grants.sql");
for (const required of [
  "custody runtime writer must not be the migration owner",
  "custody runtime writer must be an existing unprivileged role",
  "rolcanlogin = false",
  "custody runtime writer must not inherit or assume another role",
  "custody runtime writer must not own custody_core objects",
  "GRANT EXECUTE ON FUNCTION custody_core.record_custody_projection(jsonb, text)",
  "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA custody_core"
]) {
  assert(runtimeGrants.includes(required), `Custody runtime grants are missing evidence: ${required}`);
}

const runtimeTests = read("packages/custody-core/tests/postgres-runtime-privileges.sh");
for (const required of [
  "verify_runtime_catalog",
  "GRANT SELECT ON TABLE custody_core.custody_projection_outbox TO $runtime_role",
  "GRANT UPDATE (request_digest) ON TABLE custody_core.custody_projection_outbox TO $runtime_role",
  "WITH GRANT OPTION",
  "GRANT USAGE ON TYPE custody_core.custody_projection_outbox TO $runtime_role",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA custody_core",
  "GRANT SELECT ON TABLE custody_core.schema_migrations TO PUBLIC",
  "ALTER ROLE $runtime_role LOGIN",
  "ALTER ROLE $runtime_role SUPERUSER",
  "GRANT $PGUSER TO $runtime_role",
  "custody-postgres-runtime-privilege-catalog-negative-ok",
  "custody-runtime-privilege-shape-ok",
  "direct custody outbox select",
  "direct custody outbox insert",
  "custody schema object creation",
  "custody trigger disable",
  "direct custody migration history select",
  "direct custody migration history insert",
  "custody-postgres-runtime-privileges-ok"
]) {
  assert(runtimeTests.includes(required), `Custody runtime tests are missing evidence: ${required}`);
}

const runtimePrivilegeCatalog = read(
  "packages/custody-core/tests/postgres-runtime-privilege-catalog.sql"
);
for (const required of [
  "pg_catalog.aclexplode(attribute.attacl)",
  "pg_catalog.pg_default_acl",
  "pg_catalog.pg_auth_members",
  "role.rolcanlogin",
  "'owns_custody_objects'",
  "namespace.nspname = 'custody_core'",
  "grantees.label AS grantee"
]) {
  assert(
    runtimePrivilegeCatalog.includes(required),
    `Custody runtime privilege catalog is missing evidence: ${required}`
  );
}

const runtimePrivilegeVerifier = read(
  "packages/custody-core/scripts/verify-postgres-runtime-privilege-catalog.mjs"
);
for (const required of [
  "record_custody_projection(p_event_document jsonb, p_request_digest text)",
  "can_login: false",
  "memberships: []",
  "owns_custody_objects: false",
  "PostgreSQL custody runtime role or privileges differ from the reviewed least-privilege profile",
  "custody-postgres-runtime-privilege-catalog-ok"
]) {
  assert(
    runtimePrivilegeVerifier.includes(required),
    `Custody runtime privilege verifier is missing evidence: ${required}`
  );
}

const catalogQuery = read("packages/custody-core/tests/postgres-catalog.sql");
for (const required of [
  "definition_sha256",
  "source_sha256",
  "security_definer",
  "default_privileges",
  "trigger_record.tgenabled"
]) {
  assert(catalogQuery.includes(required), `Custody catalog query is missing evidence: ${required}`);
}

const catalogTests = read("packages/custody-core/tests/postgres-catalog.sh");
for (const required of [
  "Custody PostgreSQL catalog drift unexpectedly passed",
  "DISABLE TRIGGER custody_projection_outbox_append_only",
  "GRANT SELECT ON custody_core.custody_projection_outbox TO PUBLIC",
  "SECURITY INVOKER",
  "RESET search_path",
  "DROP CONSTRAINT custody_projection_network_testnet",
  "DISABLE TRIGGER schema_migrations_validate_sequence",
  "GRANT SELECT ON custody_core.schema_migrations TO PUBLIC",
  "custody-postgres-catalog-negative-ok"
]) {
  assert(catalogTests.includes(required), `Custody catalog tests are missing evidence: ${required}`);
}

const migrationSourceCatalog = read(
  "packages/custody-core/scripts/verify-postgres-migration-source-catalog.mjs"
);
for (const required of [
  "0001_custody_projection_outbox.sql",
  "2c0ee1744180763f0d76a0f0282fd2797c826a622164a04b6d6e0a4eab3b1202",
  "0002_custody_migration_history.sql",
  "8cec61ccf50fd42ba823398b7f670ce61a0f45ab0ec4e1707d498e7cf929d3c4",
  "PostgreSQL custody migration source files differ from canonical manifest",
  "PostgreSQL custody migration source digest differs for"
]) {
  assert(
    migrationSourceCatalog.includes(required),
    `Custody migration source catalog is missing evidence: ${required}`
  );
}

const migrationSourceTests = read(
  "packages/custody-core/tests/postgres-migration-source-catalog.sh"
);
for (const required of [
  "Invalid custody migration source catalog unexpectedly passed.",
  "-- unreviewed source drift",
  "9999_unreviewed_migration.sql",
  "custody-postgres-migration-source-catalog-negative-ok"
]) {
  assert(
    migrationSourceTests.includes(required),
    `Custody migration source tests are missing evidence: ${required}`
  );
}

const migrationSourcePolicy = read(
  "packages/custody-core/scripts/verify-postgres-migration-source-policy.mjs"
);
for (const required of [
  "PostgreSQL custody migration filename is not canonical",
  "PostgreSQL custody migration source versions must form a contiguous sequence starting at 0001",
  "PostgreSQL custody migration must contain exactly one top-level BEGIN and COMMIT transaction boundary",
  "PostgreSQL custody migration must not execute psql meta-commands",
  "const historyBootstrapVersion = 2;",
  "PostgreSQL custody migration history rows must match canonical source history",
  "PostgreSQL custody migration must change history only through canonical history rows",
  "PostgreSQL custody migration history table must be created only by the history bootstrap migration",
  "custody-postgres-migration-source-policy-ok"
]) {
  assert(
    migrationSourcePolicy.includes(required),
    `Custody migration source policy is missing evidence: ${required}`
  );
}

const migrationSourcePolicyTests = read(
  "packages/custody-core/tests/postgres-migration-source-policy.sh"
);
for (const required of [
  "Invalid custody migration source policy unexpectedly passed.",
  "ROLLBACK;",
  "\\\\ir unreviewed.sql",
  "1_custody_projection_outbox.sql",
  "0003_custody_migration_history.sql",
  "PostgreSQL custody migration source policy requires the history bootstrap migration 0002",
  "PostgreSQL custody migration history rows must match canonical source history",
  "PostgreSQL custody migration must change history only through canonical history rows",
  "PostgreSQL custody migration history table must be created only by the history bootstrap migration",
  "custody-postgres-migration-source-policy-negative-ok"
]) {
  assert(
    migrationSourcePolicyTests.includes(required),
    `Custody migration source policy tests are missing evidence: ${required}`
  );
}

const historyMigration = read(
  "packages/custody-core/migrations/0002_custody_migration_history.sql"
);
for (const required of [
  "CREATE TABLE custody_core.schema_migrations",
  "schema_migrations_applied_at_finite",
  "custody migration history is append-only",
  "CREATE TRIGGER schema_migrations_validate_sequence",
  "ENABLE ALWAYS TRIGGER schema_migrations_validate_sequence",
  "ENABLE ALWAYS TRIGGER schema_migrations_append_only",
  "ENABLE ALWAYS TRIGGER schema_migrations_reject_truncate",
  "VALUES (1, '0001_custody_projection_outbox');",
  "VALUES (2, '0002_custody_migration_history');"
]) {
  assert(
    historyMigration.includes(required),
    `Custody migration history migration is missing evidence: ${required}`
  );
}

const migrationHistory = read(
  "packages/custody-core/scripts/verify-postgres-migration-history.mjs"
);
for (const required of [
  '{ migration_name: "0001_custody_projection_outbox", version: 1 }',
  '{ migration_name: "0002_custody_migration_history", version: 2 }',
  "PostgreSQL custody migration history differs from canonical manifest",
  "PostgreSQL custody migrations were not applied in canonical version order",
  "custody-postgres-migration-history-ok"
]) {
  assert(
    migrationHistory.includes(required),
    `Custody migration history verifier is missing evidence: ${required}`
  );
}

const migrationHistoryQuery = read(
  "packages/custody-core/tests/postgres-migration-history.sql"
);
for (const required of [
  "custody_core.schema_migrations",
  "applied_in_version_order"
]) {
  assert(
    migrationHistoryQuery.includes(required),
    `Custody migration history query is missing evidence: ${required}`
  );
}

const migrationHistoryTests = read(
  "packages/custody-core/tests/postgres-migration-history.sh"
);
for (const required of [
  "9999_unreviewed_migration",
  "DISABLE TRIGGER schema_migrations_append_only",
  "custody migration version 4 must follow installed version 2 with version 3",
  "custody migration name 0004_wrong_version must encode version 3",
  "custody migration applied_at must be later than installed version 2",
  "SET session_replication_role = replica;",
  "custody migration history is append-only",
  "assert_failed_history_bootstrap_rolled_back",
  "Intentionally failed PostgreSQL custody migration unexpectedly committed.",
  "custody-postgres-migration-rollback-ok",
  "custody-postgres-migration-sequence-guard-ok",
  "custody-postgres-migration-history-negative-ok"
]) {
  assert(
    migrationHistoryTests.includes(required),
    `Custody migration history tests are missing evidence: ${required}`
  );
}

const stateSnapshot = read("packages/custody-core/tests/postgres-state-snapshot.sql");
for (const required of [
  "custody-core-state-v2",
  "custody_projection_outbox",
  "schema_migrations",
  "jsonb_agg(row_data ORDER BY sort_key COLLATE \"C\")"
]) {
  assert(stateSnapshot.includes(required), `Custody state snapshot is missing evidence: ${required}`);
}

const backupRestore = read("packages/custody-core/tests/postgres-backup-restore.sh");
for (const required of [
  "--schema=custody_core",
  "--single-transaction",
  "tests/postgres-backup-consistency.sql",
  "Concurrent custody backup contains a partial or unexpected state.",
  "custody-postgres-backup-consistency-ok",
  "tests/postgres-backup-continuity.sql",
  "Restored custody continuity test changed the source state.",
  "Restored custody state did not advance after a new projection.",
  "custody-postgres-backup-continuity-ok",
  "Second-generation custody restore differs from the active restored state.",
  "custody-postgres-backup-chain-ok",
  "Custody backup unexpectedly restored into an occupied target.",
  "Rejected custody restore changed the occupied target.",
  "custody-postgres-backup-collision-ok",
  "Custody backup unexpectedly contains unrelated source state.",
  "Custody restore changed unrelated target state.",
  "custody-postgres-backup-scope-isolation-ok",
  "Corrupted custody-core backup unexpectedly restored.",
  "Corrupted custody-core restore left a partial schema.",
  "custody-postgres-backup-corruption-ok",
  "PGDATABASE=\"$RESTORE_DATABASE\"",
  "bash tests/postgres-catalog.sh",
  "bash tests/postgres-migration-history.sh",
  "Restored custody-core state differs from the source state.",
  "custody-postgres-backup-restore-ok"
]) {
  assert(backupRestore.includes(required), `Custody recovery test is missing evidence: ${required}`);
}

const adr = read("Documentation/regulated-core/adr/0003-isolate-custody-signing-boundary.md");
for (const required of [
  "Status: Proposed",
  "No process outside the signer boundary receives private key material",
  "does not authorize production signing"
]) {
  assert(adr.includes(required), `Custody ADR is missing boundary: ${required}`);
}

const workflow = read(".github/workflows/custody-core-ci.yml");
assert(workflow.includes("npm run verify"));
assert(workflow.includes("npm audit --audit-level=moderate"));
assert(workflow.includes("bash tests/postgres-migration-source-catalog.sh"));
assert(workflow.includes("bash tests/postgres-migration-source-policy.sh"));
assert(workflow.includes("bash tests/postgres-migration-history.sh"));

console.log("custody-boundary-ok");
