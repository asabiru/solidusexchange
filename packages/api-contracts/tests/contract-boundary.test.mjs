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

function assertRejected(name, expected, mutate) {
  test(name, () => {
    const scratch = mkdtempSync(join(tmpdir(), "solidchange-contract-boundary-"));
    try {
      for (const path of contractFiles) {
        cpSync(join(root, path), join(scratch, path), { recursive: true });
      }
      mutate(scratch);
      const result = spawnSync(process.execPath, [checker, scratch], {
        encoding: "utf8"
      });
      assert.notEqual(result.status, 0, "Invalid contract boundary unexpectedly passed");
      assert(
        `${result.stdout}${result.stderr}`.includes(expected),
        `Expected rejection containing: ${expected}`
      );
    } finally {
      rmSync(scratch, { force: true, recursive: true });
    }
  });
}

assertRejected(
  "rejects enabled financial commands",
  "Financial commands must remain disabled",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi["x-solidchange-financial-commands-enabled"] = true;
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects mutation methods",
  "Mutation method is prohibited in this slice",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.paths["/api/v1/meta"].post = structuredClone(
      openapi.paths["/api/v1/meta"].get
    );
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects anonymous security alternatives",
  "Security must contain exactly one CustomerBearer requirement",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.paths["/api/v1/customer/session"].get.security.push({});
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects protected operations hidden behind path item references",
  "Path item $ref is prohibited: /api/v1/customer/session",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    const operation = structuredClone(
      openapi.paths["/api/v1/customer/session"].get
    );
    operation.security = [];
    openapi.components.pathItems = { CustomerSession: { get: operation } };
    openapi.paths["/api/v1/customer/session"] = {
      $ref: "#/components/pathItems/CustomerSession"
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects removed protected operations",
  "Pinned API operations",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    delete openapi.paths["/api/v1/customer/session"];
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects protected operations moved to unauthenticated metadata paths",
  "Operation path is not pinned: getCustomerSession /api/v1/meta",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    const operation = openapi.paths["/api/v1/customer/session"].get;
    operation.security = [];
    delete openapi.paths["/api/v1/customer/session"];
    openapi.paths["/api/v1/meta"].get = operation;
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened authentication scheme definitions",
  "CustomerBearer must remain an HTTP security scheme",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.securitySchemes.CustomerBearer = {
      type: "apiKey",
      in: "header",
      name: "X-Customer-Token"
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects request context outside headers",
  "RequestId must remain a header parameter",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.RequestId.in = "query";
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects renamed request context headers",
  "ClientVersion must use X-Client-Version",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.ClientVersion.name = "X-App-Version";
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened client version constraints",
  "Canonical ClientVersion constraints must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.ClientVersion.schema = {
      type: "integer"
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened platform constraints",
  "Canonical Platform enum",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    delete openapi.components.parameters.Platform.schema.enum;
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened request ID schemas",
  "RequestId must use canonical UuidV7 schema",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.RequestId.schema = {
      type: "string"
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened canonical request ID constraints",
  "Canonical UuidV7 constraints must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.UuidV7.pattern = ".*";
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened idempotency key schemas",
  "IdempotencyKey must use canonical IdempotencyKey schema",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.IdempotencyKey.schema = {
      type: "string"
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened canonical idempotency key constraints",
  "Canonical IdempotencyKey constraints must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.IdempotencyKey.pattern = ".*";
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects remote references",
  "Remote $ref is prohibited",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.RemoteContract = {
      $ref: "https://contracts.invalid/schema.json"
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects permissive error envelopes",
  "Error envelope must reject unknown top-level fields",
  (scratch) => {
    const schema = readJson(scratch, "schemas/error.schema.json");
    schema.additionalProperties = true;
    writeJson(scratch, "schemas/error.schema.json", schema);
  }
);

assertRejected(
  "rejects operation-specific error envelopes",
  "Error response must use canonical Error schema",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.paths["/api/v1/customer/session"].get.responses["401"] = {
      description: "Unsafe inline error",
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: true
          }
        }
      }
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects alternate protected error response media types",
  "Error response media types for getCustomerSession 401",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.responses.Unauthenticated.content["text/html"] = {
      schema: {
        type: "string"
      }
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects alternate protected success statuses",
  "Success response statuses for getCustomerSession",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.paths["/api/v1/customer/session"].get.responses["201"] =
      structuredClone(
        openapi.paths["/api/v1/customer/session"].get.responses["200"]
      );
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects alternate protected success response media types",
  "Success response media types for getCustomerSession 200",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.paths["/api/v1/customer/session"].get.responses["200"].content[
      "text/html"
    ] = {
      schema: {
        type: "string"
      }
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects noncanonical protected success response schemas",
  "Success response must use canonical schema: getCustomerSession 200",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.paths["/api/v1/customer/session"].get.responses[
      "200"
    ].content["application/json"].schema = {
      type: "object",
      additionalProperties: true
    };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects enabled commands in canonical capabilities views",
  "Canonical CapabilitiesView schema must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.CapabilitiesView.properties.commands_enabled.const = true;
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects permissive canonical session views",
  "Canonical SessionView schema must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.SessionView.additionalProperties = true;
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects removed canonical session view required fields",
  "Canonical SessionView schema must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.SessionView.required = ["subject"];
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects event execution authority",
  "Events must not grant execution authority",
  (scratch) => {
    const catalog = readJson(scratch, "event-catalog.json");
    catalog.execution_authority = true;
    writeJson(scratch, "event-catalog.json", catalog);
  }
);

assertRejected(
  "rejects prohibited event fields",
  "prohibited field wallet_address",
  (scratch) => {
    const schema = readJson(
      scratch,
      "schemas/events/domain-event.schema.json"
    );
    schema.$defs.withdrawalBroadcast.properties.wallet_address = {
      type: "string"
    };
    writeJson(scratch, "schemas/events/domain-event.schema.json", schema);
  }
);

const eventSchemaPath = "schemas/events/domain-event.schema.json";

function mutateEventSchema(scratch, mutate) {
  const schema = readJson(scratch, eventSchemaPath);
  mutate(schema);
  writeJson(scratch, eventSchemaPath, schema);
}

for (const field of ["correlation_id", "causation_id", "idempotency_key", "actor"]) {
  assertRejected(
    `rejects removed event envelope ${field} requirement`,
    "Event envelope required fields",
    (scratch) => mutateEventSchema(scratch, (schema) => {
      schema.required = schema.required.filter((name) => name !== field);
    })
  );
}

assertRejected(
  "rejects permissive event envelope",
  "Event envelope must reject unknown top-level fields",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.additionalProperties = true;
  })
);

assertRejected(
  "rejects weakened event correlation schema",
  "Canonical event correlation_id schema must remain pinned",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.properties.correlation_id = {};
  })
);

assertRejected(
  "rejects weakened event idempotency schema",
  "Canonical event idempotency_key schema must remain pinned",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    delete schema.properties.idempotency_key.minLength;
  })
);

assertRejected(
  "rejects permissive event actor definition",
  "Canonical event actor definition must remain pinned",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.actor.additionalProperties = true;
  })
);

test("accepts optional event envelope fields and reordered required fields", () => {
  const scratch = mkdtempSync(join(tmpdir(), "solidchange-contract-boundary-"));
  try {
    for (const path of contractFiles) {
      cpSync(join(root, path), join(scratch, path), { recursive: true });
    }
    mutateEventSchema(scratch, (schema) => {
      schema.required = [...schema.required].reverse();
      schema.properties.trace_parent = { type: "string", maxLength: 128 };
    });
    const result = spawnSync(process.execPath, [checker, scratch], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
});
