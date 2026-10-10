import { createHmac, timingSafeEqual } from "node:crypto";

// A verifier implements `verify(token) -> Promise<Principal | null>`, where a
// principal is `{ subject, actorType, scopes, expiresAt }`. A future IdP
// adapter replaces the dev-only synthetic verifier behind this interface.

/**
 * @typedef {object} Principal
 * @property {string} subject
 * @property {string} actorType
 * @property {readonly string[]} scopes
 * @property {string} expiresAt
 */

/**
 * @typedef {object} TokenVerifier
 * @property {string} kind
 * @property {(token: string) => Promise<Principal | null>} verify
 */

export const CUSTOMER_SCOPES = Object.freeze([
  "customer.session.read",
  "customer.capabilities.read"
]);
export const OPERATOR_SCOPES = Object.freeze([
  "operator.session.read",
  "operator.capabilities.read"
]);
export const SYNTHETIC_TOKEN_MAX_TTL_SECONDS = 3600;
export const SYNTHETIC_SUBJECT_PATTERN = /^syn_cust_[a-z0-9]{8,32}$/u;
export const SYNTHETIC_OPERATOR_SUBJECT_PATTERN = /^syn_oper_[a-z0-9]{8,32}$/u;
export const DEV_TOKEN_KEY_PATTERN = /^[0-9a-f]{64}$/u;

const TOKEN_PATTERN =
  /^scdev1\.(syn_cust_[a-z0-9]{8,32})\.([1-9][0-9]{9})\.([0-9a-f]{64})$/u;
const OPERATOR_TOKEN_PATTERN =
  /^sodev1\.(syn_oper_[a-z0-9]{8,32})\.([1-9][0-9]{9})\.([0-9a-f]{64})$/u;
const TOKEN_MAX_LENGTH = 160;
const SIGNATURE_DOMAIN = "solidchange-customer-api-synthetic-dev-token-v1";
const OPERATOR_SIGNATURE_DOMAIN = "solidchange-operator-api-synthetic-dev-token-v1";
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/iu;

/**
 * @param {unknown} key
 * @returns {asserts key is string}
 */
function assertKey(key) {
  if (typeof key !== "string" || !DEV_TOKEN_KEY_PATTERN.test(key)) {
    throw new Error("Synthetic dev token key must be 64 lowercase hex characters");
  }
}

/**
 * @param {string} key
 * @param {string} domain
 * @param {string} subject
 * @param {number | string} expiresAtSeconds
 */
function sign(key, domain, subject, expiresAtSeconds) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(`${domain}\n${subject}\n${expiresAtSeconds}`)
    .digest("hex");
}

/**
 * @param {{ key: unknown, subject: unknown, expiresAtSeconds: number }} options
 */
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
  return `scdev1.${subject}.${expiresAtSeconds}.${sign(key, SIGNATURE_DOMAIN, subject, expiresAtSeconds)}`;
}

/**
 * @param {{ key: unknown, subject: unknown, expiresAtSeconds: number }} options
 */
export function mintSyntheticOperatorToken({ key, subject, expiresAtSeconds }) {
  assertKey(key);
  if (typeof subject !== "string" || !SYNTHETIC_OPERATOR_SUBJECT_PATTERN.test(subject)) {
    throw new Error("Synthetic operator subject must match syn_oper_[a-z0-9]{8,32}");
  }
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds < 1_000_000_000 ||
    expiresAtSeconds > 9_999_999_999
  ) {
    throw new Error("Synthetic token expiry must be a 10-digit epoch second");
  }
  return `sodev1.${subject}.${expiresAtSeconds}.${sign(key, OPERATOR_SIGNATURE_DOMAIN, subject, expiresAtSeconds)}`;
}

/** @param {unknown} value */
export function parseBearerAuthorization(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match = BEARER_PATTERN.exec(value);
  return match ? match[1] : null;
}

/** @returns {TokenVerifier} */
export function createDenyAllVerifier() {
  return Object.freeze({
    kind: "deny-all",
    async verify() {
      return null;
    }
  });
}

/**
 * @param {{ key: unknown, clock?: () => number, maxTtlSeconds?: number }} options
 * @returns {TokenVerifier}
 */
export function createSyntheticTokenVerifier({
  key,
  clock = () => Date.now(),
  maxTtlSeconds = SYNTHETIC_TOKEN_MAX_TTL_SECONDS
}) {
  assertKey(key);
  if (!Number.isSafeInteger(maxTtlSeconds) || maxTtlSeconds < 1) {
    throw new Error("Synthetic token TTL bound must be a positive integer");
  }
  return Object.freeze({
    kind: "synthetic-dev",
    async verify(token) {
      if (typeof token !== "string" || token.length > TOKEN_MAX_LENGTH) {
        return null;
      }
      const customerMatch = TOKEN_PATTERN.exec(token);
      const operatorMatch = customerMatch ? null : OPERATOR_TOKEN_PATTERN.exec(token);
      const match = customerMatch ?? operatorMatch;
      if (!match) {
        return null;
      }
      const [, subject, expiresText, signature] = match;
      const domain = operatorMatch ? OPERATOR_SIGNATURE_DOMAIN : SIGNATURE_DOMAIN;
      const expected = Buffer.from(sign(key, domain, subject, expiresText), "hex");
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
        return null;
      }
      const expiresAtSeconds = Number(expiresText);
      const nowSeconds = Math.floor(clock() / 1000);
      // A non-finite clock (NaN, a string, undefined) makes every comparison
      // false and would silently skip the expiry and TTL checks.
      if (!Number.isFinite(nowSeconds)) {
        return null;
      }
      if (
        expiresAtSeconds <= nowSeconds ||
        expiresAtSeconds - nowSeconds > maxTtlSeconds
      ) {
        return null;
      }
      return Object.freeze({
        subject,
        actorType: operatorMatch ? "operator" : "customer",
        scopes: Object.freeze([...(operatorMatch ? OPERATOR_SCOPES : CUSTOMER_SCOPES)]),
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
      });
    }
  });
}
