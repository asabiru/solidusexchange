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
  runtime_role_exists: true
};

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

const actual = JSON.parse(input);
assert.deepStrictEqual(
  actual,
  expected,
  "PostgreSQL custody runtime writer privileges differ from the reviewed least-privilege profile"
);

console.log("custody-postgres-runtime-privilege-catalog-ok");
