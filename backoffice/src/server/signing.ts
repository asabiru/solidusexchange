import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify
} from "node:crypto";

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
    const key = this.#keys.find((candidate) => candidate.keyId === envelope.keyId);
    if (!key || key.version !== envelope.keyVersion || envelope.signatureVersion !== 1) {
      return false;
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
      Buffer.from(envelope.signature, "base64url")
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
