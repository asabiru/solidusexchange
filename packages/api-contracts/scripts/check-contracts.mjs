import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..")
);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function checkCompatibilityPolicy() {
  const policy = readFileSync(join(root, "COMPATIBILITY.md"), "utf8");
  for (const requirement of [
    "## Compatible changes",
    "## Breaking changes",
    "## Deprecation",
    "## Event evolution",
    "## Review gates"
  ]) {
    assert(policy.includes(requirement), `Compatibility policy is missing ${requirement}`);
  }
}

function resolvePointer(document, pointer, label) {
  if (pointer === "" || pointer === "#") return document;
  assert(pointer.startsWith("#/"), `${label}: unsupported JSON pointer ${pointer}`);
  return pointer.slice(2).split("/").reduce((value, segment) => {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    assert(value && Object.hasOwn(value, key), `${label}: missing JSON pointer ${pointer}`);
    return value[key];
  }, document);
}

const parsedFiles = new Map();

function loadAbsolute(path) {
  const normalized = resolve(path);
  assert(
    normalized === root || normalized.startsWith(`${root}${sep}`),
    `Reference escapes contract package: ${normalized}`
  );
  if (!parsedFiles.has(normalized)) {
    parsedFiles.set(normalized, JSON.parse(readFileSync(normalized, "utf8")));
  }
  return parsedFiles.get(normalized);
}

function resolveRef(sourcePath, reference) {
  const [filePart, fragment = ""] = reference.split("#", 2);
  const targetPath = filePart ? resolve(dirname(sourcePath), filePart) : sourcePath;
  const target = loadAbsolute(targetPath);
  return {
    document: target,
    path: targetPath,
    value: resolvePointer(target, fragment ? `#${fragment}` : "#", reference)
  };
}

function verifyReferences(value, sourcePath, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string") {
    assert(!value.$ref.startsWith("http"), `Remote $ref is prohibited: ${value.$ref}`);
    const key = `${sourcePath}:${value.$ref}`;
    if (!seen.has(key)) {
      seen.add(key);
      const resolved = resolveRef(sourcePath, value.$ref);
      verifyReferences(resolved.value, resolved.path, seen);
    }
  }
  for (const child of Object.values(value)) verifyReferences(child, sourcePath, seen);
}

function sameSet(left, right, label) {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  assert(
    JSON.stringify(leftSorted) === JSON.stringify(rightSorted),
    `${label}: ${JSON.stringify(leftSorted)} != ${JSON.stringify(rightSorted)}`
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const boundedString = { type: "string", minLength: 1, maxLength: 128 };
const protectedViewSchemas = {
  SessionView: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "actor_type", "scopes", "expires_at"],
    properties: {
      subject: boundedString,
      actor_type: { type: "string", enum: ["customer", "operator", "service"] },
      scopes: { type: "array", uniqueItems: true, items: boundedString },
      expires_at: { type: "string", format: "date-time" }
    }
  },
  CapabilitiesView: {
    type: "object",
    additionalProperties: false,
    required: ["capabilities", "commands_enabled"],
    properties: {
      capabilities: { type: "array", uniqueItems: true, items: boundedString },
      commands_enabled: { const: false }
    }
  }
};

function refs(operation) {
  return new Set(
    (operation.parameters ?? [])
      .map((parameter) => parameter.$ref)
      .filter(Boolean)
  );
}

const canonicalHeaderParameters = new Map([
  ["x-request-id", "#/components/parameters/RequestId"],
  ["x-client-version", "#/components/parameters/ClientVersion"],
  ["x-platform", "#/components/parameters/Platform"],
  ["x-device-id", "#/components/parameters/DeviceId"],
  ["idempotency-key", "#/components/parameters/IdempotencyKey"]
]);

function verifyCanonicalHeaderParameters(parameters, sourcePath, label) {
  for (const parameter of parameters ?? []) {
    const resolved = parameter?.$ref ? resolveRef(sourcePath, parameter.$ref).value : parameter;
    const canonical = canonicalHeaderParameters.get(String(resolved?.name ?? "").toLowerCase());
    if (!canonical) continue;
    assert(
      canonicalJson(parameter) === canonicalJson({ $ref: canonical }),
      `${resolved.name} must use only the canonical ${canonical} parameter: ${label}`
    );
  }
}

