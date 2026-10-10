import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify
} from "node:crypto";

// The complete signed field set, sorted; an envelope with any extra or
// missing top-level member is malformed.
const ENVELOPE_FIELDS = [
  "issuedAt",
  "keyId",
  "keyVersion",
  "payload",
  "requestId",
  "resource",
  "signature",
  "signatureVersion"
].sort().join(",");

const CANONICAL_BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_PAYLOAD_DEPTH = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The payload a signature attests must serialize to exactly the canonical
// JSON bytes it claims: anything `JSON.stringify` rewrites (non-finite
// numbers to null, -0 to 0), drops (undefined leaves, sparse arrays) or
// resolves dynamically (accessors, non-plain objects) lets a mutated payload
// keep a valid signature while the consumer reads different data.
function isCanonicalJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_PAYLOAD_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value === "string") return true;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isCanonicalJsonValue(value[index], depth + 1)) {
        return false;
      }
    }
    return true;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (Object.getOwnPropertySymbols(value).length > 0) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !isCanonicalJsonValue(descriptor.value, depth + 1)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export interface SignedEnvelope<T> {
  signatureVersion: 1;
  keyId: string;
  keyVersion: number;
  issuedAt: string;
  requestId: string;
  resource: string;
  payload: T;
  signature: string;
}

export interface PublicSigningKey {
  keyId: string;
  version: number;
  algorithm: "Ed25519";
  status: "active" | "retired";
  createdAt: string;
  retiredAt?: string;
  publicJwk: JsonWebKey;
}

export interface PublicSigningKeyset {
  formatVersion: 1;
  backend: "ephemeral-dev";
  activeKeyId: string;
  keys: readonly PublicSigningKey[];
}

interface SigningKey extends PublicSigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export interface VersionedSigningKeyProvider {
  sign<T>(
    issuedAt: string,
    requestId: string,
    resource: string,
    payload: T
  ): Pick<SignedEnvelope<T>, "signatureVersion" | "keyId" | "keyVersion" | "signature">;
  verify<T>(envelope: SignedEnvelope<T>): boolean;
  publicKeyset(): PublicSigningKeyset;
  publicKey(): PublicSigningKey;
}

function canonicalMessage<T>(
  signatureVersion: 1,
  keyId: string,
  keyVersion: number,
  issuedAt: string,
  requestId: string,
  resource: string,
  payload: T
): string {
  return JSON.stringify({
    signatureVersion,
    keyId,
    keyVersion,
    issuedAt,
    requestId,
    resource,
    payload
  });
}

export class EphemeralSigningKeyProvider {
  readonly #maximumRetiredKeys: number;
  #keys: readonly SigningKey[] = [];

  constructor(maximumRetiredKeys = 2) {
    if (!Number.isInteger(maximumRetiredKeys) || maximumRetiredKeys < 1) {
      throw new Error("At least one retired verification key must be retained");
    }
    this.#maximumRetiredKeys = maximumRetiredKeys;
    this.rotate();
  }

  active(): SigningKey {
    const active = this.#keys.find((key) => key.status === "active");
    if (!active) throw new Error("Active signing key is unavailable");
    return active;
  }

  publicKeyset(): PublicSigningKeyset {
    const active = this.active();
    return {
      formatVersion: 1,
      backend: "ephemeral-dev",
      activeKeyId: active.keyId,
      keys: this.#keys.map(({ privateKey: _privateKey, publicKey: _publicKey, ...key }) => key)
    };
  }

  rotate(now = new Date()): PublicSigningKey {
    if (Number.isNaN(now.valueOf())) throw new Error("Signing key rotation time is invalid");
    const rotatedAt = now.toISOString();
    const pair = generateKeyPairSync("ed25519");
    const publicDer = pair.publicKey.export({ type: "spki", format: "der" });
    const keyId = createHash("sha256").update(publicDer).digest("hex").slice(0, 32);
    const retired = this.#keys.map((key) => key.status === "active"
      ? { ...key, status: "retired" as const, retiredAt: rotatedAt }
      : key);
    const version = Math.max(0, ...retired.map((key) => key.version)) + 1;
    const active: SigningKey = {
      keyId,
      version,
      algorithm: "Ed25519",
      status: "active",
      createdAt: rotatedAt,
      publicJwk: pair.publicKey.export({ format: "jwk" }),
      privateKey: pair.privateKey,
      publicKey: pair.publicKey
    };
    const retained = retired
      .filter((key) => key.status === "retired")
      .sort((left, right) => right.version - left.version)
      .slice(0, this.#maximumRetiredKeys);
    this.#keys = Object.freeze([active, ...retained]);
    return this.publicKey(active);
  }

