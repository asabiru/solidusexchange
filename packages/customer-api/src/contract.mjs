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
  }),
  Object.freeze({
    operationId: "getCustomerWallets",
    method: "GET",
    path: "/api/v1/customer/wallets",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
  }),
  Object.freeze({
    operationId: "getCustomerNotifications",
    method: "GET",
    path: "/api/v1/customer/notifications",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
  }),
  // The KYC status read is served to every authenticated customer, so it
  // declares no 403: unlike the wallets/notifications reads it is not gated
  // on a verified KYC status (see capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerKyc",
    method: "GET",
    path: "/api/v1/customer/kyc",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 429, 500])
  }),
  // The profile read is served to every authenticated customer like the KYC
  // status read, so it declares no 403: it carries the subject's own
  // synthetic identity surface (display name, locale, registration date —
  // never real PII) and the miniapp serves /bff/profile to kyc-gated
  // sessions too (see capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerProfile",
    method: "GET",
    path: "/api/v1/customer/profile",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 429, 500])
  }),
  // The support tickets read is served to every authenticated customer like
  // the KYC status and profile reads, so it declares no 403: tickets are the
  // subject's own service-requests surface and the miniapp serves
  // /bff/support/requests to kyc-gated sessions too (see capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerSupport",
    method: "GET",
    path: "/api/v1/customer/support",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 429, 500])
  }),
  // The deposits collection read is KYC-gated like the wallets and
  // notifications reads, so it declares a 403: deposits are an
  // asset/activity collection, not an onboarding or identity surface (see
  // capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerDeposits",
    method: "GET",
    path: "/api/v1/customer/deposits",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
  }),
  // The withdrawals collection read is KYC-gated like the deposits,
  // wallets and notifications reads, so it declares a 403: withdrawals are
  // an asset/activity collection, not an onboarding or identity surface
  // (see capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerWithdrawals",
    method: "GET",
    path: "/api/v1/customer/withdrawals",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
  }),
  // The quotes collection read is KYC-gated like the deposits, withdrawals,
  // wallets and notifications reads, so it declares a 403: quotes are an
  // asset/activity collection (indicative prices the subject was shown), not
  // an onboarding or identity surface (see capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerQuotes",
    method: "GET",
    path: "/api/v1/customer/quotes",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
  }),
  // The exchange-orders collection read is KYC-gated like the deposits,
  // withdrawals, wallets, notifications and quotes reads, so it declares a
  // 403: exchange orders are an asset/activity collection (the order records
  // a subject placed), not an onboarding or identity surface (see
  // capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerExchangeOrders",
    method: "GET",
    path: "/api/v1/customer/exchange-orders",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
  }),
  // The payments collection read is KYC-gated like the deposits, withdrawals,
  // wallets, notifications, quotes and exchange-orders reads, so it declares
  // a 403: payments are an asset/activity collection (the outbound fiat
  // payment instructions a subject issued), not an onboarding or identity
  // surface (see capabilities.mjs).
  Object.freeze({
    operationId: "getCustomerPayments",
    method: "GET",
    path: "/api/v1/customer/payments",
    authenticated: true,
    requiredHeaders: Object.freeze([
      "authorization",
      "x-request-id",
      "x-client-version",
      "x-platform"
    ]),
    statuses: Object.freeze([200, 401, 403, 429, 500])
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
