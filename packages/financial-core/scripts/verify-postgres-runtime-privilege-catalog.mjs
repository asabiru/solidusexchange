import assert from "node:assert/strict";

const selectOnly = [
  "ledger_accounts",
  "ledger_assets",
  "posting_rule_registry"
];
const appendOnly = [
  "ledger_entries",
  "ledger_idempotency_registry",
  "ledger_journal_seals",
  "ledger_journals",
  "ledger_outbox_events"
];

function grant(objectType, objectName, privilege, grantee = "runtime") {
  return {
    column_name: null,
    grantable: false,
    grantee,
    object_name: objectName,
    object_type: objectType,
    privilege
  };
}

const expected = {
  default_privileges: [],
  grants: [
    grant("database", "current_database", "CONNECT", "public"),
    grant("schema", "financial_core", "USAGE"),
    ...[...selectOnly, ...appendOnly]
      .sort()
      .flatMap((table) =>
        appendOnly.includes(table)
          ? [grant("table", table, "INSERT"), grant("table", table, "SELECT")]
          : [grant("table", table, "SELECT")]
      )
  ],
  memberships: [],
  runtime_role: {
    bypass_row_security: false,
    can_login: false,
    configuration: [],
    create_database: false,
    create_role: false,
    database_configuration: [],
    exists: true,
    inherit: false,
    owns_database: false,
    owns_financial_objects: false,
    replication: false,
    superuser: false
  }
};

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.deepStrictEqual(
  actual,
  expected,
  "PostgreSQL runtime role or privileges differ from the reviewed least-privilege profile"
);

console.log("postgres-runtime-privilege-catalog-ok");
