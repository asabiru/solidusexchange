import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
} from "node:crypto";

import { assertEpochSeconds, createSimulatedClock } from "./deterministic.mjs";

/** @import { SimulatedClock } from "./deterministic.mjs" */

/**
 * Dev-only OIDC issuer simulator. Serves a minimal authorization-code + PKCE
 * (S256) provider over a transport-neutral request handler: the caller mounts
 * `handle` on any HTTP listener (the e2e stack wraps it in a plain server), so
 * the simulator itself stays inside the no-network boundary. It issues RS256
 * `id_token`s from a fresh per-run RSA-2048 keypair — keys are never derived
 * from the seed, like the callback signing keys. Authorization codes are
 * single-use, TTL-bound and bound to `{client_id, redirect_uri, code_challenge,
 * nonce, sub}`; the map is bounded and evicts expired entries lazily.
 *
 * Nothing here authenticates real users, mints real identity, or reaches a
 * network: every input is the caller's own synthetic request.
 */

export const OIDC_ISSUER_ENVIRONMENT = "dev-simulator";
export const OIDC_MAX_PENDING_CODES = 256;
const MAX_STATE_LENGTH = 128;
const MAX_PARAMETER_LENGTH = 1024;
const MAX_FORM_BYTES = 8_192;
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]{1,255}$/;
const SUBJECT_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

/**
 * @typedef {object} OidcIssuerConfig
 * @property {string} issuer Exact issuer URL the id_token `iss` claims (`http(s)://host[:port][/path]`, no query or fragment).
 * @property {string} clientId The only client this issuer serves.
 * @property {readonly string[]} redirectUris Exact registered redirect URIs; any other value is refused without a redirect.
 * @property {string} [defaultSubject] `sub` minted when /authorize carries no `login_hint` (`"dev-customer-1"`).
 * @property {SimulatedClock} [clock] Epoch-seconds clock; defaults to the shared simulator clock.
 * @property {number} [codeTtlSeconds] Authorization-code lifetime (`120`).
 * @property {number} [idTokenTtlSeconds] id_token lifetime (`300`).
 */

/**
 * @typedef {object} OidcRequest
 * @property {string} method
 * @property {string} url Path with query (e.g. `/authorize?...`).
 * @property {Readonly<Record<string, string | undefined>>} [headers]
 * @property {string} [body]
 */

/**
 * @typedef {object} OidcResponse
 * @property {number} status
 * @property {Readonly<Record<string, string>>} headers
 * @property {string} body
 */

/**
 * @typedef {object} PendingCode
 * @property {string} clientId
 * @property {string} redirectUri
 * @property {string} codeChallenge
 * @property {string} nonce
 * @property {string} sub
 * @property {number} expiresAt
 */

const BASE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
});

/**
 * @param {number} status
 * @param {unknown} body
 * @param {Readonly<Record<string, string>>} [headers]
 * @returns {OidcResponse}
 */
function jsonResponse(status, body, headers = {}) {
  return { status, headers: Object.freeze({ ...BASE_HEADERS, ...headers }), body: JSON.stringify(body) };
}

/**
 * @param {string} location
 * @returns {OidcResponse}
 */
function redirectResponse(location) {
  return {
    status: 302,
    headers: Object.freeze({ ...BASE_HEADERS, location }),
    body: "",
  };
}

/**
 * @param {string} redirectUri
 * @param {Readonly<Record<string, string>>} params
 * @returns {OidcResponse}
 */
function oauthErrorRedirect(redirectUri, params) {
  const target = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    target.searchParams.set(name, value);
  }
  return redirectResponse(target.toString());
}

const DUPLICATE = Symbol("duplicate-parameter");

/**
 * @param {URLSearchParams} params
 * @param {string} name
 * @returns {string | null | typeof DUPLICATE}
 */
