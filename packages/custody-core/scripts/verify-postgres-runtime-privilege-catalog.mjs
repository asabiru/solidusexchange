import assert from "node:assert/strict";

function grant(objectType, objectName, privilege) {
  return {
    column_name: null,
    grantable: false,
    grantee: "runtime",
    object_name: objectName,
    object_type: objectType,
    privilege
  };
}

const expected = {
  default_privileges: [],
  grants: [
    grant(
      "function",
      "record_custody_projection(p_event_document jsonb, p_request_digest text)",
      "EXECUTE"
    ),
    grant("schema", "custody_core", "USAGE")
  ],
  runtime_role: {
    bypass_row_security: false,
    can_login: false,
    configuration: [],
    connection_limit: -1,
    create_database: false,
    create_role: false,
    exists: true,
    inherit: false,
    memberships: [],
    owns_custody_objects: false,
    owns_database: false,
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
  "PostgreSQL custody runtime role or privileges differ from the reviewed least-privilege profile"
);

console.log("custody-postgres-runtime-privilege-catalog-ok");
