import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareDecimal,
  DecimalError,
  divideRounded,
  formatDecimal,
  fromUnits,
  isDecimalString,
  normalizeAmountInput,
  rescaleUnits,
  toUnits
} from "./decimal.js";

const nbsp = "\u00a0";
const minus = "\u2212";

describe("decimal strings", () => {
  it("converts decimal strings to integer units without floats", () => {
    assert.equal(toUnits("84200.5", 2), 8_420_050n);
    assert.equal(toUnits("0.000000001", 9), 1n);
    assert.equal(toUnits("12", 6), 12_000_000n);
    assert.equal(
      toUnits("123456789012345678901.123456789", 9),
      123_456_789_012_345_678_901_123_456_789n
    );
  });

  it("rejects non-canonical, exponent and over-precise input", () => {
    for (const value of ["", "-1", "1e3", ".5", "01", "1.", "1,5", " 1", "0x10", "NaN", "Infinity"]) {
      assert.throws(() => toUnits(value, 6), DecimalError, value);
      assert.equal(isDecimalString(value, 6), false, value);
    }
    assert.throws(() => toUnits("1.001", 2), DecimalError);
    assert.equal(isDecimalString("1.001", 2), false);
    assert.equal(isDecimalString("1.00", 2), true);
  });

  it("renders units back to canonical strings", () => {
    assert.equal(fromUnits(8_420_050n, 2), "84200.50");
    assert.equal(fromUnits(1n, 9), "0.000000001");
    assert.equal(fromUnits(0n, 0), "0");
    assert.equal(fromUnits(-150n, 2), "-1.50");
  });

  it("divides and rescales with explicit rounding", () => {
    assert.equal(divideRounded(10n, 3n, "down"), 3n);
    assert.equal(divideRounded(10n, 3n, "up"), 4n);
    assert.equal(divideRounded(10n, 4n, "half-up"), 3n);
    assert.equal(divideRounded(9n, 4n, "half-up"), 2n);
    assert.throws(() => divideRounded(1n, 0n, "down"), DecimalError);
    assert.equal(rescaleUnits(123_456n, 4, 2, "half-up"), 1_235n);
    assert.equal(rescaleUnits(-123_456n, 4, 2, "down"), -1_234n);
    assert.equal(rescaleUnits(12n, 0, 3, "down"), 12_000n);
  });

  it("compares decimals at a fixed scale", () => {
    assert.equal(compareDecimal("1.10", "1.1", 2), 0);
    assert.equal(compareDecimal("0.99", "1", 2), -1);
    assert.equal(compareDecimal("1000000000000000000000.01", "1000000000000000000000", 2), 1);
  });
});

describe("decimal formatting", () => {
  it("groups thousands with a non-breaking space and uses a decimal comma", () => {
    assert.equal(formatDecimal("128450", { fractionDigits: 2 }), `128${nbsp}450,00`);
    assert.equal(formatDecimal("84200.5", { fractionDigits: 2 }), `84${nbsp}200,50`);
    assert.equal(formatDecimal("1234567.891", { fractionDigits: 2 }), `1${nbsp}234${nbsp}567,89`);
    assert.equal(formatDecimal("999", { fractionDigits: 0 }), "999");
  });

  it("rounds half-up on the string representation", () => {
    assert.equal(formatDecimal("0.005", { fractionDigits: 2 }), "0,01");
    assert.equal(formatDecimal("0.004999", { fractionDigits: 2 }), "0,00");
    assert.equal(formatDecimal("271.145", { fractionDigits: 2 }), "271,15");
    assert.equal(formatDecimal("9999.995", { fractionDigits: 2 }), `10${nbsp}000,00`);
  });

  it("keeps precision that IEEE-754 doubles would lose", () => {
    assert.equal(
      formatDecimal("9007199254740993.123456789", { fractionDigits: 9 }),
      `9${nbsp}007${nbsp}199${nbsp}254${nbsp}740${nbsp}993,123456789`
    );
    assert.equal(formatDecimal("0.1", { fractionDigits: 18 }), "0,100000000000000000");
  });

  it("trims trailing zeros down to the minimum fraction digits", () => {
    assert.equal(formatDecimal("18.250000000", { fractionDigits: 4, minFractionDigits: 2 }), "18,25");
    assert.equal(formatDecimal("20.000000000", { fractionDigits: 4, minFractionDigits: 0 }), "20");
    assert.equal(formatDecimal("0.123400", { fractionDigits: 6, minFractionDigits: 2 }), "0,1234");
  });

  it("renders signs with a typographic minus and optional plus", () => {
    assert.equal(formatDecimal("-11028", { fractionDigits: 0 }), `${minus}11${nbsp}028`);
    assert.equal(formatDecimal("120", { fractionDigits: 2, signDisplay: "always" }), "+120,00");
    assert.equal(formatDecimal("0", { fractionDigits: 2, signDisplay: "always" }), "0,00");
    assert.equal(formatDecimal("-0.001", { fractionDigits: 2 }), "0,00");
  });

  it("rejects values that are not decimal strings", () => {
    for (const value of ["1e5", "abc", "", "--1", "1.2.3"]) {
      assert.throws(() => formatDecimal(value, { fractionDigits: 2 }), DecimalError, value);
    }
  });

  it("normalizes user input with spaces and a decimal comma", () => {
    assert.equal(normalizeAmountInput(`25${nbsp}000,50`), "25000.50");
    assert.equal(normalizeAmountInput(" 1 000 "), "1000");
    assert.equal(isDecimalString(normalizeAmountInput("1,5e3"), 2), false);
  });

  it("parses commas as thousands separators only when the decimal separator is a point", () => {
    const point = { group: ",", decimal: "." };
    const comma = { group: nbsp, decimal: "," };
    assert.equal(normalizeAmountInput("1,000", point), "1000");
    assert.equal(normalizeAmountInput("1,000", comma), "1.000");
    assert.equal(normalizeAmountInput("1,000"), "1.000");
    assert.equal(normalizeAmountInput("10,000,000.25", point), "10000000.25");
    for (const value of ["1,5", "1,0000", "1,000.5,0", "1.000.5", ",000"]) {
      assert.equal(isDecimalString(normalizeAmountInput(value, point), 6), false, value);
    }
  });
});
