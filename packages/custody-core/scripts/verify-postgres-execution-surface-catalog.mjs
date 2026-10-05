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
  ["builtin_catalog", "database_shadow_objects", "rules", "shadow_objects", "triggers"],
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

assert.deepStrictEqual(
  actual.database_shadow_objects,
  [],
  "PostgreSQL database contains user-defined casts or pg_catalog objects that shadow custody built-ins"
);

assert.deepStrictEqual(
  actual.builtin_catalog,
  {
    rows: 4314,
    sha256: "10627cdd303107ddca796d78f7d8d34ca2a4533952c1495a5360426570362bbd"
  },
  "PostgreSQL built-in casts, pg_catalog functions or operators differ from the pinned PostgreSQL 16.10 catalog"
);

console.log("custody-postgres-execution-surface-catalog-ok");
