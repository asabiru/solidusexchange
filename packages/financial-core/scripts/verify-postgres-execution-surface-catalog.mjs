import assert from "node:assert/strict";

const triggers = [
  ["account_definitions", "account_definitions_append_only", "reject_mutation"],
  ["account_definitions", "account_definitions_reject_truncate", "reject_mutation"],
  ["ledger_accounts", "ledger_accounts_append_only", "reject_mutation"],
  ["ledger_accounts", "ledger_accounts_reject_truncate", "reject_mutation"],
  ["ledger_accounts", "ledger_accounts_validate", "validate_account"],
  ["ledger_assets", "ledger_assets_append_only", "reject_mutation"],
  ["ledger_assets", "ledger_assets_reject_truncate", "reject_mutation"],
  ["ledger_entries", "ledger_entries_append_only", "reject_mutation"],
  ["ledger_entries", "ledger_entries_complete", "assert_journal_complete"],
  [
    "ledger_entries",
    "ledger_entries_reject_sealed_journal",
    "reject_sealed_journal_entry"
  ],
  ["ledger_entries", "ledger_entries_reject_truncate", "reject_mutation"],
  ["ledger_entries", "ledger_entries_validate_amount", "validate_entry_amount"],
  ["ledger_idempotency_registry", "ledger_idempotency_append_only", "reject_mutation"],
  ["ledger_idempotency_registry", "ledger_idempotency_complete", "assert_journal_complete"],
  [
    "ledger_idempotency_registry",
    "ledger_idempotency_reject_truncate",
    "reject_mutation"
  ],
  [
    "ledger_idempotency_registry",
    "ledger_idempotency_validate_acceptance_timestamp",
    "validate_acceptance_artifact_timestamp"
  ],
  ["ledger_journal_seals", "ledger_journal_seals_append_only", "reject_mutation"],
  ["ledger_journal_seals", "ledger_journal_seals_complete", "assert_journal_complete"],
  ["ledger_journal_seals", "ledger_journal_seals_reject_truncate", "reject_mutation"],
  ["ledger_journals", "ledger_journals_append_only", "reject_mutation"],
  ["ledger_journals", "ledger_journals_complete", "assert_journal_complete"],
  ["ledger_journals", "ledger_journals_reject_truncate", "reject_mutation"],
  [
    "ledger_outbox_delivery_attempts",
    "ledger_delivery_attempts_append_only",
    "reject_mutation"
  ],
  [
    "ledger_outbox_delivery_attempts",
    "ledger_delivery_attempts_reject_truncate",
    "reject_mutation"
  ],
  [
    "ledger_outbox_delivery_attempts",
    "ledger_delivery_attempts_validate_outbox",
    "validate_delivery_attempt_reference"
  ],
  ["ledger_outbox_events", "ledger_outbox_append_only", "reject_mutation"],
  ["ledger_outbox_events", "ledger_outbox_complete", "assert_journal_complete"],
  ["ledger_outbox_events", "ledger_outbox_reject_truncate", "reject_mutation"],
  [
    "ledger_outbox_events",
    "ledger_outbox_validate_acceptance_timestamp",
    "validate_acceptance_artifact_timestamp"
  ],
  ["posting_rule_registry", "posting_rule_registry_append_only", "reject_mutation"],
  ["posting_rule_registry", "posting_rule_registry_reject_truncate", "reject_mutation"],
  ["schema_migrations", "schema_migrations_append_only", "reject_mutation"],
  ["schema_migrations", "schema_migrations_reject_truncate", "reject_mutation"],
  [
    "schema_migrations",
    "schema_migrations_validate_sequence",
    "validate_migration_sequence"
  ]
];

const viewReturnRules = ["ledger_account_projections", "ledger_trial_balance"];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.deepStrictEqual(
  Object.keys(actual).toSorted(),
  ["builtin_catalog", "database_shadow_objects", "rules", "shadow_objects", "triggers"],
  "PostgreSQL execution-surface catalog has an unexpected shape"
);

assert.deepStrictEqual(
  actual.triggers,
  triggers.map(([tableName, triggerName, functionName]) => ({
    table_name: tableName,
    trigger_name: triggerName,
    function_schema: "financial_core",
    function_name: functionName
  })),
  "PostgreSQL financial-core trigger inventory differs from the expected policy"
);

assert.deepStrictEqual(
  actual.rules,
  viewReturnRules.map((relationName) => ({
    relation_name: relationName,
    rule_name: "_RETURN",
    event: "SELECT",
    instead: true,
    enabled: "O"
  })),
  "PostgreSQL financial-core rewrite rules differ from the expected policy"
);

assert.deepStrictEqual(
  actual.shadow_objects,
  [],
  "PostgreSQL financial-core schema contains search-path shadow objects"
);

assert.deepStrictEqual(
  actual.database_shadow_objects,
  [],
  "PostgreSQL database contains user-defined casts or pg_catalog objects that shadow financial-core built-ins"
);

assert.deepStrictEqual(
  actual.builtin_catalog,
  {
    rows: 4314,
    sha256: "10627cdd303107ddca796d78f7d8d34ca2a4533952c1495a5360426570362bbd"
  },
  "PostgreSQL built-in casts, pg_catalog functions or operators differ from the pinned PostgreSQL 16.10 catalog"
);

console.log("postgres-execution-surface-catalog-ok");
