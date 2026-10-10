import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(root, "scripts", "check-contracts.mjs");
const contractFiles = [
  "COMPATIBILITY.md",
  "event-catalog.json",
  "examples",
  "openapi.yaml",
  "schemas"
];

function readJson(directory, path) {
  return JSON.parse(readFileSync(join(directory, path), "utf8"));
}

function writeJson(directory, path, value) {
  writeFileSync(join(directory, path), `${JSON.stringify(value, null, 2)}\n`);
}

function withScratch(mutate) {
  const scratch = mkdtempSync(join(tmpdir(), "solidchange-contract-machinery-"));
  try {
    for (const path of contractFiles) {
      cpSync(join(root, path), join(scratch, path), { recursive: true });
    }
    mutate(scratch);
    return spawnSync(process.execPath, [checker, scratch], { encoding: "utf8" });
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

function assertRejected(name, expected, mutate) {
  test(name, () => {
    const result = withScratch(mutate);
    assert.notEqual(result.status, 0, "Invalid contract machinery input unexpectedly passed");
    assert(
      `${result.stdout}${result.stderr}`.includes(expected),
      `Expected rejection containing: ${expected}`
    );
  });
}

function assertAccepted(name, mutate) {
  test(name, () => {
    const result = withScratch(mutate);
    assert.equal(
      result.status,
      0,
      `Valid contract machinery input unexpectedly rejected: ${result.stdout}${result.stderr}`
    );
  });
}

function mutateOpenApi(scratch, mutate) {
  const openapi = readJson(scratch, "openapi.yaml");
  mutate(openapi);
  writeJson(scratch, "openapi.yaml", openapi);
}

function mutateEventSchema(scratch, mutate) {
  const schema = readJson(scratch, "schemas/events/domain-event.schema.json");
  mutate(schema);
  writeJson(scratch, "schemas/events/domain-event.schema.json", schema);
}

function mutateExamples(scratch, mutate) {
  const examples = readJson(scratch, "examples/domain-events.json");
  mutate(examples);
  writeJson(scratch, "examples/domain-events.json", examples);
}

// Closed-schema keyword shapes and type families

assertRejected(
  "rejects enum literals that violate the declared event type",
  "violates the declared type",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.review_state = { type: "string", enum: ["ok", 5] };
  })
);

assertRejected(
  "rejects a non-array enum in an event schema",
  "enum must be an array of unique literals",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.review_state = { type: "string", enum: "approved" };
  })
);

assertRejected(
  "rejects duplicate enum literals in an event schema",
  "enum must be an array of unique literals",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.review_state = { type: "string", enum: ["a", "a"] };
  })
);

assertRejected(
  "rejects a string keyword applied to an integer event field",
  "minLength requires a string type",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.attempt = { type: "integer", minLength: 1 };
  })
);

assertRejected(
  "rejects an array keyword applied to a string event field",
  "items requires an array type",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.tag = { type: "string", items: { type: "string" } };
  })
);

assertRejected(
  "rejects an object keyword applied to an integer event field",
  "required requires an object type",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.attempt = { type: "integer", required: ["x"] };
  })
);

assertRejected(
  "rejects a numeric keyword applied to a string event field",
  "minimum requires an integer type",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.tag = { type: "string", minimum: 0 };
  })
);

assertRejected(
  "rejects required properties absent from the declared properties",
  "required property missing is not declared",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.review = {
      type: "object",
      additionalProperties: false,
      required: ["missing"],
      properties: {}
    };
  })
);

assertRejected(
  "rejects duplicate required entries in an event object schema",
  "required must be an array of unique property names",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.review = {
      type: "object",
      additionalProperties: false,
      required: ["a", "a"],
      properties: { a: { type: "string" } }
    };
  })
);

assertRejected(
  "rejects malformed keyword values in an event schema",
  "minimum must be a finite number",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.attempt = { type: "integer", minimum: "1" };
  })
);

