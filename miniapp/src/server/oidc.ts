import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey
} from "node:crypto";
import type { OidcConfig } from "./config.js";

// Dev-only authorization-code + PKCE client for the Mini App BFF. The
// verification core mirrors the wave-52-audited backoffice verifier
// (backoffice/src/server/oidc.ts): RS256-only, one JWKS entry per `kid`,
// RSA >= 2048-bit keys, no key-carrying or `crit` headers, canonical
// base64url segments, strict UTF-8, no duplicate JSON members, exact
// iss/aud/azp/nonce matching, finite NumericDates with the 60-second skew,
// printable-ASCII subjects and bounded response reads. On top of that the
// miniapp validates `at_hash` whenever the token carries one, and the token
// endpoint is a public client — PKCE only, never a client_secret.

interface ValidIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | readonly string[];
  azp?: string;
  exp: number;
  iat: number;
  nbf?: number;
  nonce: string;
  at_hash?: string;
  [claim: string]: unknown;
}

interface SigningJsonWebKey extends JsonWebKey {
  kid?: string;
}

interface JsonWebKeySet {
  keys: readonly SigningJsonWebKey[];
}

export interface OidcTokenExchange {
  idToken: string;
  accessToken?: string;
}

export interface OidcIdentity {
  /** The issuer's `sub`, validated but still issuer-spelled. */
  subject: string;
}

export interface PendingOidcLogin {
  nonce: string;
  verifier: string;
  initiator: string;
  expiresAt: number;
}

export type OidcFetch = (input: string, init?: {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  redirect?: "follow" | "error";
  signal?: AbortSignal;
}) => Promise<Response>;

export function createOpaqueValue(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function authorizationUrl(
  config: OidcConfig,
  state: string,
  nonce: string,
  verifier: string
): string {
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid",
    state,
    nonce,
    code_challenge: createCodeChallenge(verifier),
    code_challenge_method: "S256"
  }).toString();
  return url.toString();
}

const maxIdTokenLength = 16_384;
const maxOidcResponseBytes = 65_536;
const minRsaModulusBits = 2048;
const base64UrlSegment = /^[A-Za-z0-9_-]+$/;
const privateJwkMembers = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"] as const;
const unsupportedHeaderParameters = ["jku", "jwk", "x5u", "x5c", "b64"] as const;

async function readBoundedJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (!body) throw new Error("OIDC response is malformed");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxOidcResponseBytes) {
      await reader.cancel();
      throw new Error("OIDC response is too large");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  assertNoDuplicateMembers(text);
  return JSON.parse(text) as unknown;
}

function decodeSegment(value: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (!base64UrlSegment.test(value) || bytes.toString("base64url") !== value) {
    throw new Error("OIDC id_token is malformed");
  }
  return bytes;
}

function assertNoDuplicateMembers(text: string): void {
  const scopes: (Set<string> | undefined)[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") scopes.push(new Set());
    else if (character === "[") scopes.push(undefined);
    else if (character === "}" || character === "]") scopes.pop();
    else if (character === "\"") {
      const start = index;
      for (index += 1; text[index] !== "\""; index += 1) {
        if (text[index] === "\\") index += 1;
      }
      let next = index + 1;
      while (" \t\n\r".includes(text[next])) next += 1;
      const scope = scopes.at(-1);
      if (scope && text[next] === ":") {
        const member = JSON.parse(text.slice(start, index + 1)) as string;
        if (scope.has(member)) throw new Error("OIDC id_token contains duplicate JSON members");
        scope.add(member);
      }
    }
  }
}

function canonicalBase64Url(value: string): string | undefined {
  if (!base64UrlSegment.test(value)) return undefined;
  return Buffer.from(value, "base64url").toString("base64url");
}

function decodeJson<T>(value: string): T {
  const bytes = decodeSegment(value);
  let text: string;
  let parsed: T;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    parsed = JSON.parse(text) as T;
  } catch {
    throw new Error("OIDC id_token is malformed");
  }
  assertNoDuplicateMembers(text);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Public-client code exchange: `client_id` + `code_verifier`, never a secret.
 * Returns the raw `id_token` plus the `access_token` so the caller can check
 * `at_hash` when the token carries one; the access token is never persisted.
 */
export async function exchangeAuthorizationCode(
  config: OidcConfig,
  code: string,
  verifier: string,
  fetchImpl: OidcFetch = fetch
): Promise<OidcTokenExchange> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier
  });
  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "error",
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("OIDC token exchange failed");
  const payload: unknown = await readBoundedJson(response);
  if (!isRecord(payload) || typeof payload.id_token !== "string") {
    throw new Error("OIDC token response is missing id_token");
  }
  if (payload.token_type !== "Bearer") {
    throw new Error("OIDC token response is missing the Bearer token_type");
  }
  const accessToken = payload.access_token;
  if (accessToken !== undefined && typeof accessToken !== "string") {
    throw new Error("OIDC token response is malformed");
  }
  return { idToken: payload.id_token, accessToken };
}

