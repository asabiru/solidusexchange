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
import { generateUuidV7, isUuidV7 } from "./request-id.mjs";

const BASE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff"
});
const SCOPE_PATTERN = /^[a-z][a-z0-9.:-]{0,127}$/u;
// Every peer of this loopback-only server is local, and a local client can pick
// any 127.0.0.0/8 source address, so the whole range shares one bucket.
const IPV4_LOOPBACK_PATTERN = /^(?:::ffff:)?127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/iu;

function rateLimitKey(address) {
  if (typeof address !== "string") {
    return "unknown";
  }
  return IPV4_LOOPBACK_PATTERN.test(address) ? "127.0.0.0/8" : address;
}

function collectHeaders(rawHeaders) {
  const headers = new Map();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    const values = headers.get(name) ?? [];
    values.push(rawHeaders[index + 1]);
    headers.set(name, values);
  }
  return headers;
}

function singleHeader(headers, name) {
  const values = headers.get(name);
  return values?.length === 1 ? values[0] : null;
}

function errorBody(code, requestId, message = ERROR_MESSAGES[code]) {
  return { code, message, request_id: requestId, details: {} };
}

function renderHead(status, headers) {
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status]}`];
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`${name}: ${value}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

const closingSockets = new WeakSet();

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

function sameMetadata(metadata) {
  const keys = Object.keys(API_METADATA);
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    Object.keys(metadata).length === keys.length &&
    keys.every((key) => Object.hasOwn(metadata, key) && metadata[key] === API_METADATA[key])
  );
}

export function createCustomerApiHandler({
  metadata = API_METADATA,
  verifier,
  kycDirectory,
  rateLimiter,
  clock = () => Date.now(),
  generateRequestId = () => generateUuidV7(clock())
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

  async function handleOperation(request, response, headers, requestId, operation) {
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
    if (!PLATFORMS.includes(singleHeader(headers, "x-platform"))) {
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
    send(
      response,
      200,
      { capabilities: [...evaluation.granted], commands_enabled: false },
      requestId
    );
  }

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

export function createCustomerApiServer(options) {
  const handler = createCustomerApiHandler(options);
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
  const rejectRaw = (socket, status, code) => {
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
    if (error.code === "ECONNRESET" || !socket.writable || closingSockets.has(socket)) {
      socket.destroy();
      return;
    }
    rejectRaw(socket, 400, "VALIDATION_FAILED");
  });
  server.on("connect", (_request, socket) => {
    rejectRaw(socket, 404, "CAPABILITY_DENIED");
  });
  return server;
}
