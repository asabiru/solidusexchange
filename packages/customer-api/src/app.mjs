import { createServer, STATUS_CODES } from "node:http";

import { parseBearerAuthorization } from "./auth.mjs";
import { evaluateCapabilities } from "./capabilities.mjs";
import {
  API_METADATA,
  CLIENT_VERSION_MAX_LENGTH,
  ERROR_MESSAGES,
  OPERATIONS,
  PLATFORMS
} from "./contract.mjs";
import { validDepositsView } from "./deposits.mjs";
import { validKycStatusView } from "./kyc.mjs";
import {
  createRequestObserver,
  METRICS_CONTENT_TYPE,
  METRICS_PATH,
  metricsRequestAllowed
} from "./observability.mjs";
import { validNotificationsView } from "./notifications.mjs";
import { validProfileView } from "./profile.mjs";
import { validQuotesView } from "./quotes.mjs";
import { generateUuidV7, isUuidV7 } from "./request-id.mjs";
import { validSupportTicketsView } from "./support.mjs";
import { validWalletsView } from "./wallets.mjs";
import { validWithdrawalsView } from "./withdrawals.mjs";

/** @typedef {import("node:http").IncomingMessage} IncomingMessage */
/** @typedef {import("node:http").ServerResponse} ServerResponse */
/** @typedef {Map<string, string[]>} Headers */
/** @typedef {keyof typeof ERROR_MESSAGES} ErrorCode */
/** @typedef {(typeof OPERATIONS)[number]} Operation */
/** @typedef {import("./observability.mjs").RequestObserver} RequestObserver */

/**
 * @typedef {object} HandlerOptions
 * @property {Readonly<Record<string, unknown>>} [metadata]
 * @property {import("./auth.mjs").TokenVerifier} verifier
 * @property {import("./capabilities.mjs").KycDirectory} kycDirectory
 * @property {import("./rate-limit.mjs").RateLimiter} rateLimiter
 * @property {import("./wallets.mjs").WalletDirectory} walletDirectory
 * @property {import("./notifications.mjs").NotificationDirectory} notificationDirectory
 * @property {import("./kyc.mjs").KycApplicationDirectory} kycApplicationDirectory
 * @property {import("./profile.mjs").ProfileDirectory} profileDirectory
 * @property {import("./support.mjs").SupportDirectory} supportDirectory
 * @property {import("./deposits.mjs").DepositDirectory} depositDirectory
 * @property {import("./withdrawals.mjs").WithdrawalDirectory} withdrawalDirectory
 * @property {import("./quotes.mjs").QuoteDirectory} quoteDirectory
 * @property {() => number} [clock]
 * @property {() => string} [generateRequestId]
 * @property {RequestObserver} [observer]
 */

/**
 * @typedef {Omit<HandlerOptions, "observer"> & {
 *   observability?: import("./observability.mjs").ObservabilityConfig,
 *   logSink?: (line: string) => void,
 *   timer?: () => number
 * }} ServerOptions
 */

export const PERMISSIONS_POLICY = [
  "accelerometer",
  "bluetooth",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "hid",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "serial",
  "usb",
  "xr-spatial-tracking"
]
  .map((feature) => `${feature}=()`)
  .join(", ");
export const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": PERMISSIONS_POLICY,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});
const BASE_HEADERS = Object.freeze({
  ...SECURITY_HEADERS,
  "content-type": "application/json; charset=utf-8"
});
const SCOPE_PATTERN = /^[a-z][a-z0-9.:-]{0,127}$/u;
// Every peer of this loopback-only server is local, and a local client can pick
// any 127.0.0.0/8 source address, so the whole range shares one bucket.
const IPV4_LOOPBACK_PATTERN = /^(?:::ffff:)?127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/iu;

/** @param {string | undefined} address */
function rateLimitKey(address) {
  if (typeof address !== "string") {
    return "unknown";
  }
  return IPV4_LOOPBACK_PATTERN.test(address) ? "127.0.0.0/8" : address;
}

/**
 * @param {readonly string[]} rawHeaders
 * @returns {Headers}
 */
function collectHeaders(rawHeaders) {
  /** @type {Headers} */
  const headers = new Map();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    const values = headers.get(name) ?? [];
    values.push(rawHeaders[index + 1]);
    headers.set(name, values);
  }
  return headers;
}

/**
 * @param {Headers} headers
 * @param {string} name
 */
function singleHeader(headers, name) {
  const values = headers.get(name);
  return values?.length === 1 ? values[0] : null;
}

/**
 * @param {ErrorCode} code
 * @param {string} requestId
 * @param {string} [message]
 */
function errorBody(code, requestId, message = ERROR_MESSAGES[code]) {
  return { code, message, request_id: requestId, details: {} };
}

