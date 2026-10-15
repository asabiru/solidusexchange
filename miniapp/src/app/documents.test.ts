import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentsViewOf } from "./documents.js";

const base: unknown = {
  mode: "test",
  delivery: "disabled",
  documents: [
    {
      id: "doc_0f1e2d3c4b5a69788796a5b4",
      kind: "agreement",
      title: "Agreement",
      status: "available",
      createdAt: 1_790_000_000_000,
      posting: "none"
    }
  ]
};

describe("documents view adapter", () => {
  it("accepts a contract-shaped view and bounds rows", () => {
    const adapted = documentsViewOf(base);
    assert.equal(adapted?.rows.length, 1);
    assert.equal(adapted?.total, 1);
    assert.equal(adapted?.rows[0].id, "doc_0f1e2d3c4b5a69788796a5b4");
  });

  it("fails closed on drift: wrong id space, extra keys, mutable flags", () => {
    assert.equal(documentsViewOf({ ...base as object, extra: 1 }), undefined);
    const doc = (base as { documents: object[] }).documents[0];
    assert.equal(documentsViewOf({ ...base as object, documents: [{ ...doc, id: "tck_0f1e2d3c4b5a69788796a5b4" }] }), undefined);
    assert.equal(documentsViewOf({ ...base as object, documents: [{ ...doc, posting: "queued" }] }), undefined);
    assert.equal(documentsViewOf({ ...base as object, delivery: "telegram" }), undefined);
    assert.equal(documentsViewOf({ ...base as object, documents: [{ ...doc, kind: "passport" }] }), undefined);
    assert.equal(documentsViewOf({ ...base as object, documents: [{ ...doc, status: "signed" }] }), undefined);
    assert.equal(documentsViewOf({ ...base as object, documents: [{ ...doc, createdAt: "yesterday" }] }), undefined);
    assert.equal(documentsViewOf(null), undefined);
    assert.equal(documentsViewOf([]), undefined);
  });
});