function verifyRequestIdResponseHeader(response, label) {
  const headers = response?.headers ?? {};
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== "x-request-id") continue;
    assert(name === "X-Request-Id", `Response request ID header must be spelled X-Request-Id: ${label}`);
  }
  assert(
    canonicalJson(headers["X-Request-Id"]) === canonicalJson({ $ref: "#/components/headers/RequestId" }),
    `Response must echo the canonical X-Request-Id header: ${label}`
  );
}

function checkOpenApi() {
  const path = join(root, "openapi.yaml");
  const openapi = loadAbsolute(path);
  assert(!Object.hasOwn(openapi, "webhooks"), "OpenAPI webhooks are prohibited in this slice");
  assert(openapi.openapi === "3.1.0", "OpenAPI version must be 3.1.0");
  assert(openapi.info?.version === "1.0.0-draft", "Contract version mismatch");
  assert(openapi["x-solidchange-runtime-boundary"] === "contract-only", "Runtime boundary must remain contract-only");
  assert(openapi["x-solidchange-financial-commands-enabled"] === false, "Financial commands must remain disabled");
  assert(openapi["x-solidchange-production-providers-enabled"] === false, "Production providers must remain disabled");
  sameSet(
    openapi["x-solidchange-planned-namespaces"]?.customer ?? [],
    [
      "/api/v1/customer/auth",
      "/api/v1/customer/cards",
      "/api/v1/customer/deposits",
      "/api/v1/customer/exchange-orders",
      "/api/v1/customer/kyc",
      "/api/v1/customer/notifications",
      "/api/v1/customer/payments",
      "/api/v1/customer/quotes",
      "/api/v1/customer/support",
      "/api/v1/customer/users",
      "/api/v1/customer/wallets",
      "/api/v1/customer/withdrawals"
    ],
    "Planned customer namespaces"
  );
  sameSet(
    openapi["x-solidchange-planned-namespaces"]?.operator ?? [],
    ["/api/v1/operator/admin"],
    "Planned operator namespaces"
  );

  const securitySchemes = openapi.components?.securitySchemes ?? {};
  for (const name of ["CustomerBearer", "OperatorBearer"]) {
    const scheme = securitySchemes[name];
    assert(scheme?.type === "http", `${name} must remain an HTTP security scheme`);
    assert(scheme.scheme === "bearer", `${name} must remain a bearer security scheme`);
    assert(
      scheme.bearerFormat === "OIDC access token",
      `${name} must remain an OIDC access-token scheme`
    );
  }

  const operationIds = new Set();
  const pinnedOperationPaths = new Map([
    ["getApiMetadata", "/api/v1/meta"],
    ["getCustomerSession", "/api/v1/customer/session"],
    ["getCustomerCapabilities", "/api/v1/customer/capabilities"],
    ["getOperatorSession", "/api/v1/operator/session"],
    ["getOperatorCapabilities", "/api/v1/operator/capabilities"]
  ]);
  const methodNames = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);
  const protectedSuccessSchemas = new Map([
    ["getCustomerSession", "#/components/schemas/SessionView"],
    ["getCustomerCapabilities", "#/components/schemas/CapabilitiesView"],
    ["getOperatorSession", "#/components/schemas/SessionView"],
    ["getOperatorCapabilities", "#/components/schemas/CapabilitiesView"]
  ]);
  for (const [pathName, pathItem] of Object.entries(openapi.paths ?? {})) {
    assert(pathName.startsWith("/api/v1/"), `Unversioned API path: ${pathName}`);
    assert(!Object.hasOwn(pathItem, "$ref"), `Path item $ref is prohibited: ${pathName}`);
    verifyCanonicalHeaderParameters(pathItem.parameters, path, pathName);
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methodNames.has(method)) continue;
      assert(method === "get", `Mutation method is prohibited in this slice: ${method.toUpperCase()} ${pathName}`);
      assert(operation.operationId, `Missing operationId: ${method.toUpperCase()} ${pathName}`);
      assert(!operationIds.has(operation.operationId), `Duplicate operationId: ${operation.operationId}`);
      operationIds.add(operation.operationId);
      assert(
        pinnedOperationPaths.get(operation.operationId) === pathName,
        `Operation path is not pinned: ${operation.operationId} ${pathName}`
      );

      assert(
        !Object.hasOwn(operation, "requestBody"),
        `Request bodies are prohibited in this slice: ${operation.operationId}`
      );
      assert(
        !Object.hasOwn(operation, "callbacks"),
        `Callbacks are prohibited in this slice: ${operation.operationId}`
      );
      verifyCanonicalHeaderParameters(operation.parameters, path, operation.operationId);
      const requestHeaders = refs(operation);
      assert(
        requestHeaders.has("#/components/parameters/RequestId"),
        `Missing X-Request-Id: ${operation.operationId}`
      );
      assert(
        !requestHeaders.has("#/components/parameters/IdempotencyKey"),
        `Read-only operation must not require Idempotency-Key: ${operation.operationId}`
      );
      if (pathName.startsWith("/api/v1/operator/")) {
        assert(
          requestHeaders.has("#/components/parameters/DeviceId"),
          `Missing X-Device-Id: ${operation.operationId}`
        );
      } else {
        assert(
          !requestHeaders.has("#/components/parameters/DeviceId"),
          `X-Device-Id is approved only for operator operations: ${operation.operationId}`
        );
      }
      if (pathName !== "/api/v1/meta") {
        const expectedScheme = pathName.startsWith("/api/v1/customer/")
          ? "CustomerBearer"
          : "OperatorBearer";
        assert(
          Array.isArray(operation.security) && operation.security.length === 1,
          `Security must contain exactly one ${expectedScheme} requirement: ${operation.operationId}`
        );
        const securityRequirement = operation.security[0];
        sameSet(
          Object.keys(securityRequirement),
          [expectedScheme],
          `Security schemes for ${operation.operationId}`
        );
        assert(
          Array.isArray(securityRequirement[expectedScheme])
            && securityRequirement[expectedScheme].length === 0,
          `Bearer security scopes must be empty: ${operation.operationId}`
        );
        assert(
          requestHeaders.has("#/components/parameters/ClientVersion"),
          `Missing X-Client-Version: ${operation.operationId}`
        );
        assert(
          requestHeaders.has("#/components/parameters/Platform"),
          `Missing X-Platform: ${operation.operationId}`
        );
      }

      const success = operation.responses?.["200"];
      verifyRequestIdResponseHeader(success, `${operation.operationId} 200`);
      if (pathName !== "/api/v1/meta") {
        const expectedSchema = protectedSuccessSchemas.get(operation.operationId);
        assert(expectedSchema, `Protected success schema is not pinned: ${operation.operationId}`);
        sameSet(
          Object.keys(operation.responses ?? {}).filter((status) => status.startsWith("2")),
          ["200"],
          `Success response statuses for ${operation.operationId}`
        );
        sameSet(
          Object.keys(success.content ?? {}),
          ["application/json"],
          `Success response media types for ${operation.operationId} 200`
        );
        assert(
          success.content?.["application/json"]?.schema?.$ref === expectedSchema,
          `Success response must use canonical schema: ${operation.operationId} 200`
        );
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (status.startsWith("2")) continue;
        const resolvedResponse = response.$ref
          ? resolveRef(path, response.$ref).value
          : response;
        if (pathName !== "/api/v1/meta") {
          sameSet(
            Object.keys(resolvedResponse.content ?? {}),
            ["application/json"],
            `Error response media types for ${operation.operationId} ${status}`
          );
        }
        assert(
          resolvedResponse.content?.["application/json"]?.schema?.$ref
            === "#/components/schemas/Error",
          `Error response must use canonical Error schema: ${operation.operationId} ${status}`
        );
        verifyRequestIdResponseHeader(resolvedResponse, `${operation.operationId} ${status}`);
      }
    }
  }
  sameSet(operationIds, pinnedOperationPaths.keys(), "Pinned API operations");
  for (const name of ["pathItems", "callbacks", "requestBodies"]) {
    assert(
      !Object.hasOwn(openapi.components ?? {}, name),
      `OpenAPI components.${name} are prohibited in this slice`
    );
  }

  const parameters = openapi.components?.parameters ?? {};
  const parameterNames = {
    RequestId: "X-Request-Id",
    ClientVersion: "X-Client-Version",
    Platform: "X-Platform",
    DeviceId: "X-Device-Id",
    IdempotencyKey: "Idempotency-Key"
  };
  for (const [name, headerName] of Object.entries(parameterNames)) {
    assert(parameters[name]?.required === true, `${name} must be required when used`);
    assert(parameters[name]?.in === "header", `${name} must remain a header parameter`);
    assert(parameters[name]?.name === headerName, `${name} must use ${headerName}`);
  }
  const clientVersionSchema = parameters.ClientVersion?.schema;
  assert(
    clientVersionSchema?.type === "string"
      && clientVersionSchema.minLength === 1
      && clientVersionSchema.maxLength === 64,
    "Canonical ClientVersion constraints must remain pinned"
  );
  const platformSchema = parameters.Platform?.schema;
  assert(
    platformSchema?.type === "string",
    "Canonical Platform type must remain pinned"
  );
  sameSet(
    platformSchema.enum ?? [],
    ["web", "ios", "android", "telegram-mini-app", "operator-web", "service"],
    "Canonical Platform enum"
  );
  assert(
    parameters.DeviceId?.schema?.$ref === "#/components/schemas/DeviceId",
    "DeviceId must use canonical DeviceId schema"
  );
  const deviceIdSchema = openapi.components?.schemas?.DeviceId;
  assert(
    canonicalJson(deviceIdSchema) === canonicalJson({
      type: "string",
      format: "uuid",
      pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    }),
    "Canonical DeviceId constraints must remain pinned"
  );
  assert(
    parameters.RequestId?.schema?.$ref === "#/components/schemas/UuidV7",
    "RequestId must use canonical UuidV7 schema"
  );
  const uuidV7Schema = openapi.components?.schemas?.UuidV7;
  assert(
    uuidV7Schema?.type === "string"
      && uuidV7Schema.format === "uuid"
      && uuidV7Schema.pattern === "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    "Canonical UuidV7 constraints must remain pinned"
  );
  assert(
    parameters.IdempotencyKey?.schema?.$ref === "#/components/schemas/IdempotencyKey",
    "IdempotencyKey must use canonical IdempotencyKey schema"
  );
  const idempotencyKeySchema = openapi.components?.schemas?.IdempotencyKey;
  assert(
    idempotencyKeySchema?.type === "string"
      && idempotencyKeySchema.minLength === 16
      && idempotencyKeySchema.maxLength === 128
      && idempotencyKeySchema.pattern === "^[A-Za-z0-9._:-]+$",
    "Canonical IdempotencyKey constraints must remain pinned"
  );
  for (const [name, expected] of Object.entries(protectedViewSchemas)) {
    assert(
      canonicalJson(openapi.components?.schemas?.[name]) === canonicalJson(expected),
      `Canonical ${name} schema must remain pinned`
    );
  }
  assert(openapi.components?.schemas?.Error?.$ref === "./schemas/error.schema.json", "Canonical error schema is not referenced");
  for (const [name, response] of Object.entries(openapi.components?.responses ?? {})) {
    verifyRequestIdResponseHeader(response, `${name} response`);
  }
  const { description: _requestIdDescription, ...requestIdHeader } = openapi.components?.headers?.RequestId ?? {};
  assert(
    canonicalJson(requestIdHeader) === canonicalJson({
      required: true,
      schema: { $ref: "#/components/schemas/UuidV7" }
    }),
    "Canonical RequestId response header must remain required with the UuidV7 schema"
  );
  verifyReferences(openapi, path);
}

