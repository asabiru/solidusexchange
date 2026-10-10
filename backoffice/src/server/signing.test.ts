import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EphemeralSigningKeyProvider,
  ResponseSigner
} from "./signing.js";

describe("response signing", () => {
  it("signs immutable response envelope fields", () => {
    const signer = new ResponseSigner();
    const envelope = signer.envelope("dashboard", { value: 42 }, "request-1");
    assert.equal(envelope.signatureVersion, 1);
    assert.equal(envelope.keyVersion, 1);
    assert.equal(signer.verify(envelope), true);
    assert.equal(signer.verify({ ...envelope, payload: { value: 41 } }), false);
    assert.equal(signer.verify({ ...envelope, resource: "customers" }), false);
    assert.equal(signer.verify({ ...envelope, keyVersion: 2 }), false);
    assert.equal(signer.verify({ ...envelope, keyId: "unknown-key" }), false);
    assert.equal(signer.verify({ ...envelope, signatureVersion: 2 as 1 }), false);
  });

  it("rejects envelopes with extra or missing top-level fields", () => {
    const signer = new ResponseSigner();
    const envelope = signer.envelope("dashboard", { value: 42 }, "request-1");
    assert.equal(signer.verify({ ...envelope, isAdmin: true } as typeof envelope), false);
    assert.equal(signer.verify({ ...envelope, bff: "x" } as typeof envelope), false);
    const { requestId: _requestId, ...withoutRequestId } = envelope;
    assert.equal(signer.verify(withoutRequestId as typeof envelope), false);
    assert.equal(signer.verify({ ...envelope, keyVersion: 1.5 }), false);
    assert.equal(signer.verify({ ...envelope, keyVersion: 0 }), false);
  });

  it("rejects payloads whose serialized form differs from what was attested", () => {
    const signer = new ResponseSigner();
    // Minted over {value: null, zero: 0}; JSON.stringify maps
    // Infinity/NaN to null and -0 to 0, so a mutated payload would otherwise
    // reserialize to the identical attested bytes.
    const envelope = signer.envelope("dashboard", { value: null, zero: 0 }, "request-1");
    assert.equal(signer.verify(envelope), true);
    assert.equal(
      signer.verify({ ...envelope, payload: { value: Number.POSITIVE_INFINITY, zero: -0 } }),
      false
    );
    assert.equal(
      signer.verify({ ...envelope, payload: { value: Number.NaN, zero: 0 } }),
      false
    );
    const deep = signer.envelope("dashboard", { nested: { list: [null] } }, "request-2");
    assert.equal(signer.verify(deep), true);
    assert.equal(
      signer.verify({ ...deep, payload: { nested: { list: [Number.NaN] } } }),
      false
    );
  });

  it("rejects non-record envelopes and malformed signature encodings", () => {
    const signer = new ResponseSigner();
    const envelope = signer.envelope("dashboard", { value: 1 }, "request-1");
    // Verification must be total: malformed input returns false rather than
    // throwing out of the boolean contract.
    assert.equal(signer.verify(null as unknown as typeof envelope), false);
    assert.equal(signer.verify(undefined as unknown as typeof envelope), false);
    assert.equal(signer.verify("envelope" as unknown as typeof envelope), false);
    assert.equal(signer.verify([envelope] as unknown as typeof envelope), false);
    assert.equal(signer.verify({ ...envelope, signature: 42 } as unknown as typeof envelope), false);
    // Base64url must be strict: whitespace, padding or foreign characters
    // must not be silently normalized back into a valid signature.
    assert.equal(signer.verify({ ...envelope, signature: ` ${envelope.signature}` }), false);
    assert.equal(signer.verify({ ...envelope, signature: `${envelope.signature} ` }), false);
    assert.equal(signer.verify({ ...envelope, signature: `${envelope.signature}=` }), false);
    assert.equal(signer.verify({ ...envelope, signature: `!${envelope.signature}` }), false);
  });

  it("rejects envelopes attested over malformed metadata fields", () => {
    const provider = new EphemeralSigningKeyProvider();
    const signedOver = <T>(
      issuedAt: string,
      requestId: string,
      resource: string,
      payload: T
    ) => ({
      ...provider.sign(issuedAt, requestId, resource, payload),
      issuedAt,
      requestId,
      resource,
      payload
    });
    const issuedAt = "2026-10-09T12:00:00.000Z";
    assert.equal(provider.verify(signedOver("not-a-date", "request-1", "dashboard", {})), false);
    assert.equal(provider.verify(signedOver("2026-10-09T12:00:00Z", "request-1", "dashboard", {})), false);
    assert.equal(provider.verify(signedOver(issuedAt, "", "dashboard", {})), false);
    assert.equal(provider.verify(signedOver(issuedAt, 42 as unknown as string, "dashboard", {})), false);
    assert.equal(provider.verify(signedOver(issuedAt, "request-1", 7 as unknown as string, {})), false);
    assert.equal(provider.verify(signedOver(issuedAt, "request-1", "dashboard", "json")), true);
  });

  it("rejects envelopes a retired key attests after its retirement", () => {
    const provider = new EphemeralSigningKeyProvider(1);
    const envelopeOver = (issuedAt: string, payload: { value: number }) => ({
      ...provider.sign(issuedAt, "request-1", "dashboard", payload),
      issuedAt,
      requestId: "request-1",
      resource: "dashboard",
      payload
    });
    // Both envelopes are attested while the key is active.
    const beforeRetirement = envelopeOver("2026-10-08T00:00:00.000Z", { value: 1 });
    const afterRetirement = envelopeOver("2999-01-01T00:00:00.000Z", { value: 2 });
    provider.rotate(new Date("2026-10-09T12:00:00.000Z"));
    // The retired key must not attest envelopes claiming an issue time after
    // its retirement.
    assert.equal(provider.verify(beforeRetirement), true);
    assert.equal(provider.verify(afterRetirement), false);
  });

  it("signs deterministically for identical canonical inputs", () => {
    const provider = new EphemeralSigningKeyProvider();
    const payload = { nested: { list: [1, "two", null], flag: true } };
    const first = provider.sign("2026-10-09T12:00:00.000Z", "request-1", "resource", payload);
    const second = provider.sign("2026-10-09T12:00:00.000Z", "request-1", "resource", payload);
    assert.equal(first.signature, second.signature);
    // Any input field change alters the signature.
    const altered = provider.sign("2026-10-09T12:00:00.000Z", "request-2", "resource", payload);
    assert.notEqual(altered.signature, first.signature);
    const alteredResource = provider.sign("2026-10-09T12:00:00.000Z", "request-1", "other", payload);
    assert.notEqual(alteredResource.signature, first.signature);
  });

  it("retains bounded verification keys across rotation", () => {
    const provider = new EphemeralSigningKeyProvider(1);
    const signer = new ResponseSigner(provider);
    const first = signer.envelope("dashboard", { value: 1 }, "request-1");
    const firstKeyId = first.keyId;
    provider.rotate(new Date("2999-09-29T14:00:00.000Z"));
    const second = signer.envelope("dashboard", { value: 2 }, "request-2");
    assert.notEqual(second.keyId, firstKeyId);
    assert.equal(second.keyVersion, 2);
    assert.equal(signer.verify(first), true);
    assert.equal(signer.verify(second), true);

    const keyset = signer.publicKeyset();
    assert.equal(keyset.activeKeyId, second.keyId);
    assert.deepEqual(
      keyset.keys.map((key) => [key.version, key.status]),
      [[2, "active"], [1, "retired"]]
    );

    provider.rotate(new Date("2999-09-29T15:00:00.000Z"));
    assert.equal(signer.verify(first), false);
    assert.equal(signer.verify(second), true);
  });
});
