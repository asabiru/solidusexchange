import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatScaledDecimal,
  isScaledDecimal,
  parseScaledDecimal,
} from "../src/decimal.mjs";

describe("scaled decimal validation", () => {
  test("canonical strings at or under the scale are accepted", () => {
    for (const value of ["0", "1", "90", "0.1", "0.00000001", "123.45", "999999999999999999"]) {
      assert.equal(isScaledDecimal(value, 8), true, value);
    }
    assert.equal(isScaledDecimal("0.000000001", 9), true);
    assert.equal(isScaledDecimal("42", 0), true);
  });

  test("non-canonical and over-precision inputs are rejected", () => {
    for (const value of [
      "",
      "-1",
      "+1",
      "01",
      "1.",
      ".5",
      "1e3",
      "1E-2",
      "1_000",
      " 1",
      "1 ",
      "0x10",
      "١",
      "１２",
      "1.000000001",
      "0.0000000001",
      "1000000000000000000",
      "9999999999999999999",
    ]) {
      assert.equal(isScaledDecimal(value, 8), false, value);
    }
    assert.equal(isScaledDecimal("1.5", 0), false);
  });

  test("non-string values are rejected", () => {
    for (const value of [1, 1.5, 0, 1n, true, null, undefined, {}, [], NaN]) {
      assert.equal(isScaledDecimal(value, 8), false, String(value));
    }
  });

  test("scale outside 0..18 is rejected", () => {
    assert.equal(isScaledDecimal("1", -1), false);
    assert.equal(isScaledDecimal("1", 19), false);
    assert.equal(isScaledDecimal("1", 1.5), false);
    assert.throws(() => parseScaledDecimal("1", -1), RangeError);
    assert.throws(() => parseScaledDecimal("1", 19), RangeError);
    assert.throws(() => formatScaledDecimal(1n, 19), RangeError);
  });

  test("parse and format round-trip through exact-scale minor units", () => {
    assert.equal(parseScaledDecimal("0.00000001", 8), 1n);
    assert.equal(parseScaledDecimal("1", 8), 100_000_000n);
    assert.equal(parseScaledDecimal("0.1", 8), 10_000_000n);
    assert.equal(parseScaledDecimal("90.00000000", 8), 9_000_000_000n);
    assert.equal(parseScaledDecimal("3.200000", 6), 3_200_000n);
    assert.equal(parseScaledDecimal("7", 0), 7n);
    assert.equal(formatScaledDecimal(1n, 8), "0.00000001");
    assert.equal(formatScaledDecimal(100_000_000n, 8), "1.00000000");
    assert.equal(formatScaledDecimal(10_000_000n, 8), "0.10000000");
    assert.equal(formatScaledDecimal(7n, 0), "7");
    assert.equal(formatScaledDecimal(0n, 6), "0.000000");
    const value = "123456789.00000001";
    assert.equal(formatScaledDecimal(parseScaledDecimal(value, 8), 8), value);
  });

  test("parsing failures throw, never coerce", () => {
    assert.throws(() => parseScaledDecimal(1.5, 8), TypeError);
    assert.throws(() => parseScaledDecimal("abc", 8), TypeError);
    assert.throws(() => parseScaledDecimal("-1", 8), TypeError);
    assert.throws(() => parseScaledDecimal("0.000000001", 8), TypeError);
    assert.throws(() => formatScaledDecimal(-1n, 8), TypeError);
    assert.throws(() => formatScaledDecimal("5", 8), TypeError);
    assert.throws(() => formatScaledDecimal(10n ** 26n, 8), RangeError);
  });
});