function checkErrorSchema() {
  const schema = readJson("schemas/error.schema.json");
  sameSet(
    schema.required,
    ["code", "message", "request_id", "details"],
    "Error envelope required fields"
  );
  assert(schema.additionalProperties === false, "Error envelope must reject unknown top-level fields");
  assert(schema.properties?.code?.enum?.length >= 1, "Error codes must be an explicit stable enum");
}

function payloadSchemas(eventSchema) {
  const result = new Map();
  for (const condition of eventSchema.allOf ?? []) {
    const name = condition.if?.properties?.event_type?.const;
    const payloadRef = condition.then?.properties?.payload?.$ref;
    const aggregateType = condition.then?.properties?.aggregate_type?.const;
    assert(name && payloadRef && aggregateType, "Every event condition must bind type, aggregate and payload");
    assert(!result.has(name), `Duplicate event condition: ${name}`);
    result.set(name, { aggregateType, payloadRef });
  }
  return result;
}

function schemaTypeMatches(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

function validateValue(value, schema, rootSchema, label) {
  if (schema.$ref) {
    assert(schema.$ref.startsWith("#/"), `${label}: example validator only supports local refs`);
    return validateValue(value, resolvePointer(rootSchema, schema.$ref, label), rootSchema, label);
  }
  if (schema.anyOf) {
    const accepted = schema.anyOf.some((candidate) => {
      try {
        validateValue(value, candidate, rootSchema, label);
        return true;
      } catch {
        return false;
      }
    });
    assert(accepted, `${label}: value does not match any allowed schema`);
    return;
  }
  if (schema.const !== undefined) assert(value === schema.const, `${label}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum) assert(schema.enum.includes(value), `${label}: value is outside enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert(types.some((type) => schemaTypeMatches(value, type)), `${label}: type mismatch`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined) assert(value.length >= schema.minLength, `${label}: string is too short`);
    if (schema.maxLength !== undefined) assert(value.length <= schema.maxLength, `${label}: string is too long`);
    if (schema.pattern) assert(new RegExp(schema.pattern).test(value), `${label}: pattern mismatch`);
    if (schema.format === "uuid") {
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), `${label}: invalid UUID`);
    }
    if (schema.format === "date-time") {
      assert(Number.isFinite(Date.parse(value)), `${label}: invalid date-time`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined) assert(value >= schema.minimum, `${label}: below minimum`);
    if (schema.maximum !== undefined) assert(value <= schema.maximum, `${label}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert(value.length >= schema.minItems, `${label}: too few items`);
    if (schema.uniqueItems) {
      assert(new Set(value.map((item) => JSON.stringify(item))).size === value.length, `${label}: duplicate items`);
    }
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, rootSchema, `${label}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    for (const required of schema.required ?? []) {
      assert(Object.hasOwn(value, required), `${label}: missing ${required}`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) assert(allowed.has(key), `${label}: unknown field ${key}`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) validateValue(child, childSchema, rootSchema, `${label}.${key}`);
    }
  }
}

const prohibitedFields = new Set([
  "access_token",
  "api_key",
  "credential",
  "document_image",
  "document_number",
  "email",
  "mfa_seed",
  "mnemonic",
  "password",
  "phone",
  "private_key",
  "provider_payload",
  "raw_transaction",
  "raw_provider_payload",
  "secret",
  "seed",
  "signature",
  "signed_transaction",
  "wallet_address"
]);

function verifySafeFields(value, label) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!prohibitedFields.has(key.toLowerCase()), `${label}: prohibited field ${key}`);
    verifySafeFields(child, `${label}.${key}`);
  }
}