assertRejected(
  "rejects an event pattern that does not compile under the Unicode flag",
  "pattern must compile under the Unicode flag",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.tag = { type: "string", pattern: "[unclosed" };
  })
);

assertAccepted(
  "accepts integer enums and nullable enums matching the declared type",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalHeld.properties.attempt = { type: "integer", enum: [1, 2, 3] };
    schema.$defs.withdrawalHeld.properties.note = { type: ["string", "null"], enum: ["a", null] };
  })
);

// Duplicate JSON keys (openapi.yaml is strict JSON; JSON.parse keeps the last copy)

assertRejected(
  "rejects duplicate JSON keys in the OpenAPI document",
  "duplicate JSON key",
  (scratch) => {
    const path = join(scratch, "openapi.yaml");
    const text = readFileSync(path, "utf8");
    const needle = "\"version\": \"1.0.0-draft\"";
    writeFileSync(path, text.replace(needle, `${needle},\n    \"version\": \"9.9.9-shadow\"`));
  }
);

assertRejected(
  "rejects duplicate JSON keys in the event schema",
  "duplicate JSON key",
  (scratch) => {
    const path = join(scratch, "schemas/events/domain-event.schema.json");
    const text = readFileSync(path, "utf8");
    const needle = "\"type\": \"object\"";
    writeFileSync(path, text.replace(needle, `${needle},\n    \"type\": \"object\"`));
  }
);

assertRejected(
  "rejects duplicate JSON keys in event examples",
  "duplicate JSON key",
  (scratch) => {
    const path = join(scratch, "examples/domain-events.json");
    const text = readFileSync(path, "utf8");
    const needle = "\"event_type\": \"UserRegistered\"";
    writeFileSync(path, text.replace(needle, `${needle},\n      \"event_type\": \"UserRegistered\"`));
  }
);

assertRejected(
  "rejects duplicate JSON keys in the error schema",
  "duplicate JSON key",
  (scratch) => {
    const path = join(scratch, "schemas/error.schema.json");
    const text = readFileSync(path, "utf8");
    const needle = "\"type\": \"object\"";
    writeFileSync(path, text.replace(needle, `${needle},\n    \"type\": \"object\"`));
  }
);

assertRejected(
  "rejects duplicate JSON keys in the event catalog",
  "duplicate JSON key",
  (scratch) => {
    const path = join(scratch, "event-catalog.json");
    const text = readFileSync(path, "utf8");
    const needle = "\"catalog_version\": 1";
    writeFileSync(path, text.replace(needle, `${needle},\n  \"catalog_version\": 1`));
  }
);

// Planned namespaces and operation surface

assertRejected(
  "rejects an unregistered planned namespace",
  "Planned namespaces",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi["x-solidchange-planned-namespaces"].internal = ["/api/v1/internal/admin"];
  })
);

assertRejected(
  "rejects duplicate parameters on an operation",
  "Duplicate parameter",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/customer/session"].get.parameters
      .push({ $ref: "#/components/parameters/RequestId" });
  })
);

assertRejected(
  "rejects parameters duplicated between path item and operation",
  "Duplicate parameter",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    const pathItem = openapi.paths["/api/v1/customer/session"];
    pathItem.parameters = [{ $ref: "#/components/parameters/RequestId" }];
  })
);

assertRejected(
  "rejects a missing local $ref target in extra definitions",
  "missing JSON pointer",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.$defs.alias = { $ref: "#/components/schemas/NoSuchSchema" };
  })
);

assertRejected(
  "rejects ambiguous multi-fragment $ref values",
  "Ambiguous $ref",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.$defs.alias = { $ref: "#/components/schemas/SessionView#junk" };
  })
);

assertRejected(
  "rejects tilde-escaped $ref values the consumer resolver cannot follow",
  "Encoded $ref is prohibited",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.$defs["a/b"] = { type: "string" };
    openapi.$defs.alias = { $ref: "#/$defs/a~1b" };
  })
);

assertRejected(
  "rejects nested schema identifiers inside the OpenAPI document",
  "nested $id is prohibited",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.$defs.extra = { $id: "https://untrusted.invalid/extra.json", type: "string" };
  })
);

