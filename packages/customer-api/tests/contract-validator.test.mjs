import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_GAP_STATUSES,
  conformanceErrors,
  createValidator,
  loadContract
} from "./contract-validator.mjs";

const contract = loadContract();
const validator = createValidator(contract);
const schema = (name) => ({ $ref: `#/components/schemas/${name}` });
const requestId = "018f3f8a-6a36-7bd8-86e0-b59cd575d55a";
const metadata = {
  api_version: "v1",
  contract_version: "1.0.0-draft",
  runtime_boundary: "contract-only",
  financial_commands_enabled: false,
  production_providers_enabled: false
};

function response(status, body, headers = {}) {
  return {
    status,
    headers: Object.entries({
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId,
      ...headers
    }),
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

function errorEnvelope(code = "INTERNAL_ERROR") {
  return { code, message: "The request could not be completed.", request_id: requestId, details: {} };
}

test("accepts the canonical metadata document", () => {
  assert.deepEqual(validator.validate(schema("ApiMetadata"), metadata), []);
});

test("rejects metadata drift: extra, missing and non-const fields", () => {
  assert.notDeepEqual(validator.validate(schema("ApiMetadata"), { ...metadata, extra: true }), []);
  const { api_version: _removed, ...missing } = metadata;
  assert.notDeepEqual(validator.validate(schema("ApiMetadata"), missing), []);
  assert.notDeepEqual(
    validator.validate(schema("ApiMetadata"), { ...metadata, financial_commands_enabled: true }),
    []
  );
  assert.notDeepEqual(
    validator.validate(schema("ApiMetadata"), { ...metadata, runtime_boundary: "production" }),
    []
  );
});

test("validates SessionView types, enum, uniqueness and date-time", () => {
  const session = {
    subject: "syn_cust_00000001",
    actor_type: "customer",
    scopes: ["customer.session.read"],
    expires_at: "2026-10-01T12:15:00.000Z"
  };
  assert.deepEqual(validator.validate(schema("SessionView"), session), []);
  assert.notDeepEqual(validator.validate(schema("SessionView"), { ...session, actor_type: "admin" }), []);
  assert.notDeepEqual(validator.validate(schema("SessionView"), { ...session, scopes: ["a", "a"] }), []);
  assert.notDeepEqual(validator.validate(schema("SessionView"), { ...session, expires_at: "tomorrow" }), []);
  assert.notDeepEqual(validator.validate(schema("SessionView"), { ...session, subject: "" }), []);
  assert.notDeepEqual(validator.validate(schema("SessionView"), { ...session, subject: "x".repeat(129) }), []);
  assert.notDeepEqual(validator.validate(schema("SessionView"), [session]), []);
});

test("validates CapabilitiesView and pins commands_enabled to false", () => {
  const view = { capabilities: ["customer.session.read"], commands_enabled: false };
  assert.deepEqual(validator.validate(schema("CapabilitiesView"), view), []);
  assert.notDeepEqual(validator.validate(schema("CapabilitiesView"), { ...view, commands_enabled: true }), []);
  assert.notDeepEqual(validator.validate(schema("CapabilitiesView"), { ...view, reasons: [] }), []);
  assert.notDeepEqual(validator.validate(schema("CapabilitiesView"), { ...view, capabilities: [1] }), []);
});

test("resolves the external error envelope schema", () => {
  assert.deepEqual(validator.validate(schema("Error"), errorEnvelope()), []);
  assert.notDeepEqual(validator.validate(schema("Error"), { ...errorEnvelope(), code: "NOT_FOUND" }), []);
  assert.notDeepEqual(validator.validate(schema("Error"), { ...errorEnvelope(), stack: "x" }), []);
  assert.notDeepEqual(validator.validate(schema("Error"), { ...errorEnvelope(), request_id: "nope" }), []);
  assert.notDeepEqual(validator.validate(schema("Error"), { ...errorEnvelope(), message: "" }), []);
});

test("fails closed on unknown keywords, types, formats and references", () => {
  assert.throws(() => validator.validate({ oneOf: [] }, 1), /Unsupported schema keyword/u);
  assert.throws(() => validator.validate({ type: "decimal" }, 1), /Unsupported schema type/u);
  assert.throws(() => validator.validate({ type: "string", format: "email" }, "a"), /Unsupported schema format/u);
  assert.throws(() => validator.validate({ $ref: "#/components/schemas/Missing" }, 1), /Unresolvable/u);
  assert.throws(() => validator.validate({ $ref: "https://example.invalid/x.json" }, 1), /Unsupported reference/u);
});

test("UuidV7 pattern rejects other versions and uppercase", () => {
  assert.deepEqual(validator.validate(schema("UuidV7"), requestId), []);
  assert.notDeepEqual(validator.validate(schema("UuidV7"), requestId.toUpperCase()), []);
  assert.notDeepEqual(validator.validate(schema("UuidV7"), "018f3f8a-6a36-4bd8-86e0-b59cd575d55a"), []);
});

test("conformance accepts a declared response and rejects undeclared statuses", () => {
  const ok = response(200, metadata);
  assert.deepEqual(conformanceErrors(contract, validator, { method: "GET", path: "/api/v1/meta", response: ok }), []);
  const unauthorized = response(401, errorEnvelope("AUTHENTICATION_REQUIRED"));
  assert.match(
    conformanceErrors(contract, validator, { method: "GET", path: "/api/v1/meta", response: unauthorized }).join(),
    /undeclared status 401/u
  );
  assert.deepEqual(CONTRACT_GAP_STATUSES, [400, 404]);
});

test("conformance rejects missing headers, wrong media types and body drift", () => {
  const path = "/api/v1/meta";
  const check = (candidate) => conformanceErrors(contract, validator, { method: "GET", path, response: candidate });
  const noRequestId = response(200, metadata);
  noRequestId.headers = noRequestId.headers.filter(([name]) => name !== "x-request-id");
  assert.match(check(noRequestId).join(), /missing required header X-Request-Id/u);
  assert.match(check(response(200, metadata, { "content-type": "text/plain" })).join(), /content-type/u);
  assert.match(check(response(200, "not json")).join(), /not JSON/u);
  assert.match(check(response(200, { ...metadata, debug: 1 })).join(), /unexpected property debug/u);
  const duplicate = response(200, metadata);
  duplicate.headers.push(["X-Request-Id", requestId]);
  assert.match(check(duplicate).join(), /more than once/u);
});

test("conformance pins error request_id and empty details", () => {
  const path = "/api/v1/customer/session";
  const check = (candidate) => conformanceErrors(contract, validator, { method: "GET", path, response: candidate });
  assert.deepEqual(check(response(500, errorEnvelope())), []);
  assert.match(
    check(response(500, { ...errorEnvelope(), request_id: "018f3f8a-6a36-7bd8-86e0-b59cd575d55b" })).join(),
    /request_id/u
  );
  assert.match(check(response(500, { ...errorEnvelope(), details: { trace: "x" } })).join(), /details/u);
});

test("Retry-After is validated as a positive integer header", () => {
  const path = "/api/v1/customer/capabilities";
  const check = (value) =>
    conformanceErrors(contract, validator, {
      method: "GET",
      path,
      response: response(429, errorEnvelope("RATE_LIMITED"), { "retry-after": value })
    });
  assert.deepEqual(check("30"), []);
  assert.notDeepEqual(check("0"), []);
  assert.notDeepEqual(check("soon"), []);
});