function verifyAmountSchemas(eventSchema) {
  for (const [definitionName, definition] of Object.entries(eventSchema.$defs ?? {})) {
    for (const [propertyName, property] of Object.entries(definition.properties ?? {})) {
      if (!propertyName.endsWith("amount") && propertyName !== "amount") continue;
      assert(
        property.$ref === "#/$defs/decimalAmount",
        `${definitionName}.${propertyName} must use decimalAmount`
      );
    }
  }
}

const pinnedEventEnvelopeRequired = [
  "event_id",
  "event_type",
  "event_version",
  "occurred_at",
  "producer",
  "aggregate_type",
  "aggregate_id",
  "correlation_id",
  "causation_id",
  "idempotency_key",
  "actor",
  "data_classification",
  "payload"
];

const pinnedEventEnvelopeProperties = {
  event_id: { type: "string", format: "uuid" },
  event_version: { const: 1 },
  aggregate_id: { $ref: "#/$defs/identifier" },
  correlation_id: { type: "string", format: "uuid" },
  causation_id: { type: ["string", "null"], format: "uuid" },
  idempotency_key: { type: ["string", "null"], minLength: 16, maxLength: 128 },
  actor: { $ref: "#/$defs/actor" }
};

const pinnedEventEnvelopeDefinitions = {
  identifier: { type: "string", pattern: "^[a-z][a-z0-9_-]{2,127}$" },
  actor: {
    type: "object",
    additionalProperties: false,
    required: ["type", "subject"],
    properties: {
      type: { type: "string", enum: ["customer", "operator", "service", "provider"] },
      subject: { $ref: "#/$defs/identifier" }
    }
  }
};

