import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResponseSigner } from "./signing.js";

describe("response signing", () => {
  it("signs immutable response envelope fields", () => {
    const signer = new ResponseSigner();
    const envelope = signer.envelope("dashboard", { value: 42 }, "request-1");
    assert.equal(signer.verify(envelope), true);
    assert.equal(signer.verify({ ...envelope, payload: { value: 41 } }), false);
    assert.equal(signer.verify({ ...envelope, resource: "customers" }), false);
  });
});