function validateClaims(
  claims: Record<string, unknown>,
  config: OidcConfig,
  nonce: string,
  accessToken: string | undefined,
  now: number
): asserts claims is Record<string, unknown> & ValidIdTokenClaims {
  const audience = typeof claims.aud === "string"
    ? [claims.aud]
    : Array.isArray(claims.aud) && claims.aud.every((entry) => typeof entry === "string")
      ? claims.aud
      : [];
  if (
    typeof claims.iss !== "string"
    || typeof claims.sub !== "string"
    || claims.sub.length === 0
    || claims.sub.length > 255
    || [...claims.sub].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code > 0x7e;
    })
    || typeof claims.exp !== "number"
    || !Number.isFinite(claims.exp)
    || typeof claims.iat !== "number"
    || !Number.isFinite(claims.iat)
    || typeof claims.nonce !== "string"
    || audience.length === 0
  ) {
    throw new Error("OIDC token claims are malformed");
  }
  if (claims.iss !== config.issuer || !audience.includes(config.clientId)) {
    throw new Error("OIDC issuer or audience mismatch");
  }
  if (
    (audience.length > 1 || claims.azp !== undefined)
    && claims.azp !== config.clientId
  ) {
    throw new Error("OIDC authorized party mismatch");
  }
  if (
    claims.nonce !== nonce
    || claims.exp <= now
    || claims.iat > now + 60
    || (
      claims.nbf !== undefined
      && (
        typeof claims.nbf !== "number"
        || !Number.isFinite(claims.nbf)
        || claims.nbf > now + 60
      )
    )
  ) {
    throw new Error("OIDC token claims are not valid");
  }
  // at_hash binds the id_token to the issued access_token. It is required
  // whenever an access token was issued; a token advertising the claim
  // without a verifiable access token, or with a mismatched hash, fails
  // closed.
  if (accessToken !== undefined || claims.at_hash !== undefined) {
    const expected = accessToken === undefined
      ? undefined
      : createHash("sha256").update(accessToken).digest().subarray(0, 16).toString("base64url");
    if (typeof claims.at_hash !== "string" || claims.at_hash !== expected) {
      throw new Error("OIDC access token hash mismatch");
    }
  }
}

export async function verifyIdToken(
  idToken: string,
  config: OidcConfig,
  nonce: string,
  accessToken?: string,
  suppliedJwks?: JsonWebKeySet,
  fetchImpl: OidcFetch = fetch
): Promise<OidcIdentity> {
  if (idToken.length > maxIdTokenLength) throw new Error("OIDC id_token is too large");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("OIDC id_token is malformed");
  const signature = decodeSegment(parts[2]);
  const header = decodeJson<unknown>(parts[0]);
  const claims = decodeJson<unknown>(parts[1]);
  if (
    !isRecord(header)
    || header.alg !== "RS256"
    || typeof header.kid !== "string"
    || header.kid.length === 0
  ) {
    throw new Error("OIDC signing algorithm is not allowed");
  }
  if (header.crit !== undefined) {
    throw new Error("OIDC critical protected header parameters are not supported");
  }
  if (unsupportedHeaderParameters.some((name) => Object.hasOwn(header, name))) {
    throw new Error("OIDC protected header parameter is not supported");
  }
  if (!isRecord(claims)) throw new Error("OIDC token claims are malformed");

  const jwks: JsonWebKeySet = suppliedJwks ?? await fetchImpl(config.jwksUri, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000)
    }).then(async (response) => {
      if (!response.ok) throw new Error("OIDC JWKS request failed");
      return await readBoundedJson(response) as JsonWebKeySet;
    });
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) throw new Error("OIDC JWKS is malformed");
  const matchingKeys = jwks.keys.filter(
    (candidate) => isRecord(candidate) && candidate.kid === header.kid
  );
  if (matchingKeys.length === 0) throw new Error("OIDC signing key was not found");
  if (matchingKeys.length > 1) throw new Error("OIDC signing key is ambiguous");
  const jwk = matchingKeys[0];
  if (
    !isRecord(jwk)
    || jwk.kty !== "RSA"
    || typeof jwk.n !== "string"
    || typeof jwk.e !== "string"
    || canonicalBase64Url(jwk.n) !== jwk.n
    || canonicalBase64Url(jwk.e) !== jwk.e
    || privateJwkMembers.some((name) => Object.hasOwn(jwk, name))
    || (jwk.use !== undefined && jwk.use !== "sig")
    || (jwk.alg !== undefined && jwk.alg !== header.alg)
    || (
      jwk.key_ops !== undefined
      && (
        !Array.isArray(jwk.key_ops)
        || jwk.key_ops.length !== 1
        || jwk.key_ops[0] !== "verify"
      )
    )
  ) {
    throw new Error("OIDC signing key is not allowed");
  }
  const publicKey = createPublicKey({
    key: { kty: "RSA", n: jwk.n, e: jwk.e },
    format: "jwk"
  });
  const exponent = publicKey.asymmetricKeyDetails?.publicExponent;
  if (
    publicKey.asymmetricKeyType !== "rsa"
    || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < minRsaModulusBits
    || typeof exponent !== "bigint"
    || exponent < 3n
    || exponent % 2n === 0n
  ) {
    throw new Error("OIDC signing key is not allowed");
  }

  const verified = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    signature
  );
  if (!verified) throw new Error("OIDC id_token signature is invalid");

  validateClaims(claims, config, nonce, accessToken, Math.floor(Date.now() / 1000));
  return { subject: claims.sub };
}