function verifyEventEnvelope(eventSchema) {
  assert(
    eventSchema.type === "object" && eventSchema.additionalProperties === false,
    "Event envelope must reject unknown top-level fields"
  );
  assert(Array.isArray(eventSchema.required), "Event envelope required fields must be explicit");
  sameSet(eventSchema.required, pinnedEventEnvelopeRequired, "Event envelope required fields");
  for (const [name, expected] of Object.entries(pinnedEventEnvelopeProperties)) {
    assert(
      canonicalJson(eventSchema.properties?.[name]) === canonicalJson(expected),
      `Canonical event ${name} schema must remain pinned`
    );
  }
  for (const [name, expected] of Object.entries(pinnedEventEnvelopeDefinitions)) {
    assert(
      canonicalJson(eventSchema.$defs?.[name]) === canonicalJson(expected),
      `Canonical event ${name} definition must remain pinned`
    );
  }
}

const pinnedEventContracts = {
  UserRegistered: {
    version: 1,
    aggregateType: "user",
    owner: "identity",
    dataClassification: "confidential",
    payload: "userRegistered",
    required: ["user_id", "registration_channel"]
  },
  KycSubmitted: {
    version: 1,
    aggregateType: "kyc_case",
    owner: "customer-risk",
    dataClassification: "highly-confidential",
    payload: "kycSubmitted",
    required: ["case_id", "user_id", "provider_reference", "evidence_digest"]
  },
  KycVerified: {
    version: 1,
    aggregateType: "kyc_case",
    owner: "customer-risk",
    dataClassification: "highly-confidential",
    payload: "kycVerified",
    required: ["case_id", "user_id", "decision", "policy_version", "evidence_digest"]
  },
  WalletAddressAssigned: {
    version: 1,
    aggregateType: "wallet",
    owner: "custody-orchestrator",
    dataClassification: "highly-confidential",
    payload: "walletAddressAssigned",
    required: ["wallet_id", "user_id", "asset", "network", "address_reference", "custody_account_id"]
  },
  DepositDetected: {
    version: 1,
    aggregateType: "deposit",
    owner: "deposit-orchestrator",
    dataClassification: "confidential",
    payload: "depositDetected",
    required: ["deposit_id", "wallet_id", "asset", "network", "amount", "transaction_reference", "observed_at"]
  },
  DepositConfirmed: {
    version: 1,
    aggregateType: "deposit",
    owner: "deposit-orchestrator",
    dataClassification: "confidential",
    payload: "depositConfirmed",
    required: ["deposit_id", "confirmations", "confirmed_at"]
  },
  QuoteCreated: {
    version: 1,
    aggregateType: "quote",
    owner: "pricing",
    dataClassification: "confidential",
    payload: "quoteCreated",
    required: ["quote_id", "user_id", "from_asset", "to_asset", "from_amount", "to_amount", "fee_amount", "pricing_source", "expires_at"]
  },
  ExchangeOrderCreated: {
    version: 1,
    aggregateType: "exchange_order",
    owner: "exchange",
    dataClassification: "confidential",
    payload: "exchangeOrderCreated",
    required: ["order_id", "quote_id", "user_id", "status"]
  },
  ExchangeSettled: {
    version: 1,
    aggregateType: "exchange_order",
    owner: "settlement",
    dataClassification: "confidential",
    payload: "exchangeSettled",
    required: ["order_id", "journal_id", "settled_at"]
  },
  WithdrawalRequested: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "withdrawals",
    dataClassification: "highly-confidential",
    payload: "withdrawalRequested",
    required: ["withdrawal_id", "user_id", "asset", "network", "amount", "destination_reference"]
  },
  WithdrawalHeld: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "withdrawals",
    dataClassification: "highly-confidential",
    payload: "withdrawalHeld",
    required: ["withdrawal_id", "hold_id", "reason_code"]
  },
  WithdrawalApproved: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "approvals",
    dataClassification: "highly-confidential",
    payload: "withdrawalApproved",
    required: ["withdrawal_id", "approval_id", "approver_count", "evidence_digest"]
  },
  CustodyIntentPrepared: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "custody-orchestrator",
    dataClassification: "highly-confidential",
    payload: "custodyIntentPrepared",
    required: ["withdrawal_id", "custody_intent_id", "intent_digest", "policy_digest", "approval_evidence_digest", "asset", "network", "expires_at", "status", "execution_authority", "production_signing_enabled"]
  },
  WithdrawalBroadcast: {
    version: 1,
    aggregateType: "withdrawal",
    owner: "custody-orchestrator",
    dataClassification: "highly-confidential",
    payload: "withdrawalBroadcast",
    required: ["withdrawal_id", "transaction_reference", "broadcast_at"]
  },
  PaymentConfirmed: {
    version: 1,
    aggregateType: "payment",
    owner: "payments",
    dataClassification: "confidential",
    payload: "paymentConfirmed",
    required: ["payment_id", "provider_reference", "amount", "currency", "confirmed_at"]
  },
  PaymentRefunded: {
    version: 1,
    aggregateType: "payment",
    owner: "payments",
    dataClassification: "confidential",
    payload: "paymentRefunded",
    required: ["payment_id", "refund_id", "amount", "currency", "journal_id", "refunded_at"]
  },
  AmlAlertCreated: {
    version: 1,
    aggregateType: "aml_alert",
    owner: "aml",
    dataClassification: "highly-confidential",
    payload: "amlAlertCreated",
    required: ["alert_id", "user_id", "risk_score", "rule_codes"]
  }
};