  sign<T>(
    issuedAt: string,
    requestId: string,
    resource: string,
    payload: T
  ): Pick<SignedEnvelope<T>, "signatureVersion" | "keyId" | "keyVersion" | "signature"> {
    const key = this.active();
    const signatureVersion = 1;
    const signature = sign(
      null,
      Buffer.from(canonicalMessage(
        signatureVersion,
        key.keyId,
        key.version,
        issuedAt,
        requestId,
        resource,
        payload
      )),
      key.privateKey
    ).toString("base64url");
    return {
      signatureVersion,
      keyId: key.keyId,
      keyVersion: key.version,
      signature
    };
  }

  verify<T>(envelope: SignedEnvelope<T>): boolean {
    // Same strict shape the browser verifier enforces: exactly the eight
    // signed fields of canonical JSON types, so unsigned extras or malformed
    // members can never ride inside a valid envelope. Verification is total:
    // anything that is not a well-formed envelope returns false.
    if (!isRecord(envelope)) return false;
    const fields = Object.keys(envelope).sort().join(",");
    if (fields !== ENVELOPE_FIELDS) return false;
    if (
      envelope.signatureVersion !== 1
      || typeof envelope.keyId !== "string"
      || !Number.isSafeInteger(envelope.keyVersion)
      || envelope.keyVersion < 1
      || typeof envelope.issuedAt !== "string"
      || typeof envelope.requestId !== "string"
      || envelope.requestId.length === 0
      || typeof envelope.resource !== "string"
      || typeof envelope.signature !== "string"
      || !CANONICAL_BASE64URL.test(envelope.signature)
    ) {
      return false;
    }
    const signature = Buffer.from(envelope.signature, "base64url");
    if (signature.toString("base64url") !== envelope.signature) return false;
    // `issuedAt` must be a canonical ISO instant so lifecycle checks compare
    // the same instant every verifier sees.
    const issuedAt = Date.parse(envelope.issuedAt);
    const issuedAtDate = new Date(issuedAt);
    if (
      !Number.isFinite(issuedAt)
      || !Number.isFinite(issuedAtDate.valueOf())
      || issuedAtDate.toISOString() !== envelope.issuedAt
    ) {
      return false;
    }
    if (!isCanonicalJsonValue(envelope.payload, 0)) return false;
    const key = this.#keys.find((candidate) => candidate.keyId === envelope.keyId);
    if (!key || key.version !== envelope.keyVersion) return false;
    // A retired key may only attest envelopes issued before it was retired;
    // anything newer means the key material outlived its trust window.
    if (key.status === "retired") {
      const retiredAt = typeof key.retiredAt === "string" ? Date.parse(key.retiredAt) : Number.NaN;
      if (!Number.isFinite(retiredAt) || issuedAt > retiredAt) return false;
    }
    return verify(
      null,
      Buffer.from(canonicalMessage(
        envelope.signatureVersion,
        envelope.keyId,
        envelope.keyVersion,
        envelope.issuedAt,
        envelope.requestId,
        envelope.resource,
        envelope.payload
      )),
      key.publicKey,
      signature
    );
  }

  publicKey(key = this.active()): PublicSigningKey {
    const { privateKey: _privateKey, publicKey: _publicKey, ...publicKey } = key;
    return publicKey;
  }
}

export class ResponseSigner {
  readonly #provider: VersionedSigningKeyProvider;

  constructor(provider: VersionedSigningKeyProvider = new EphemeralSigningKeyProvider()) {
    this.#provider = provider;
  }

  envelope<T>(resource: string, payload: T, requestId: string): SignedEnvelope<T> {
    const issuedAt = new Date().toISOString();
    return {
      ...this.#provider.sign(issuedAt, requestId, resource, payload),
      issuedAt,
      requestId,
      resource,
      payload
    };
  }

  verify<T>(envelope: SignedEnvelope<T>): boolean {
    return this.#provider.verify(envelope);
  }

  publicKeyset(): PublicSigningKeyset {
    return this.#provider.publicKeyset();
  }

  currentPublicKey(): PublicSigningKey {
    return this.#provider.publicKey();
  }
}