/**
 * @param {number} status
 * @param {Record<string, string | number>} headers
 */
function renderHead(status, headers) {
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status]}`];
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`${name}: ${value}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

const closingSockets = new WeakSet();

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 * @param {string} requestId
 * @param {Record<string, string>} [extraHeaders]
 */
function send(response, status, payload, requestId, extraHeaders = {}) {
  if (extraHeaders.connection === "close" && response.socket) {
    closingSockets.add(response.socket);
  }
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...BASE_HEADERS,
    ...extraHeaders,
    "content-length": Buffer.byteLength(body),
    "x-request-id": requestId
  });
  response.end(body);
}

/**
 * @param {import("./auth.mjs").Principal} principal
 * @param {number} now
 */
function validPrincipal(principal, now) {
  if (principal === null || typeof principal !== "object") {
    return false;
  }
  const { subject, actorType, scopes, expiresAt } = principal;
  const expiresMs = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  return (
    typeof subject === "string" &&
    subject.length >= 1 &&
    subject.length <= 128 &&
    typeof actorType === "string" &&
    Array.isArray(scopes) &&
    scopes.every((scope) => typeof scope === "string" && SCOPE_PATTERN.test(scope)) &&
    new Set(scopes).size === scopes.length &&
    Number.isFinite(expiresMs) &&
    new Date(expiresMs).toISOString() === expiresAt &&
    expiresMs > now
  );
}

/** @param {Readonly<Record<string, unknown>>} metadata */
function sameMetadata(metadata) {
  const keys = /** @type {(keyof typeof API_METADATA)[]} */ (Object.keys(API_METADATA));
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    Object.keys(metadata).length === keys.length &&
    keys.every((key) => Object.hasOwn(metadata, key) && metadata[key] === API_METADATA[key])
  );
}