const allowedPayloadSchemaKeys = ["type", "additionalProperties", "required", "properties"];

const pinnedEventCatalogKeys = ["catalog_version", "compatibility_policy", "execution_authority", "events"];

const pinnedEventCatalogEntryKeys = ["name", "current_version", "aggregate_type", "owner", "data_classification"];

function verifyEventCatalogShape(catalog) {
  sameSet(Object.keys(catalog), pinnedEventCatalogKeys, "Event catalog keys");
  assert(catalog.catalog_version === 1, "Event catalog version must remain 1");
  assert(
    catalog.compatibility_policy === "additive-with-versioned-breaking-changes",
    "Event catalog compatibility policy must remain pinned"
  );
  assert(Array.isArray(catalog.events), "Event catalog events must be an array");
  for (const entry of catalog.events) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), "Event catalog entries must be objects");
    sameSet(Object.keys(entry), pinnedEventCatalogEntryKeys, `Event catalog entry ${entry.name} keys`);
  }
}

function verifyPinnedEvents(eventSchema, conditions, catalog) {
  const eventTypes = eventSchema.properties?.event_type?.enum ?? [];
  assert(new Set(eventTypes).size === eventTypes.length, "Event schema contains duplicate event types");
  sameSet(eventTypes, Object.keys(pinnedEventContracts), "Pinned event types");
  for (const [name, pinned] of Object.entries(pinnedEventContracts)) {
    const condition = conditions.get(name);
    const catalogEntry = catalog.events.find((entry) => entry.name === name);
    assert(catalogEntry?.current_version === pinned.version, `${name}: event version must remain pinned`);
    assert(
      condition?.aggregateType === pinned.aggregateType && catalogEntry.aggregate_type === pinned.aggregateType,
      `${name}: aggregate type must remain pinned`
    );
    assert(catalogEntry.owner === pinned.owner, `${name}: owner must remain pinned`);
    assert(
      catalogEntry.data_classification === pinned.dataClassification,
      `${name}: data classification must remain pinned`
    );
    assert(condition.payloadRef === `#/$defs/${pinned.payload}`, `${name}: payload schema must remain pinned`);
    const payload = eventSchema.$defs?.[pinned.payload];
    assert(payload && typeof payload === "object", `${name}: payload schema is missing`);
    sameSet(Object.keys(payload), allowedPayloadSchemaKeys, `${name} payload schema keywords`);
    assert(
      payload.type === "object" && payload.additionalProperties === false,
      `${name} payload must reject unknown fields`
    );
    assert(Array.isArray(payload.required), `${name} payload required fields must be explicit`);
    sameSet(payload.required, pinned.required, `${name} payload required fields`);
    for (const field of payload.required) {
      assert(Object.hasOwn(payload.properties ?? {}, field), `${name} payload required field ${field} is undefined`);
    }
  }
}

