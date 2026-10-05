import { createHmac, timingSafeEqual } from "node:crypto";

// A verifier implements `verify(token) -> Promise<Principal | null>`, where a
// principal is `{ subject, actorType, scopes, expiresAt }`. A future IdP
// adapter replaces the dev-only synthetic verifier behind this interface.

export const CUSTOMER_SCOPES = Object.freeze([
  "customer.session.read",
  "customer.capabilities.read"
]);
export const SYNTHETIC_TOKEN_MAX_TTL_SECONDS = 3600;
export const SYNTHETIC_SUBJECT_PATTERN = /^syn_cust_[a-z0-9]{8,32}$/u;
export const DEV_TOKEN_KEY_PATTERN = /^[0-9a-f]{64}$/u;

const TOKEN_PATTERN =
  /^scdev1\.(syn_cust_[a-z0-9]{8,32})\.([1-9][0-9]{9})\.([0-9a-f]{64})$/u;
const TOKEN_MAX_LENGTH = 160;
const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-dev-token-v1";
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/iu;

function assertKey(key) {
  if (typeof key !== "string" || !DEV_TOKEN_KEY_PATTERN.test(key)) {
    throw new Error("Synthetic dev token key must be 64 lowercase hex characters");
  }
}

function sign(key, subject, expiresAtSeconds) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`${SIGNATURE_DOMAIN}\n${subject}\n${expiresAtSeconds}`)
    .digest("hex");
}

export function mintSyntheticCustomerToken({ key, subject, expiresAtSeconds }) {
  assertKey(key);
  if (typeof subject !== "string" || !SYNTHETIC_SUBJECT_PATTERN.test(subject)) {
    throw new Error("Synthetic subject must match syn_cust_[a-z0-9]{8,32}");
  }
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds < 1_000_000_000 ||
    expiresAtSeconds > 9_999_999_999
  ) {
    throw new Error("Synthetic token expiry must be a 10-digit epoch second");
  }
  return `scdev1.${subject}.${expiresAtSeconds}.${sign(key, subject, expiresAtSeconds)}`;
}

export function parseBearerAuthorization(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = BEARER_PATTERN.exec(value);
  return match ? match[1] : null;
}

export function createDenyAllVerifier() {
  return Object.freeze({
    kind: "deny-all",
    async verify() {
      return null;
    }
  });
}

export function createSyntheticTokenVerifier({
  key,
  clock = () => Date.now(),
  maxTtlSeconds = SYNTHETIC_TOKEN_MAX_TTL_SECONDS
}) {
  assertKey(key);
  return Object.freeze({
    kind: "synthetic-dev",
    async verify(token) {
      if (typeof token !== "string" || token.length > TOKEN_MAX_LENGTH) {
        return null;
      }
      const match = TOKEN_PATTERN.exec(token);
      if (!match) {
        return null;
      }
      const [, subject, expiresText, signature] = match;
      const expected = Buffer.from(sign(key, subject, expiresText), "hex");
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
        return null;
      }
      const expiresAtSeconds = Number(expiresText);
      const nowSeconds = Math.floor(clock() / 1000);
      if (
        expiresAtSeconds <= nowSeconds ||
        expiresAtSeconds - nowSeconds > maxTtlSeconds
      ) {
        return null;
      }
      return Object.freeze({
        subject,
        actorType: "customer",
        scopes: Object.freeze([...CUSTOMER_SCOPES]),
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
      });
    }
  });
}