function singleParam(params, name) {
  const values = params.getAll(name);
  if (values.length === 0) return null;
  if (values.length > 1) return DUPLICATE;
  return values[0];
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {value is string}
 */
function boundedParam(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

/**
 * @param {string} issuer
 * @returns {string}
 */
export function normalizeIssuerUrl(issuer) {
  if (typeof issuer !== "string") throw new TypeError("issuer must be a URL string");
  let parsed;
  try {
    parsed = new URL(issuer);
  } catch {
    throw new TypeError("issuer must be an absolute HTTP(S) URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.search
  ) {
    throw new TypeError("issuer must be an absolute HTTP(S) URL without credentials, query or fragment");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/**
 * @param {OidcIssuerConfig} config
 */
export function createOidcIssuer(config) {
  if (config === null || typeof config !== "object") {
    throw new TypeError("OIDC issuer config must be an object");
  }
  const issuer = normalizeIssuerUrl(config.issuer);
  const clientId = config.clientId;
  if (typeof clientId !== "string" || !PRINTABLE_ASCII.test(clientId)) {
    throw new TypeError("clientId must be printable ASCII, 1-255 characters");
  }
  const redirectUris = Object.freeze([...(config.redirectUris ?? [])]);
  if (redirectUris.length === 0) {
    throw new TypeError("redirectUris must register at least one exact URI");
  }
  for (const uri of redirectUris) {
    let parsed;
    try {
      parsed = new URL(uri);
    } catch {
      throw new TypeError("redirectUris entries must be absolute HTTP(S) URIs");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new TypeError("redirectUris entries must be absolute HTTP(S) URIs without credentials or fragments");
    }
  }
  const defaultSubject = config.defaultSubject ?? "dev-customer-1";
  if (typeof defaultSubject !== "string" || !SUBJECT_PATTERN.test(defaultSubject)) {
    throw new TypeError("defaultSubject must match ^[a-z0-9][a-z0-9._:-]{0,127}$");
  }
  const clock = config.clock ?? createSimulatedClock();
  const codeTtlSeconds = config.codeTtlSeconds ?? 120;
  const idTokenTtlSeconds = config.idTokenTtlSeconds ?? 300;
  assertEpochSeconds(codeTtlSeconds, "codeTtlSeconds");
  assertEpochSeconds(idTokenTtlSeconds, "idTokenTtlSeconds");
  if (codeTtlSeconds < 1 || idTokenTtlSeconds < 1) {
    throw new RangeError("OIDC lifetimes must be positive epoch-second counts");
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const jwk = publicKey.export({ format: "jwk" });
  const keyId = `oidc-dev-${randomBytes(6).toString("hex")}`;
  /** @type {Map<string, PendingCode>} */
  const codes = new Map();

  function jwksDocument() {
    return {
      keys: [
        {
          kty: "RSA",
          kid: keyId,
          use: "sig",
          alg: "RS256",
          n: jwk.n,
          e: jwk.e,
        },
      ],
    };
  }

  function metadataDocument() {
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      environment: OIDC_ISSUER_ENVIRONMENT,
    };
  }

  /** @param {number} now */
  function sweepExpiredCodes(now) {
    for (const [code, pending] of codes) {
      if (pending.expiresAt <= now) codes.delete(code);
    }
  }

  /**
   * @param {PendingCode} pending
   * @returns {string}
   */
  function mintCode(pending) {
    const now = clock.now();
    sweepExpiredCodes(now);
    while (codes.size >= OIDC_MAX_PENDING_CODES) {
      const oldest = codes.keys().next().value;
      if (oldest === undefined) break;
      codes.delete(oldest);
    }
    const code = `cod_${randomBytes(24).toString("base64url")}`;
    codes.set(code, pending);
    return code;
  }

  /**
   * @param {URL} url
   * @returns {OidcResponse}
   */
  function authorize(url) {
    const params = url.searchParams;
    const names = [
      "response_type",
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "nonce",
      "code_challenge",
      "code_challenge_method",
      "login_hint",
    ];
    /** @type {Record<string, string | null | typeof DUPLICATE>} */
    const seen = {};
    for (const name of names) {
      const value = singleParam(params, name);
      if (value === DUPLICATE) {
        return jsonResponse(400, { error: "invalid_request" });
      }
      seen[name] = value;
    }
    if (seen.client_id !== clientId) {
      return jsonResponse(400, { error: "unauthorized_client" });
    }
    const redirectUri = seen.redirect_uri;
    if (typeof redirectUri !== "string" || !redirectUris.includes(redirectUri)) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    const state = seen.state;
    /** @param {string} error */
    const fail = (error) => {
      /** @type {Record<string, string>} */
      const body = { error };
      // Only a bounded state may be reflected back into the Location.
      if (typeof state === "string" && state.length <= MAX_STATE_LENGTH) body.state = state;
      return oauthErrorRedirect(redirectUri, body);
    };
    if (seen.response_type !== "code") {
      return fail("unsupported_response_type");
    }
    const scopes = typeof seen.scope === "string" ? seen.scope.split(" ") : [];
    if (!scopes.includes("openid")) {
      return fail("invalid_scope");
    }
    if (!boundedParam(state, MAX_STATE_LENGTH) || !boundedParam(seen.nonce, MAX_STATE_LENGTH)) {
      return fail("invalid_request");
    }
    const challenge = seen.code_challenge;
    if (
      !boundedParam(challenge, 128) ||
      challenge.length < 43 ||
      !UNRESERVED.test(challenge) ||
      seen.code_challenge_method !== "S256"
    ) {
      return fail("invalid_request");
    }
    const hint = seen.login_hint;
    const sub = typeof hint === "string" && SUBJECT_PATTERN.test(hint) ? hint : defaultSubject;
    const code = mintCode({
      clientId,
      redirectUri,
      codeChallenge: challenge,
      nonce: seen.nonce,
      sub,
      expiresAt: clock.now() + codeTtlSeconds,
    });
    return oauthErrorRedirect(redirectUri, { code, state });
  }

  /**
   * @param {string} accessToken
   * @returns {string}
   */
  function accessTokenHash(accessToken) {
    return createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url");
  }

  /**
   * @param {PendingCode} pending
   * @param {string} accessToken
   * @returns {string}
   */
  function mintIdToken(pending, accessToken) {
    const now = clock.now();
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }),
      "utf8",
    ).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({
        iss: issuer,
        sub: pending.sub,
        aud: pending.clientId,
        exp: now + idTokenTtlSeconds,
        iat: now,
        nonce: pending.nonce,
        at_hash: accessTokenHash(accessToken),
      }),
      "utf8",
    ).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString(
      "base64url",
    );
    return `${header}.${claims}.${signature}`;
  }

  /**
   * @param {OidcRequest} request
   * @returns {OidcResponse}
   */
  function token(request) {
    const contentType = (request.headers?.["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      typeof request.body !== "string" ||
      request.body.length > MAX_FORM_BYTES ||
      contentType !== "application/x-www-form-urlencoded"
    ) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    let params;
    try {
      params = new URLSearchParams(request.body);
    } catch {
      return jsonResponse(400, { error: "invalid_request" });
    }
    const grantType = singleParam(params, "grant_type");
    if (grantType === DUPLICATE || grantType === null) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    if (grantType !== "authorization_code") {
      return jsonResponse(400, { error: "unsupported_grant_type" });
    }
    const code = singleParam(params, "code");
    const redirectUri = singleParam(params, "redirect_uri");
    const presentedClientId = singleParam(params, "client_id");
    const verifier = singleParam(params, "code_verifier");
    if ([code, redirectUri, presentedClientId, verifier].includes(DUPLICATE)) {
      return jsonResponse(400, { error: "invalid_request" });
    }
    if (
      !boundedParam(code, MAX_PARAMETER_LENGTH) ||
      !boundedParam(redirectUri, MAX_PARAMETER_LENGTH) ||
      !boundedParam(presentedClientId, MAX_PARAMETER_LENGTH) ||
      !boundedParam(verifier, 128)
    ) {
      return jsonResponse(400, { error: "invalid_grant" });
    }
    // Single-use: the first presentation consumes the code, whatever the outcome.
    const pending = codes.get(code);
    codes.delete(code);
    if (
      pending === undefined ||
      pending.expiresAt <= clock.now() ||
      pending.clientId !== presentedClientId ||
      pending.redirectUri !== redirectUri
    ) {
      return jsonResponse(400, { error: "invalid_grant" });
    }
    const expected = createHash("sha256").update(verifier).digest("base64url");
    const expectedBytes = Buffer.from(expected);
    const challengeBytes = Buffer.from(pending.codeChallenge);
    if (
      expectedBytes.length !== challengeBytes.length ||
      !timingSafeEqual(expectedBytes, challengeBytes)
    ) {
      return jsonResponse(400, { error: "invalid_grant" });
    }
    const accessToken = `sat_${randomBytes(24).toString("base64url")}`;
    return jsonResponse(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: idTokenTtlSeconds,
      scope: "openid",
      id_token: mintIdToken(pending, accessToken),
    });
  }

  const issuerUrl = new URL(issuer);
  const issuerPathPrefix = issuerUrl.pathname === "/" ? "" : issuerUrl.pathname;

  /**
   * @param {OidcRequest} request
   * @returns {Promise<OidcResponse>}
   */
  async function handle(request) {
    let url;
    try {
      url = new URL(request.url ?? "/", issuer);
    } catch {
      return jsonResponse(400, { error: "invalid_request" });
    }
    // The issuer only answers requests addressed to its own authority and
    // mounted under its declared path prefix; absolute-form or
    // scheme-relative request targets naming another authority are refused.
    if (url.origin !== issuerUrl.origin || !url.pathname.startsWith(issuerPathPrefix)) {
      return jsonResponse(404, { error: "not_found" });
    }
    const relative = url.pathname.slice(issuerPathPrefix.length);
    /** @type {Readonly<Record<string, string>>} */
    const endpoints = {
      "/.well-known/openid-configuration": "GET",
      "/.well-known/jwks.json": "GET",
      "/authorize": "GET",
      "/token": "POST",
    };
    const expected = endpoints[relative];
    if (expected === undefined) {
      return jsonResponse(404, { error: "not_found" });
    }
    if (request.method !== expected) {
      return jsonResponse(405, { error: "invalid_request" }, { allow: expected });
    }
    if (relative === "/.well-known/openid-configuration") {
      return jsonResponse(200, metadataDocument());
    }
    if (relative === "/.well-known/jwks.json") {
      return jsonResponse(200, jwksDocument());
    }
    if (relative === "/authorize") {
      return authorize(url);
    }
    return token(request);
  }

  return Object.freeze({
    issuer,
    clientId,
    keyId,
    jwksDocument,
    handle,
  });
}
