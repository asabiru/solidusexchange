import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type JsonWebKey
} from "node:crypto";
import type { OperatorRole } from "../auth/access.js";
import type { OidcConfig } from "./config.js";

interface ValidIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | readonly string[];
  azp?: string;
  exp: number;
  iat: number;
  nbf?: number;
  nonce: string;
  email?: string;
  name?: string;
  [claim: string]: unknown;
}

interface SigningJsonWebKey extends JsonWebKey {
  kid?: string;
}

interface JsonWebKeySet {
  keys: readonly SigningJsonWebKey[];
}

export interface OidcIdentity {
  subject: string;
  email: string;
  name: string;
  role: OperatorRole;
}

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
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: createCodeChallenge(verifier),
    code_challenge_method: "S256"
  }).toString();
  return url.toString();
}

export async function exchangeAuthorizationCode(
  config: OidcConfig,
  code: string,
  verifier: string
): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier
  });
  if (config.clientSecret) form.set("client_secret", config.clientSecret);

  const response = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error("OIDC token exchange failed");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("id_token" in payload)) {
    throw new Error("OIDC token response is missing id_token");
  }
  const idToken = payload.id_token;
  if (typeof idToken !== "string") throw new Error("OIDC id_token is invalid");
  return idToken;
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateClaims(
  claims: Record<string, unknown>,
  config: OidcConfig,
  nonce: string,
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
    || typeof claims.exp !== "number"
    || typeof claims.iat !== "number"
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
}

function mapRole(claims: ValidIdTokenClaims, config: OidcConfig): OperatorRole {
  const claim = claims[config.roleClaim];
  const groups = typeof claim === "string"
    ? [claim]
    : Array.isArray(claim) && claim.every((entry) => typeof entry === "string")
      ? claim
      : [];
  const mappedRoles = new Set<OperatorRole>();
  for (const group of groups) {
    const role = config.roleMap[group];
    if (role) mappedRoles.add(role);
  }
  if (mappedRoles.size === 0) throw new Error("OIDC identity has no mapped backoffice role");
  if (mappedRoles.size > 1) throw new Error("OIDC identity has ambiguous backoffice roles");
  return [...mappedRoles][0];
}

export async function verifyIdToken(
  idToken: string,
  config: OidcConfig,
  nonce: string,
  suppliedJwks?: JsonWebKeySet
): Promise<OidcIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("OIDC id_token is malformed");
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
  if (!isRecord(claims)) throw new Error("OIDC token claims are malformed");

  const jwks: JsonWebKeySet = suppliedJwks ?? await fetch(config.jwksUri, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000)
    }).then(async (response) => {
      if (!response.ok) throw new Error("OIDC JWKS request failed");
      return await response.json() as JsonWebKeySet;
    });
  const matchingKeys = jwks.keys.filter((candidate) => candidate.kid === header.kid);
  if (matchingKeys.length === 0) throw new Error("OIDC signing key was not found");
  if (matchingKeys.length > 1) throw new Error("OIDC signing key is ambiguous");
  const jwk = matchingKeys[0];
  if (
    (jwk.use !== undefined && jwk.use !== "sig")
    || (jwk.alg !== undefined && jwk.alg !== header.alg)
    || (
      jwk.key_ops !== undefined
      && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify"))
    )
  ) {
    throw new Error("OIDC signing key is not allowed");
  }

  const verified = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url")
  );
  if (!verified) throw new Error("OIDC id_token signature is invalid");

  validateClaims(claims, config, nonce, Math.floor(Date.now() / 1000));
  return {
    subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    name: typeof claims.name === "string"
      ? claims.name
      : typeof claims.email === "string"
        ? claims.email
        : claims.sub,
    role: mapRole(claims, config)
  };
}
