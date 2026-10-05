import assert from "node:assert/strict";

const triggers = [
  [
    "custody_projection_outbox",
    "custody_projection_outbox_append_only",
    "reject_outbox_mutation"
  ],
  [
    "custody_projection_outbox",
    "custody_projection_outbox_reject_truncate",
    "reject_outbox_mutation"
  ],
  [
    "schema_migrations",
    "schema_migrations_append_only",
    "reject_migration_history_mutation"
  ],
  [
    "schema_migrations",
    "schema_migrations_reject_truncate",
    "reject_migration_history_mutation"
  ],
  [
    "schema_migrations",
    "schema_migrations_validate_sequence",
    "validate_migration_sequence"
  ]
];

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.deepStrictEqual(
  Object.keys(actual).toSorted(),
  ["rules", "shadow_objects", "triggers"],
  "PostgreSQL custody execution-surface catalog has an unexpected shape"
);

assert.deepStrictEqual(
  actual.triggers,
  triggers.map(([tableName, triggerName, functionName]) => ({
    table_name: tableName,
    trigger_name: triggerName,
    function_schema: "custody_core",
    function_name: functionName
  })),
  "PostgreSQL custody trigger inventory differs from the expected policy"
);

assert.deepStrictEqual(
  actual.rules,
  [],
  "PostgreSQL custody rewrite rules differ from the expected policy"
);

assert.deepStrictEqual(
  actual.shadow_objects,
  [],
  "PostgreSQL custody schema contains search-path shadow objects"
);

console.log("custody-postgres-execution-surface-catalog-ok");
