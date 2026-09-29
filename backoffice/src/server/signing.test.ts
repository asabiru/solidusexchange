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

  it("retains bounded verification keys across rotation", () => {
    const provider = new EphemeralSigningKeyProvider(1);
    const signer = new ResponseSigner(provider);
    const first = signer.envelope("dashboard", { value: 1 }, "request-1");
    const firstKeyId = first.keyId;
    provider.rotate(new Date("2026-09-29T14:00:00.000Z"));
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

    provider.rotate(new Date("2026-09-29T15:00:00.000Z"));
    assert.equal(signer.verify(first), false);
    assert.equal(signer.verify(second), true);
  });
});
