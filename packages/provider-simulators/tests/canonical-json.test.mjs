import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canonicalStringify,
  decodeStrictUtf8,
  JsonError,
  MAX_JSON_DEPTH,
  parseCanonicalJsonBytes,
  parseStrictJson,
} from "../src/index.mjs";

const bytes = (text) => Buffer.from(text, "utf8");
const code = (expected) => (error) => error instanceof JsonError && error.code === expected;

describe("canonicalStringify", () => {
  test("sorts keys recursively and emits no whitespace", () => {
    assert.equal(canonicalStringify({ b: 1, a: [{ d: null, c: true }], é: "x" }), '{"a":[{"c":true,"d":null}],"b":1,"é":"x"}');
  });

  test("rejects values that have no single canonical spelling", () => {
    for (const value of [1.5, 0.1, -0, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, 1n, undefined, Symbol("s"), () => 1]) {
      assert.throws(() => canonicalStringify({ value }), code("non_canonical_json"), String(typeof value));
    }
    assert.throws(() => canonicalStringify({ value: "e\u0301" }), code("non_canonical_json"));
    assert.throws(() => canonicalStringify({ value: "\ud800" }), code("lone_surrogate"));
    assert.throws(() => canonicalStringify({ value: new Date(0) }), code("non_canonical_json"));
    assert.throws(() => canonicalStringify({ value: new Map() }), code("non_canonical_json"));
    // biome-ignore lint/suspicious/noSparseArray: sparse arrays must be rejected
    assert.throws(() => canonicalStringify({ value: [1, , 2] }), code("non_canonical_json"));
    const accessor = {};
    Object.defineProperty(accessor, "a", { enumerable: true, get: () => 1 });
    assert.throws(() => canonicalStringify(accessor), code("non_canonical_json"));
    assert.throws(() => canonicalStringify({ [Symbol("k")]: 1 }), code("non_canonical_json"));
    let deep = {};
    for (let index = 0; index <= MAX_JSON_DEPTH; index += 1) {
      deep = { deep };
    }
    assert.throws(() => canonicalStringify(deep), code("nesting_too_deep"));
  });
});

describe("strict UTF-8 and JSON parsing", () => {
  test("rejects malformed, overlong and surrogate UTF-8 and BOMs", () => {
    for (const sequence of [[0xc3, 0x28], [0xc0, 0xaf], [0xe0, 0x80, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xff], [0x80]]) {
      assert.throws(() => decodeStrictUtf8(Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, ...sequence, 0x22, 0x7d])), code("invalid_utf8"));
    }
    assert.throws(() => decodeStrictUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), code("byte_order_mark"));
  });

  test("rejects duplicate keys, including escape-spelled duplicates", () => {
    assert.throws(() => parseStrictJson('{"a":1,"a":1}'), code("duplicate_key"));
    assert.throws(() => parseStrictJson('{"a":1,"\\u0061":2}'), code("duplicate_key"));
    assert.throws(() => parseStrictJson('{"x":{"b":1,"b":2}}'), code("duplicate_key"));
    assert.throws(() => parseStrictJson('{"__proto__":1,"__proto__":2}'), code("duplicate_key"));
    assert.deepEqual(Object.keys(parseStrictJson('{"__proto__":1}')), ["__proto__"]);
  });

  test("rejects lone surrogate escapes and deep nesting", () => {
    assert.throws(() => parseStrictJson('{"a":"\\ud800"}'), code("lone_surrogate"));
    assert.throws(() => parseStrictJson('{"a":"\\udc00x"}'), code("lone_surrogate"));
    assert.equal(parseStrictJson('{"a":"\\ud83d\\ude00"}').a, "\u{1f600}");
    assert.throws(() => parseStrictJson(`${'{"a":'.repeat(MAX_JSON_DEPTH + 1)}1${"}".repeat(MAX_JSON_DEPTH + 1)}`), code("nesting_too_deep"));
  });

  test("rejects invalid JSON grammar", () => {
    for (const text of ['{"a":1,}', "{'a':1}", '{"a":01}', '{"a":1}x', '{"a":"\t"}', '{"a":"\\x41"}', '{"a":tru}', '{"a" 1}', '{"a":[1 2]}', "", '{"a":"\\u12"}', '{"a":NaN}']) {
      assert.throws(() => parseStrictJson(text), code("invalid_json"), text);
    }
  });

  test("parseCanonicalJsonBytes accepts only the canonical spelling", () => {
    assert.deepEqual({ ...parseCanonicalJsonBytes(bytes('{"a":1,"b":"é"}')) }, { a: 1, b: "é" });
    const variants = [
      '{"b":"é","a":1}',
      '{ "a":1,"b":"é"}',
      '{"a":1,"b":"é"}\n',
      '{"a":1,"b":"é"}\r\n',
      '{"a":1,\t"b":"é"}',
      '{"a":1.0,"b":"é"}',
      '{"a":1e0,"b":"é"}',
      '{"a":-0,"b":"é"}',
      '{"a":1,"b":"\\u00e9"}',
      '{"a":1,"b":"\\u00E9"}',
      '{"a":1,"b":"e\u0301"}',
      '{"\\u0061":1,"b":"é"}',
      '{"a":1,"b":"\\/"}',
      '{"a":1,"b":"\u001f"}'.replace("\u001f", "\\u001F"),
      '{"a":9007199254740993,"b":"é"}',
    ];
    for (const text of variants) {
      assert.throws(() => parseCanonicalJsonBytes(bytes(text)), (error) => error instanceof JsonError, text);
    }
    assert.throws(() => parseCanonicalJsonBytes(bytes("[1]")), code("invalid_json"));
    assert.throws(() => parseCanonicalJsonBytes(bytes('"a"')), code("invalid_json"));
    assert.equal(parseCanonicalJsonBytes(bytes('{"a":"\\u001f"}')).a, "\u001f");
  });
});
