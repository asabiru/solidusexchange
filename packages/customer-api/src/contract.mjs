// Runtime view of packages/api-contracts/openapi.yaml for the operations this
// service serves. tests/contract-conformance.test.mjs pins it to the contract.

export const API_METADATA = Object.freeze({
  api_version: "v1",
  contract_version: "1.0.0-draft",
  runtime_boundary: "contract-only",
  financial_commands_enabled: false,
  production_providers_enabled: false
});

/** @type {readonly string[]} */
export const PLATFORMS = Object.freeze([
  "web",
  "ios",
  "android",
  "telegram-mini-app",
  "operator-web",
  "service"
]);

export const CLIENT_VERSION_MAX_LENGTH = 64;

export const OPERATIONS = Object.freeze([
  Object.freeze({
    operationId: "getApiMetadata",
    method: "GET",
    path: "/api/v1/meta",
    authenticated: false,
    requiredHeaders: Object.freeze(["x-request-id"]),
    statuses: Object.freeze([200, 500])
  }),
  Object.freeze({
    operationId: "getCustomerSession",
    method: "GET",
    path: "/api/v1/customer/session",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 429, 500])
  }),
  Object.freeze({
    operationId: "getCustomerCapabilities",
    method: "GET",
    path: "/api/v1/customer/capabilities",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 429, 500])
  })
]);

// The contract declares no 400/404 responses and no NOT_FOUND error code.
// These statuses still use the contract error envelope; see README.
export const CONTRACT_GAP_STATUSES = Object.freeze([400, 404]);

export const ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_REQUIRED: "Authentication is required or expired.",
  CAPABILITY_DENIED: "The requested operation is not available.",
  INTERNAL_ERROR: "The request could not be completed.",
  RATE_LIMITED: "Too many requests. Retry later.",
  VALIDATION_FAILED: "The request is invalid."
});