function checkEvents() {
  const schemaPath = join(root, "schemas/events/domain-event.schema.json");
  const eventSchema = loadAbsolute(schemaPath);
  verifyEventEnvelope(eventSchema);
  const catalog = readJson("event-catalog.json");
  const examples = readJson("examples/domain-events.json");
  const schemaEvents = new Set(eventSchema.properties?.event_type?.enum ?? []);
  const conditions = payloadSchemas(eventSchema);
  const catalogEvents = new Set(catalog.events.map((event) => event.name));
  const exampleEvents = new Set(examples.map((event) => event.event_type));

  sameSet(schemaEvents, conditions.keys(), "Event schema conditions");
  sameSet(schemaEvents, catalogEvents, "Event catalog");
  sameSet(schemaEvents, exampleEvents, "Event examples");
  verifyEventCatalogShape(catalog);
  verifyPinnedEvents(eventSchema, conditions, catalog);
  assert(catalog.events.length === schemaEvents.size, "Event catalog contains duplicates");
  assert(examples.length === schemaEvents.size, "Event examples must contain exactly one sample per event");
  assert(catalog.execution_authority === false, "Events must not grant execution authority");
  assert(catalog.events.every((event) => event.current_version === 1), "Current event version must be 1");
  assert(new Set(examples.map((event) => event.event_id)).size === examples.length, "Event example IDs must be unique");

  for (const event of examples) {
    validateValue(event, eventSchema, eventSchema, event.event_type);
    const catalogEntry = catalog.events.find((entry) => entry.name === event.event_type);
    const condition = conditions.get(event.event_type);
    assert(event.aggregate_type === catalogEntry.aggregate_type, `${event.event_type}: catalog aggregate mismatch`);
    assert(event.aggregate_type === condition.aggregateType, `${event.event_type}: schema aggregate mismatch`);
    assert(
      event.data_classification === catalogEntry.data_classification,
      `${event.event_type}: classification mismatch`
    );
    validateValue(
      event.payload,
      resolvePointer(eventSchema, condition.payloadRef, event.event_type),
      eventSchema,
      `${event.event_type}.payload`
    );
  }

  const withdrawalApproved = examples.find((event) => event.event_type === "WithdrawalApproved");
  const custodyIntent = examples.find((event) => event.event_type === "CustodyIntentPrepared");
  const withdrawalBroadcast = examples.find((event) => event.event_type === "WithdrawalBroadcast");
  const custodyCatalog = catalog.events.find((event) => event.name === "CustodyIntentPrepared");
  const custodySchema = eventSchema.$defs.custodyIntentPrepared;

  assert(custodyCatalog.owner === "custody-orchestrator", "Custody intent owner must remain custody-orchestrator");
  assert(
    custodyCatalog.data_classification === "highly-confidential",
    "Custody intent classification must remain highly-confidential"
  );
  assert(
    custodySchema.properties.execution_authority.const === false,
    "Custody intent schema must prohibit execution authority"
  );
  assert(
    custodySchema.properties.production_signing_enabled.const === false,
    "Custody intent schema must prohibit production signing"
  );
  assert(
    custodySchema.properties.status.const === "unsigned_intent_ready",
    "Custody intent schema must remain unsigned"
  );
  assert(
    custodySchema.properties.network.pattern === "^[A-Z0-9]+_TESTNET$",
    "Custody intent schema must remain testnet-only"
  );
  assert(custodyIntent.actor.type === "service", "Custody intent must be produced by a service actor");
  assert(custodyIntent.payload.network.endsWith("_TESTNET"), "Custody intent must remain testnet-only");
  assert(custodyIntent.payload.execution_authority === false, "Custody intent must not grant execution authority");
  assert(
    custodyIntent.payload.production_signing_enabled === false,
    "Custody intent must not enable production signing"
  );
  assert(
    custodyIntent.payload.status === "unsigned_intent_ready",
    "Custody intent must remain unsigned"
  );
  assert(
    custodyIntent.causation_id === withdrawalApproved.event_id,
    "Custody intent must be caused by withdrawal approval evidence"
  );
  assert(
    withdrawalBroadcast.causation_id === custodyIntent.event_id,
    "Withdrawal broadcast example must follow the prepared custody intent"
  );
  assert(
    custodyIntent.aggregate_id === withdrawalApproved.aggregate_id
      && custodyIntent.aggregate_id === withdrawalBroadcast.aggregate_id,
    "Custody intent must preserve the withdrawal aggregate"
  );
  assert(
    custodyIntent.correlation_id === withdrawalApproved.correlation_id
      && custodyIntent.correlation_id === withdrawalBroadcast.correlation_id,
    "Custody intent must preserve withdrawal correlation"
  );
  assert(
    Date.parse(custodyIntent.payload.expires_at) > Date.parse(custodyIntent.occurred_at),
    "Custody intent expiry must follow preparation time"
  );

  verifyReferences(eventSchema, schemaPath);
  verifyAmountSchemas(eventSchema);
  verifySafeFields(eventSchema, "event schema");
  verifySafeFields(examples, "event examples");
}

checkOpenApi();
checkErrorSchema();
checkEvents();
checkCompatibilityPolicy();

console.log("API and event contracts are structurally consistent and remain contract-only.");
