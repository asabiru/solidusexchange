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

function withoutDeviceId(parameters) {
  return parameters.filter((parameter) => parameter.$ref !== "#/components/parameters/DeviceId");
}

assertRejected(
  "rejects operator operations without a device identifier",
  "Missing X-Device-Id: getOperatorSession",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    const operation = openapi.paths["/api/v1/operator/session"].get;
    operation.parameters = withoutDeviceId(operation.parameters);
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

for (const [pathName, operationId] of [
  ["/api/v1/customer/session", "getCustomerSession"],
  ["/api/v1/customer/capabilities", "getCustomerCapabilities"],
  ["/api/v1/meta", "getApiMetadata"]
]) {
  assertRejected(
    `rejects device identifiers on ${operationId}`,
    `X-Device-Id is approved only for operator operations: ${operationId}`,
    (scratch) => {
      const openapi = readJson(scratch, "openapi.yaml");
      openapi.paths[pathName].get.parameters.push({ $ref: "#/components/parameters/DeviceId" });
      writeJson(scratch, "openapi.yaml", openapi);
    }
  );
}

assertRejected(
  "rejects optional device identifiers",
  "DeviceId must be required when used",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.DeviceId.required = false;
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened device ID parameter schemas",
  "DeviceId must use canonical DeviceId schema",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.parameters.DeviceId.schema = { type: "string" };
    writeJson(scratch, "openapi.yaml", openapi);
  }
);

assertRejected(
  "rejects weakened canonical device ID constraints",
  "Canonical DeviceId constraints must remain pinned",
  (scratch) => {
    const openapi = readJson(scratch, "openapi.yaml");
    openapi.components.schemas.DeviceId.pattern = ".*";
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

function mutateEventCatalog(scratch, mutate) {
  const catalog = readJson(scratch, "event-catalog.json");
  mutate(catalog);
  writeJson(scratch, "event-catalog.json", catalog);
}

assertRejected(
  "rejects permissive event payload schemas",
  "WithdrawalApproved payload must reject unknown fields",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalApproved.additionalProperties = true;
  })
);

assertRejected(
  "rejects removed event payload required fields",
  "WithdrawalApproved payload required fields",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalApproved.required = ["withdrawal_id"];
  })
);

assertRejected(
  "rejects event payload pattern properties",
  "WithdrawalApproved payload schema keywords",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.$defs.withdrawalApproved.patternProperties = { "^.*$": {} };
  })
);

assertRejected(
  "rejects consistent removal of a catalogued event",
  "Pinned event types",
  (scratch) => {
    const removed = "WithdrawalHeld";
    mutateEventSchema(scratch, (schema) => {
      schema.properties.event_type.enum = schema.properties.event_type.enum.filter((name) => name !== removed);
      schema.allOf = schema.allOf.filter((condition) => condition.if.properties.event_type.const !== removed);
    });
    mutateEventCatalog(scratch, (catalog) => {
      catalog.events = catalog.events.filter((event) => event.name !== removed);
    });
    const examples = readJson(scratch, "examples/domain-events.json");
    writeJson(scratch, "examples/domain-events.json", examples.filter((event) => event.event_type !== removed));
  }
);

assertRejected(
  "rejects duplicate event types",
  "Event schema contains duplicate event types",
  (scratch) => mutateEventSchema(scratch, (schema) => {
    schema.properties.event_type.enum.push("WithdrawalHeld");
  })
);

assertRejected(
  "rejects command flags on event catalog entries",
  "Event catalog entry UserRegistered keys",
  (scratch) => mutateEventCatalog(scratch, (catalog) => {
    catalog.events[0].command_enabled = true;
  })
);

assertRejected(
  "rejects unknown event catalog keys",
  "Event catalog keys",
  (scratch) => mutateEventCatalog(scratch, (catalog) => {
    catalog.commands_enabled = true;
  })
);

assertRejected(
  "rejects a consistent event data classification downgrade",
  "KycSubmitted: data classification must remain pinned",
  (scratch) => {
    mutateEventCatalog(scratch, (catalog) => {
      catalog.events.find((event) => event.name === "KycSubmitted").data_classification = "confidential";
    });
    const examples = readJson(scratch, "examples/domain-events.json");
    examples.find((event) => event.event_type === "KycSubmitted").data_classification = "confidential";
    writeJson(scratch, "examples/domain-events.json", examples);
  }
);

assertRejected(
  "rejects an event owner change",
  "WithdrawalRequested: owner must remain pinned",
  (scratch) => mutateEventCatalog(scratch, (catalog) => {
    catalog.events.find((event) => event.name === "WithdrawalRequested").owner = "custody-orchestrator";
  })
);

