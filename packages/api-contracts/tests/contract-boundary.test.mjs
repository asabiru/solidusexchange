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
