import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

export interface SignedEnvelope<T> {
  keyId: string;
  issuedAt: string;
  requestId: string;
  resource: string;
  payload: T;
  signature: string;
}

function canonicalMessage<T>(
  issuedAt: string,
  requestId: string,
  resource: string,
  payload: T
): string {
  return JSON.stringify({ issuedAt, requestId, resource, payload });
}

export class ResponseSigner {
  readonly keyId: string;
  readonly publicJwk: JsonWebKey;
  readonly #privateKey;
  readonly #publicKey;

  constructor() {
    const pair = generateKeyPairSync("ed25519");
    this.#privateKey = pair.privateKey;
    this.#publicKey = pair.publicKey;
    const publicDer = this.#publicKey.export({ type: "spki", format: "der" });
    this.keyId = createHash("sha256").update(publicDer).digest("hex").slice(0, 16);
    this.publicJwk = this.#publicKey.export({ format: "jwk" });
  }

  envelope<T>(resource: string, payload: T, requestId: string): SignedEnvelope<T> {
    const issuedAt = new Date().toISOString();
    const signature = sign(
      null,
      Buffer.from(canonicalMessage(issuedAt, requestId, resource, payload)),
      this.#privateKey
    ).toString("base64url");
    return { keyId: this.keyId, issuedAt, requestId, resource, payload, signature };
  }

  verify<T>(envelope: SignedEnvelope<T>): boolean {
    return verify(
      null,
      Buffer.from(canonicalMessage(
        envelope.issuedAt,
        envelope.requestId,
        envelope.resource,
        envelope.payload
      )),
      this.#publicKey,
      Buffer.from(envelope.signature, "base64url")
    );
  }
}