test("accepts optional event payload fields and reordered payload required fields", () => {
  const scratch = mkdtempSync(join(tmpdir(), "solidchange-contract-boundary-"));
  try {
    for (const path of contractFiles) {
      cpSync(join(root, path), join(scratch, path), { recursive: true });
    }
    mutateEventSchema(scratch, (schema) => {
      const payload = schema.$defs.withdrawalHeld;
      payload.required = [...payload.required].reverse();
      payload.properties.review_reference = { $ref: "#/$defs/identifier" };
    });
    const examples = readJson(scratch, "examples/domain-events.json");
    examples.find((event) => event.event_type === "WithdrawalHeld").payload.review_reference = "review_0001";
    writeJson(scratch, "examples/domain-events.json", examples);
    const result = spawnSync(process.execPath, [checker, scratch], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
});

function mutateOpenApi(scratch, mutate) {
  const openapi = readJson(scratch, "openapi.yaml");
  mutate(openapi);
  writeJson(scratch, "openapi.yaml", openapi);
}

const moneyMovingPost = {
  post: {
    operationId: "createWithdrawal",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true, properties: { amount: { type: "string" } } }
        }
      }
    },
    responses: { "202": { description: "Accepted" } }
  }
};

assertRejected(
  "rejects money-moving webhook operations outside paths",
  "OpenAPI webhooks are prohibited in this slice",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.webhooks = { withdrawalRequested: structuredClone(moneyMovingPost) };
  })
);

assertRejected(
  "rejects referenced component path items",
  "OpenAPI components.pathItems are prohibited in this slice",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.components.pathItems = { withdrawal: structuredClone(moneyMovingPost) };
  })
);

assertRejected(
  "rejects money-moving callback operations",
  "Callbacks are prohibited in this slice: getCustomerSession",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/customer/session"].get.callbacks = {
      withdrawal: { "{$request.header.X-Request-Id}": structuredClone(moneyMovingPost) }
    };
  })
);

assertRejected(
  "rejects permissive command bodies on read-only operations",
  "Request bodies are prohibited in this slice: getOperatorCapabilities",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/operator/capabilities"].get.requestBody = structuredClone(
      moneyMovingPost.post.requestBody
    );
  })
);

assertRejected(
  "rejects optional request ID response header component",
  "Canonical RequestId response header must remain required with the UuidV7 schema",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.components.headers.RequestId.required = false;
  })
);

assertRejected(
  "rejects permissive request ID response header schema",
  "Canonical RequestId response header must remain required with the UuidV7 schema",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.components.headers.RequestId.schema = { type: "string" };
  })
);

assertRejected(
  "rejects optional inline success request ID header",
  "Response must echo the canonical X-Request-Id header: getCustomerSession 200",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/customer/session"].get.responses["200"].headers["X-Request-Id"] = {
      required: false,
      schema: { type: "string" }
    };
  })
);

assertRejected(
  "rejects optional inline error request ID header",
  "Response must echo the canonical X-Request-Id header: getCustomerSession 401",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.components.responses.Unauthenticated.headers["X-Request-Id"] = {
      required: false,
      schema: { type: "string" }
    };
  })
);

assertRejected(
  "rejects case-variant duplicate response request ID header",
  "Response request ID header must be spelled X-Request-Id: getOperatorSession 200",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/operator/session"].get.responses["200"].headers["x-request-id"] = {
      required: false,
      schema: { type: "string" }
    };
  })
);

assertRejected(
  "rejects case-variant optional duplicate of a required request header",
  "x-request-id must use only the canonical #/components/parameters/RequestId parameter: getCustomerSession",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/customer/session"].get.parameters.push({
      name: "x-request-id",
      in: "header",
      required: false,
      schema: { type: "string" }
    });
  })
);

assertRejected(
  "rejects optional local parameter component for a required request header",
  "X-Device-Id must use only the canonical #/components/parameters/DeviceId parameter: getOperatorSession",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.components.parameters.LooseDeviceId = {
      ...structuredClone(openapi.components.parameters.DeviceId),
      required: false
    };
    openapi.paths["/api/v1/operator/session"].get.parameters.push({
      $ref: "#/components/parameters/LooseDeviceId"
    });
  })
);

assertRejected(
  "rejects optional path-level duplicate of a required request header",
  "Idempotency-Key must use only the canonical #/components/parameters/IdempotencyKey parameter: /api/v1/customer/capabilities",
  (scratch) => mutateOpenApi(scratch, (openapi) => {
    openapi.paths["/api/v1/customer/capabilities"].parameters = [{
      name: "Idempotency-Key",
      in: "header",
      required: false,
      schema: { type: "string" }
    }];
  })
);

test("accepts unrelated response headers, parameters and header descriptions", () => {
  const scratch = mkdtempSync(join(tmpdir(), "solidchange-contract-boundary-"));
  try {
    for (const path of contractFiles) {
      cpSync(join(root, path), join(scratch, path), { recursive: true });
    }
    mutateOpenApi(scratch, (openapi) => {
      openapi.components.headers.RequestId.description = "Echoed request identifier.";
      const operation = openapi.paths["/api/v1/customer/session"].get;
      operation.parameters.push({
        name: "Accept-Language",
        in: "header",
        required: false,
        schema: { type: "string", maxLength: 64 }
      });
      operation.responses["200"].headers["Cache-Control"] = {
        required: false,
        schema: { type: "string", maxLength: 128 }
      };
    });
    const result = spawnSync(process.execPath, [checker, scratch], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
});