/** @param {HandlerOptions} options */
export function createCustomerApiHandler({
  metadata = API_METADATA,
  verifier,
  kycDirectory,
  rateLimiter,
  walletDirectory,
  notificationDirectory,
  kycApplicationDirectory,
  profileDirectory,
  supportDirectory,
  depositDirectory,
  withdrawalDirectory,
  quoteDirectory,
  clock = () => Date.now(),
  generateRequestId = () => generateUuidV7(clock()),
  observer
}) {
  if (typeof verifier?.verify !== "function") {
    throw new Error("A token verifier is required");
  }
  if (typeof kycDirectory?.statusFor !== "function") {
    throw new Error("A KYC status directory is required");
  }
  if (typeof rateLimiter?.consume !== "function") {
    throw new Error("A rate limiter is required");
  }
  if (typeof walletDirectory?.listFor !== "function") {
    throw new Error("A wallet directory is required");
  }
  if (typeof notificationDirectory?.listFor !== "function") {
    throw new Error("A notification directory is required");
  }
  if (typeof kycApplicationDirectory?.viewFor !== "function") {
    throw new Error("A KYC application directory is required");
  }
  if (typeof profileDirectory?.viewFor !== "function") {
    throw new Error("A profile directory is required");
  }
  if (typeof supportDirectory?.listFor !== "function") {
    throw new Error("A support directory is required");
  }
  if (typeof depositDirectory?.listFor !== "function") {
    throw new Error("A deposit directory is required");
  }
  if (typeof withdrawalDirectory?.listFor !== "function") {
    throw new Error("A withdrawal directory is required");
  }
  if (typeof quoteDirectory?.listFor !== "function") {
    throw new Error("A quote directory is required");
  }

  /**
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @param {Headers} headers
   * @param {string} requestId
   * @param {Operation} operation
   */
  async function handleOperation(request, response, headers, requestId, operation) {
    /**
     * @param {number} status
     * @param {ErrorCode} code
     * @param {string} [message]
     * @param {Record<string, string>} [extraHeaders]
     */
    const fail = (status, code, message, extraHeaders) =>
      send(response, status, errorBody(code, requestId, message), requestId, extraHeaders);

    if (headers.has("content-length") || headers.has("transfer-encoding")) {
      fail(400, "VALIDATION_FAILED", "Request bodies are not accepted.", {
        connection: "close"
      });
      return;
    }
    if (headers.has("x-device-id")) {
      fail(
        400,
        "VALIDATION_FAILED",
        "X-Device-Id must not be sent to customer or metadata operations."
      );
      return;
    }
    const requestIdHeader = singleHeader(headers, "x-request-id");
    if (!isUuidV7(requestIdHeader)) {
      fail(400, "VALIDATION_FAILED", "X-Request-Id must be exactly one lowercase UUIDv7.");
      return;
    }
    if (!operation.authenticated) {
      if (!sameMetadata(metadata)) {
        throw new Error("Metadata drifted from the contract");
      }
      send(response, 200, { ...metadata }, requestId);
      return;
    }

    const clientVersion = singleHeader(headers, "x-client-version");
    if (
      clientVersion === null ||
      clientVersion.length < 1 ||
      clientVersion.length > CLIENT_VERSION_MAX_LENGTH
    ) {
      fail(400, "VALIDATION_FAILED", "X-Client-Version must be exactly one value of 1-64 characters.");
      return;
    }
    if (!/** @type {readonly unknown[]} */ (PLATFORMS).includes(singleHeader(headers, "x-platform"))) {
      fail(400, "VALIDATION_FAILED", "X-Platform must be exactly one supported platform value.");
      return;
    }

    const limit = rateLimiter.consume(rateLimitKey(request.socket.remoteAddress));
    if (!limit.allowed) {
      fail(429, "RATE_LIMITED", undefined, { "retry-after": String(limit.retryAfterSeconds) });
      return;
    }

    const unauthenticated = () =>
      fail(401, "AUTHENTICATION_REQUIRED", undefined, { "www-authenticate": "Bearer" });
    const token = parseBearerAuthorization(singleHeader(headers, "authorization"));
    if (token === null) {
      unauthenticated();
      return;
    }
    const principal = await verifier.verify(token);
    if (principal === null) {
      unauthenticated();
      return;
    }
    if (!validPrincipal(principal, clock())) {
      throw new Error("Verifier returned an invalid principal");
    }
    if (principal.actorType !== "customer") {
      unauthenticated();
      return;
    }

    if (operation.operationId === "getCustomerSession") {
      send(
        response,
        200,
        {
          subject: principal.subject,
          actor_type: "customer",
          scopes: [...principal.scopes],
          expires_at: principal.expiresAt
        },
        requestId
      );
      return;
    }

    const kycStatus = await kycDirectory.statusFor(principal.subject);
    const evaluation = evaluateCapabilities({ kycStatus });
    if (operation.operationId === "getCustomerKyc") {
      // customer.kyc.read is granted for every KYC status: the status surface
      // is the subject's own onboarding state and must stay readable while
      // they are unverified. The check stays so a served route can never
      // drift from the capabilities the service exposes.
      if (!evaluation.granted.includes("customer.kyc.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await kycApplicationDirectory.viewFor(principal.subject, kycStatus);
      if (!validKycStatusView(view)) {
        throw new Error("KYC application directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerProfile") {
      // customer.profile.read is granted for every KYC status: the profile
      // surface is the subject's own synthetic identity state and the
      // miniapp serves it to kyc-gated sessions too. The check stays so a
      // served route can never drift from the exposed capabilities.
      if (!evaluation.granted.includes("customer.profile.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await profileDirectory.viewFor(principal.subject);
      if (!validProfileView(view)) {
        throw new Error("Profile directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerSupport") {
      // customer.support.read is granted for every KYC status: the tickets
      // surface is the subject's own service-requests state and the miniapp
      // serves it to kyc-gated sessions too. The check stays so a served
      // route can never drift from the exposed capabilities.
      if (!evaluation.granted.includes("customer.support.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await supportDirectory.listFor(principal.subject);
      if (!validSupportTicketsView(view)) {
        throw new Error("Support directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerDeposits") {
      // customer.deposits.read is KYC-gated like wallets/notifications:
      // deposits are an asset/activity collection, so unverified and
      // pending subjects are denied with the 403 envelope.
      if (!evaluation.granted.includes("customer.deposits.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await depositDirectory.listFor(principal.subject);
      if (!validDepositsView(view)) {
        throw new Error("Deposit directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerWithdrawals") {
      // customer.withdrawals.read is KYC-gated like deposits/wallets:
      // withdrawals are an asset/activity collection, so unverified and
      // pending subjects are denied with the 403 envelope.
      if (!evaluation.granted.includes("customer.withdrawals.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await withdrawalDirectory.listFor(principal.subject);
      if (!validWithdrawalsView(view)) {
        throw new Error("Withdrawal directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerQuotes") {
      // customer.quotes.read is KYC-gated like deposits/withdrawals: quotes
      // are an asset/activity collection (indicative prices the subject was
      // shown), so unverified and pending subjects are denied with the 403
      // envelope. The payload is synthetic and execution-free (posting
      // "none", execution "not_supported") — it authorizes nothing.
      if (!evaluation.granted.includes("customer.quotes.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await quoteDirectory.listFor(principal.subject);
      if (!validQuotesView(view)) {
        throw new Error("Quote directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerWallets") {
      if (!evaluation.granted.includes("customer.wallets.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await walletDirectory.listFor(principal.subject);
      if (!validWalletsView(view)) {
        throw new Error("Wallet directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    if (operation.operationId === "getCustomerNotifications") {
      if (!evaluation.granted.includes("customer.notifications.read")) {
        fail(403, "CAPABILITY_DENIED");
        return;
      }
      const view = await notificationDirectory.listFor(principal.subject);
      if (!validNotificationsView(view)) {
        throw new Error("Notification directory returned an invalid view");
      }
      send(response, 200, { ...view }, requestId);
      return;
    }
    send(
      response,
      200,
      { capabilities: [...evaluation.granted], commands_enabled: false },
      requestId
    );
  }

  /**
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   * @param {Headers} headers
   * @param {string} requestId
   */
  function handleMetrics(request, response, headers, requestId) {
    if (!metricsRequestAllowed(request, headers)) {
      send(response, 404, errorBody("CAPABILITY_DENIED", requestId), requestId);
      return;
    }
    if (request.method !== "GET") {
      send(response, 405, errorBody("CAPABILITY_DENIED", requestId), requestId, { allow: "GET" });
      return;
    }
    // Only reached when observer?.metricsEnabled is true.
    const body = /** @type {RequestObserver} */ (observer).renderMetrics();
    response.writeHead(200, {
      ...BASE_HEADERS,
      "content-type": METRICS_CONTENT_TYPE,
      "content-length": Buffer.byteLength(body),
      "x-request-id": requestId
    });
    response.end(body);
  }

  /**
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   */
  return async function handle(request, response) {
    const headers = collectHeaders(request.rawHeaders);
    const requestIdHeader = singleHeader(headers, "x-request-id");
    const requestId = isUuidV7(requestIdHeader) ? requestIdHeader : generateRequestId();
    try {
      if (headers.get("host")?.length !== 1) {
        send(
          response,
          400,
          errorBody("VALIDATION_FAILED", requestId, "Exactly one Host header is required."),
          requestId,
          { connection: "close" }
        );
        return;
      }
      if (observer?.metricsEnabled && request.url === METRICS_PATH) {
        handleMetrics(request, response, headers, requestId);
        return;
      }
      const operation = OPERATIONS.find(
        (candidate) => candidate.method === request.method && candidate.path === request.url
      );
      if (!operation) {
        send(response, 404, errorBody("CAPABILITY_DENIED", requestId), requestId);
        return;
      }
      await handleOperation(request, response, headers, requestId, operation);
    } catch {
      if (!response.headersSent) {
        send(response, 500, errorBody("INTERNAL_ERROR", requestId), requestId, {
          connection: "close"
        });
      } else {
        response.destroy();
      }
    }
  };
}

/** @param {ServerOptions} options */
export function createCustomerApiServer(options) {
  const observer = createRequestObserver({
    service: "customer-api",
    routes: [...OPERATIONS.map((operation) => operation.path), METRICS_PATH],
    config: options.observability,
    sink: options.logSink,
    timer: options.timer,
    wallClock: options.clock
  });
  const handle = createCustomerApiHandler({ ...options, observer });
  /**
   * @param {IncomingMessage} request
   * @param {ServerResponse} response
   */
  const handler = (request, response) => {
    observer.observe(request, response);
    return handle(request, response);
  };
  const generateRequestId =
    options.generateRequestId ?? (() => generateUuidV7((options.clock ?? Date.now)()));
  const server = createServer(
    {
      headersTimeout: 10_000,
      requestTimeout: 15_000,
      maxHeaderSize: 16_384,
      requireHostHeader: false
    },
    handler
  );
  /**
   * @param {import("node:stream").Duplex} socket
   * @param {number} status
   * @param {ErrorCode} code
   */
  const rejectRaw = (socket, status, code) => {
    observer.recordRejected(status);
    const requestId = generateRequestId();
    const body = JSON.stringify(errorBody(code, requestId));
    socket.end(
      renderHead(status, {
        ...BASE_HEADERS,
        "content-length": Buffer.byteLength(body),
        "x-request-id": requestId,
        connection: "close"
      }) + body
    );
  };
  server.on("clientError", (error, socket) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ECONNRESET" || !socket.writable || closingSockets.has(socket)) {
      socket.destroy();
      return;
    }
    rejectRaw(socket, 400, "VALIDATION_FAILED");
  });
  server.on("checkExpectation", (request, response) => {
    observer.observe(request, response);
    const requestId = generateRequestId();
    send(response, 417, errorBody("VALIDATION_FAILED", requestId), requestId, { connection: "close" });
  });
  server.on("connect", (_request, socket) => {
    rejectRaw(socket, 404, "CAPABILITY_DENIED");
  });
  return server;
}