assertAccepted(
  "accepts cyclic extra definitions that never resolve (cycle terminates)",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.$defs.cycle_a = { $ref: "#/$defs/cycle_b" };
    openapi.$defs.cycle_b = { $ref: "#/$defs/cycle_a" };
  })
);

// Example validator machinery

assertRejected(
  "rejects event examples exceeding a declared maxItems bound",
  "too many items",
  (scratch) => {
    mutateEventSchema(scratch, (schema) => {
      schema.$defs.withdrawalHeld.properties.review = {
        type: "object",
        additionalProperties: false,
        required: ["review_reference"],
        properties: {
          review_reference: { $ref: "#/$defs/identifier" },
          tags: { type: "array", maxItems: 8, items: { type: "string", pattern: "^[a-z]{2,16}$" } }
        }
      };
    });
    mutateExamples(scratch, (examples) => {
      examples.find((event) => event.event_type === "WithdrawalHeld").payload.review = {
        review_reference: "rev_0001",
        tags: ["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh", "ii"]
      };
    });
  }
);

assertRejected(
  "rejects astral characters undercounted toward minLength",
  "string is too short",
  (scratch) => mutateExamples(scratch, (examples) => {
    examples.find((event) => event.event_type === "UserRegistered").idempotency_key =
      "😀😀😀😀😀😀😀😀";
  })
);

assertAccepted(
  "accepts astral strings within code-point maxLength bounds",
  (scratch) => mutateExamples(scratch, (examples) => {
    examples.find((event) => event.event_type === "UserRegistered").idempotency_key =
      "😀".repeat(65);
  })
);

assertRejected(
  "rejects patterns matched on code units instead of code points",
  "pattern mismatch",
  (scratch) => {
    mutateEventSchema(scratch, (schema) => {
      schema.$defs.withdrawalHeld.properties.tag = { type: "string", pattern: "^.{3}$" };
    });
    mutateExamples(scratch, (examples) => {
      examples.find((event) => event.event_type === "WithdrawalHeld").payload.tag = "a😀";
    });
  }
);

assertAccepted(
  "accepts patterns matched on code points with the Unicode flag",
  (scratch) => {
    mutateEventSchema(scratch, (schema) => {
      schema.$defs.withdrawalHeld.properties.tag = { type: "string", pattern: "^.{2}$" };
    });
    mutateExamples(scratch, (examples) => {
      examples.find((event) => event.event_type === "WithdrawalHeld").payload.tag = "a😀";
    });
  }
);

assertRejected(
  "rejects non-RFC3339 date-time strings in event examples",
  "invalid date-time",
  (scratch) => mutateExamples(scratch, (examples) => {
    examples.find((event) => event.event_type === "QuoteCreated").payload.expires_at =
      "2024-01-01";
  })
);

assertRejected(
  "rejects key-order-equal objects inside a uniqueItems array",
  "duplicate items",
  (scratch) => {
    mutateEventSchema(scratch, (schema) => {
      schema.$defs.withdrawalHeld.properties.review = {
        type: "object",
        additionalProperties: false,
        required: ["review_reference"],
        properties: {
          review_reference: { $ref: "#/$defs/identifier" },
          pairs: {
            type: "array",
            uniqueItems: true,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["a", "b"],
              properties: { a: { type: "integer" }, b: { type: "integer" } }
            }
          }
        }
      };
    });
    mutateExamples(scratch, (examples) => {
      examples.find((event) => event.event_type === "WithdrawalHeld").payload.review = {
        review_reference: "rev_0001",
        pairs: [{ a: 1, b: 2 }, { b: 2, a: 1 }]
      };
    });
  }
);

assertRejected(
  "rejects an example violating the closed required/properties contract",
  "unknown field",
  (scratch) => mutateExamples(scratch, (examples) => {
    examples.find((event) => event.event_type === "WithdrawalHeld").payload.unlisted_field =
      "not declared";
  })
);
