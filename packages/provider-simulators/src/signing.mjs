import {
  KeyObject,
  createHash,
  createHmac,
  createSecretKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";

import { JsonError, canonicalStringify, parseCanonicalJsonBytes } from "./canonical-json.mjs";
import { assertEpochSeconds } from "./deterministic.mjs";

/** @import { JsonValue } from "./canonical-json.mjs" */
/** @import { SeededRandom } from "./deterministic.mjs" */

export const SIGNATURE_SCHEME = "solidchange-sim-callback-v1";
export const SIMULATOR_ENVIRONMENT = "dev-simulator";
export const SIMULATOR_DOMAINS = Object.freeze(["kyc", "kyt", "bank", "quote"]);
export const SIGNATURE_HEADERS = Object.freeze({
  keyId: "x-sim-key-id",
  timestamp: "x-sim-timestamp",
  nonce: "x-sim-nonce",
  signature: "x-sim-signature",
});
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
export const DEFAULT_MAX_AGE_SECONDS = 300;
export const DEFAULT_MAX_FUTURE_SECONDS = 60;

const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TIMESTAMP = /^(?:0|[1-9][0-9]{0,11})$/;
const NONCE = /^[0-9a-f]{32}$/;
const SIGNATURE = /^v1=([A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{86})$/;
const MAX_HEADER_VALUE = 256;
const SIGNATURE_BYTES = Object.freeze({ ed25519: 64, "hmac-sha256": 32 });

/** @typedef {"ed25519" | "hmac-sha256"} SignatureAlgorithm */
/** @typedef {"kyc" | "kyt" | "bank" | "quote"} SimulatorDomain */

/**
 * @typedef {object} SimulatorKey
 * @property {string} keyId
 * @property {SignatureAlgorithm} algorithm
 * @property {KeyObject} signingKey Ed25519 private key or HMAC secret.
 * @property {KeyObject} verificationKey Ed25519 public key or HMAC secret.
 */

/**
 * @typedef {object} SignedDelivery
 * @property {Record<string, string>} headers
 * @property {Buffer} body Canonical UTF-8 JSON bytes.
 */

/**
 * @typedef {{ ok: true, payload: Record<string, JsonValue>, keyId: string, timestamp: number, nonce: string }
 *   | { ok: false, reason: VerificationFailure }} VerificationResult
 */

/**
 * @typedef {"invalid_body_type"
 *   | "body_too_large"
 *   | "invalid_headers"
 *   | "duplicate_header"
 *   | "missing_header"
 *   | "invalid_key_id"
 *   | "invalid_timestamp"
 *   | "invalid_nonce"
 *   | "invalid_signature_encoding"
 *   | "stale_timestamp"
 *   | "future_timestamp"
 *   | "unknown_key_id"
 *   | "signature_mismatch"
 *   | import("./canonical-json.mjs").JsonErrorCode
 *   | "domain_mismatch"
 *   | "invalid_payload"
 *   | "replayed_nonce"
 *   | "nonce_store_full"} VerificationFailure
 */

/**
 * Generates a fresh per-run key. Keys are never derived from the seed and are
 * never persisted; tests create them on every run.
 *
 * @param {{ keyId: string, algorithm?: SignatureAlgorithm }} options
 * @returns {SimulatorKey}
 */
export function generateSimulatorKey({ keyId, algorithm = "ed25519" }) {
  assertKeyId(keyId);
  if (algorithm === "ed25519") {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return Object.freeze({ keyId, algorithm, signingKey: privateKey, verificationKey: publicKey });
  }
  if (algorithm === "hmac-sha256") {
    const secret = createSecretKey(randomBytes(32));
    return Object.freeze({ keyId, algorithm, signingKey: secret, verificationKey: secret });
  }
  throw new TypeError("unsupported signature algorithm");
}

/**
 * @param {unknown} keyId
 * @returns {asserts keyId is string}
 */
function assertKeyId(keyId) {
  if (typeof keyId !== "string" || !KEY_ID.test(keyId)) {
    throw new TypeError("keyId must match ^[a-z0-9][a-z0-9._-]{0,63}$");
  }
}

/**
 * @param {unknown} domain
 * @returns {asserts domain is SimulatorDomain}
 */
function assertDomain(domain) {
  if (typeof domain !== "string" || !SIMULATOR_DOMAINS.includes(domain)) {
    throw new TypeError("unknown simulator domain");
  }
}

/**
 * @param {SimulatorDomain} domain
 * @param {string} keyId
 * @param {string} timestamp
 * @param {string} nonce
 * @param {Uint8Array} body
 */
function signingInput(domain, keyId, timestamp, nonce, body) {
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  return Buffer.from(
    [SIGNATURE_SCHEME, domain, keyId, timestamp, nonce, bodyDigest].join("\n"),
    "utf8",
  );
}

/**
 * @typedef {object} CallbackSigner
 * @property {SimulatorDomain} domain
 * @property {string} keyId
 * @property {(payload: Record<string, JsonValue>, timestamp: number) => SignedDelivery} sign
 */

/**
 * @param {{ key: SimulatorKey, domain: SimulatorDomain, random: SeededRandom }} options
 * @returns {CallbackSigner}
 */
export function createCallbackSigner({ key, domain, random }) {
  assertDomain(domain);
  assertKeyId(key.keyId);
  if (!(key.signingKey instanceof KeyObject)) {
    throw new TypeError("signing key must be a KeyObject");
  }
  return Object.freeze({
    domain,
    keyId: key.keyId,
    /**
     * @param {Record<string, JsonValue>} payload
     * @param {number} timestamp
     */
    sign(payload, timestamp) {
      assertEpochSeconds(timestamp, "signature timestamp");
      if (payload.domain !== domain || payload.environment !== SIMULATOR_ENVIRONMENT) {
        throw new TypeError("payload must carry the signer domain and simulator environment");
      }
      const body = Buffer.from(canonicalStringify(payload), "utf8");
      const nonce = random.hex("signature-nonce", 16);
      const time = String(timestamp);
      const input = signingInput(domain, key.keyId, time, nonce, body);
      const signature =
        key.algorithm === "ed25519"
          ? sign(null, input, key.signingKey)
          : createHmac("sha256", key.signingKey).update(input).digest();
      return {
        headers: {
          [SIGNATURE_HEADERS.keyId]: key.keyId,
          [SIGNATURE_HEADERS.timestamp]: time,
          [SIGNATURE_HEADERS.nonce]: nonce,
          [SIGNATURE_HEADERS.signature]: `v1=${signature.toString("base64url")}`,
        },
        body,
      };
    },
  });
}

/**
 * @typedef {object} VerificationKey
 * @property {string} keyId
 * @property {SignatureAlgorithm} algorithm
 * @property {KeyObject} key Ed25519 public key or HMAC secret (never a private key).
 */

/**
 * Builds an immutable keyring. The algorithm is bound to the key id, never
 * taken from the request.
 *
 * @param {VerificationKey[]} keys
 * @returns {ReadonlyMap<string, VerificationKey>}
 */
export function createVerificationKeyring(keys) {
  /** @type {Map<string, VerificationKey>} */
  const ring = new Map();
  for (const entry of keys) {
    assertKeyId(entry.keyId);
    if (ring.has(entry.keyId)) {
      throw new TypeError("duplicate key id in keyring");
    }
    const { key, algorithm } = entry;
    if (!(key instanceof KeyObject)) {
      throw new TypeError("verification key must be a KeyObject");
    }
    if (algorithm === "ed25519") {
      if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
        throw new TypeError("ed25519 keyring entries must be public Ed25519 keys");
      }
    } else if (algorithm === "hmac-sha256") {
      if (key.type !== "secret" || (key.symmetricKeySize ?? 0) < 32) {
        throw new TypeError("hmac-sha256 keyring entries must be secrets of at least 32 bytes");
      }
    } else {
      throw new TypeError("unsupported signature algorithm");
    }
    ring.set(entry.keyId, Object.freeze({ keyId: entry.keyId, algorithm, key }));
  }
  return ring;
}

/**
 * @param {SimulatorKey} key
 * @returns {VerificationKey}
 */
export function verificationKeyOf(key) {
  return { keyId: key.keyId, algorithm: key.algorithm, key: key.verificationKey };
}

/**
 * @typedef {object} NonceStore
 * @property {(nonce: string, expiresAt: number, now: number) => "recorded" | "replayed" | "full"} record
 * @property {() => number} size
 */

/**
 * Bounded in-memory replay cache. When full it fails closed instead of
 * evicting unexpired nonces.
 *
 * @param {{ maxEntries?: number }} [options]
 * @returns {NonceStore}
 */
export function createNonceStore({ maxEntries = 10_000 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries must be a positive integer");
  }
  /** @type {Map<string, number>} */
  const entries = new Map();
  return Object.freeze({
    /**
     * @param {string} nonce
     * @param {number} expiresAt
     * @param {number} now
     */
    record(nonce, expiresAt, now) {
      for (const [seen, expiry] of entries) {
        if (expiry < now) {
          entries.delete(seen);
        }
      }
      if (entries.has(nonce)) {
        return "replayed";
      }
      if (entries.size >= maxEntries) {
        return "full";
      }
      entries.set(nonce, expiresAt);
      return "recorded";
    },
    size: () => entries.size,
  });
}

/**
 * @typedef {object} CallbackVerifierOptions
 * @property {SimulatorDomain} domain
 * @property {ReadonlyMap<string, VerificationKey>} keyring
 * @property {NonceStore} nonceStore
 * @property {(payload: Record<string, JsonValue>) => string | null} validatePayload
 *   Returns an error description, or null when the payload matches the schema.
 * @property {number} [maxBodyBytes]
 * @property {number} [maxAgeSeconds]
 * @property {number} [maxFutureSeconds]
 */

/**
 * @typedef {object} CallbackDeliveryInput
 * @property {unknown} headers
 * @property {unknown} body Raw received bytes; strings are refused.
 * @property {number} now Receiver clock, integer epoch seconds.
 */

/**
 * Creates a fail-closed verifier for signed simulator deliveries.
 *
 * @param {CallbackVerifierOptions} options
 * @returns {(input: CallbackDeliveryInput) => VerificationResult}
 */
export function createCallbackVerifier(options) {
  const {
    domain,
    keyring,
    nonceStore,
    validatePayload,
    maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
    maxFutureSeconds = DEFAULT_MAX_FUTURE_SECONDS,
  } = options;
  assertDomain(domain);
  if (!(keyring instanceof Map) || keyring.size === 0) {
    throw new TypeError("keyring must be a non-empty Map");
  }
  if (typeof validatePayload !== "function") {
    throw new TypeError("validatePayload is required");
  }
  for (const [name, value, max] of /** @type {const} */ ([
    ["maxBodyBytes", maxBodyBytes, 1024 * 1024],
    ["maxAgeSeconds", maxAgeSeconds, 3600],
    ["maxFutureSeconds", maxFutureSeconds, 600],
  ])) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new RangeError(`${name} must be an integer between 1 and ${max}`);
    }
  }

  /**
   * @param {VerificationFailure} reason
   * @returns {VerificationResult}
   */
  const reject = (reason) => ({ ok: false, reason });

  return function verifyCallback({ headers, body, now }) {
    assertEpochSeconds(now, "receiver time");
    if (!(body instanceof Uint8Array)) {
      return reject("invalid_body_type");
    }
    if (body.byteLength > maxBodyBytes) {
      return reject("body_too_large");
    }

    const normalized = normalizeHeaders(headers);
    if (typeof normalized === "string") {
      return reject(normalized);
    }
    const keyId = normalized.get(SIGNATURE_HEADERS.keyId);
    const time = normalized.get(SIGNATURE_HEADERS.timestamp);
    const nonce = normalized.get(SIGNATURE_HEADERS.nonce);
    const signatureHeader = normalized.get(SIGNATURE_HEADERS.signature);
    if (
      keyId === undefined ||
      time === undefined ||
      nonce === undefined ||
      signatureHeader === undefined
    ) {
      return reject("missing_header");
    }
    if (!KEY_ID.test(keyId)) {
      return reject("invalid_key_id");
    }
    if (!TIMESTAMP.test(time)) {
      return reject("invalid_timestamp");
    }
    if (!NONCE.test(nonce)) {
      return reject("invalid_nonce");
    }
    const encoded = SIGNATURE.exec(signatureHeader)?.[1];
    const signature = encoded === undefined ? undefined : Buffer.from(encoded, "base64url");
    if (!signature || signature.toString("base64url") !== encoded) {
      return reject("invalid_signature_encoding");
    }

    const timestamp = Number(time);
    if (timestamp < now - maxAgeSeconds) {
      return reject("stale_timestamp");
    }
    if (timestamp > now + maxFutureSeconds) {
      return reject("future_timestamp");
    }

    const entry = /** @type {ReadonlyMap<string, VerificationKey>} */ (keyring).get(keyId);
    if (!entry) {
      return reject("unknown_key_id");
    }
    if (signature.length !== SIGNATURE_BYTES[entry.algorithm]) {
      return reject("invalid_signature_encoding");
    }
    const input = signingInput(domain, keyId, time, nonce, body);
    const valid =
      entry.algorithm === "ed25519"
        ? verify(null, input, entry.key, signature)
        : timingSafeEqual(createHmac("sha256", entry.key).update(input).digest(), signature);
    if (!valid) {
      return reject("signature_mismatch");
    }

    let payload;
    try {
      payload = parseCanonicalJsonBytes(body);
    } catch (error) {
      if (error instanceof JsonError) {
        return reject(error.code);
      }
      throw error;
    }
    if (payload.domain !== domain || payload.environment !== SIMULATOR_ENVIRONMENT) {
      return reject("domain_mismatch");
    }
    if (validatePayload(payload) !== null) {
      return reject("invalid_payload");
    }

    const outcome = nonceStore.record(
      nonce,
      timestamp + maxAgeSeconds + maxFutureSeconds,
      now,
    );
    if (outcome === "replayed") {
      return reject("replayed_nonce");
    }
    if (outcome === "full") {
      return reject("nonce_store_full");
    }
    return { ok: true, payload, keyId, timestamp, nonce };
  };
}

/**
 * HTTP header names are case-insensitive, so names that collide after
 * lowercasing are ambiguous and rejected. Values are taken verbatim: no
 * trimming, no list folding.
 *
 * @param {unknown} headers
 * @returns {Map<string, string> | "invalid_headers" | "duplicate_header"}
 */
function normalizeHeaders(headers) {
  if (headers === null || typeof headers !== "object" || Array.isArray(headers)) {
    return "invalid_headers";
  }
  const prototype = Object.getPrototypeOf(headers);
  if (prototype !== Object.prototype && prototype !== null) {
    return "invalid_headers";
  }
  /** @type {Map<string, string>} */
  const result = new Map();
  for (const name of Object.keys(headers)) {
    const descriptor = Object.getOwnPropertyDescriptor(headers, name);
    const value = descriptor && "value" in descriptor ? descriptor.value : undefined;
    if (typeof value !== "string" || value.length > MAX_HEADER_VALUE) {
      return "invalid_headers";
    }
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) {
      return "invalid_headers";
    }
    const lower = name.toLowerCase();
    if (result.has(lower)) {
      return "duplicate_header";
    }
    result.set(lower, value);
  }
  return result;
}
