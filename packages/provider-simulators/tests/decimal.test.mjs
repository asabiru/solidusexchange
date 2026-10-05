import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ASSET_SCALES,
  assetScale,
  divideRounded,
  formatAmount,
  isCanonicalAmount,
  parseAmount,
  parseDecimal,
  parsePositiveAmount,
} from "../src/index.mjs";

describe("decimal amounts", () => {
  test("per-asset scales are RUB 2, USDT 6, TON 9", () => {
    assert.deepEqual({ ...ASSET_SCALES }, { RUB: 2, USDT: 6, TON: 9 });
    assert.equal(assetScale("RUB"), 2);
    assert.throws(() => assetScale("BTC"), /unsupported asset/);
    assert.throws(() => assetScale("rub"), /unsupported asset/);
  });

  test("amounts round-trip through integer minor units", () => {
    assert.equal(parseAmount("RUB", "1500.25"), 150025n);
    assert.equal(parseAmount("USDT", "0.000001"), 1n);
    assert.equal(parseAmount("TON", "123.456789012"), 123456789012n);
    assert.equal(formatAmount("RUB", 150025n), "1500.25");
    assert.equal(formatAmount("USDT", 1n), "0.000001");
    assert.equal(formatAmount("TON", 0n), "0.000000000");
    assert.equal(parseAmount("RUB", "999999999999999999.99"), 99999999999999999999n);
  });

  test("numbers and floats are never accepted as money", () => {
    for (const value of [1500, 1500.25, 0.1 + 0.2, 1n, null, undefined, {}, ["1.00"]]) {
      assert.throws(() => parseAmount("RUB", value), /strings, never numbers/);
    }
    assert.throws(() => formatAmount("RUB", 150025), TypeError);
  });

  test("non-canonical decimal spellings are rejected", () => {
    const bad = [
      "1500", "1500.2", "1500.250", "01500.25", "+1500.25", "-1500.25", " 1500.25", "1500.25 ",
      "1500,25", "1_500.25", "1e3", "1.5e2", "0x10.00", ".25", "1500.", "1500.25\n",
      "\u0661\u0665\u0660\u0660.\u0662\u0665", "\uff11\uff15\uff10\uff10.25", "1500\u00a0.25",
      "NaN", "Infinity", "", "1000000000000000000.00",
    ];
    for (const value of bad) {
      assert.equal(isCanonicalAmount("RUB", value), false, JSON.stringify(value));
      assert.throws(() => parseAmount("RUB", value), TypeError, JSON.stringify(value));
    }
    assert.equal(isCanonicalAmount("USDT", "1.00"), false);
    assert.equal(isCanonicalAmount("TON", "1.000000"), false);
    assert.equal(isCanonicalAmount("TON", "1.000000000"), true);
  });

  test("positive amounts reject zero", () => {
    assert.throws(() => parsePositiveAmount("RUB", "0.00"), RangeError);
    assert.equal(parsePositiveAmount("RUB", "0.01"), 1n);
  });

  test("price scale parsing and rounding modes are exact", () => {
    assert.equal(parseDecimal("90.12345678", 8), 9012345678n);
    assert.throws(() => parseDecimal("90.1", 8), TypeError);
    assert.throws(() => parseDecimal("1", 19), RangeError);
    assert.equal(divideRounded(7n, 2n, "down"), 3n);
    assert.equal(divideRounded(7n, 2n, "up"), 4n);
    assert.equal(divideRounded(5n, 2n, "half_even"), 2n);
    assert.equal(divideRounded(7n, 2n, "half_even"), 4n);
    assert.equal(divideRounded(8n, 3n, "half_even"), 3n);
    assert.equal(divideRounded(6n, 2n, "up"), 3n);
    assert.throws(() => divideRounded(-1n, 2n, "down"), RangeError);
    assert.throws(() => divideRounded(1n, 0n, "down"), RangeError);
    assert.throws(() => divideRounded(1n, 2n, "sideways"), RangeError);
  });
});
