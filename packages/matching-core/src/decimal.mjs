/**
 * Exact decimal-string handling for the matching engine. Prices and
 * quantities are never JavaScript numbers: they are canonical decimal
 * strings converted to bigint minor units for all arithmetic, mirroring
 * packages/financial-core/src/amount.mjs and
 * packages/provider-simulators/src/decimal.mjs.
 */

export const PRICE_SCALE = 8;
const MAX_SCALE = 18;
const MAX_INTEGER_DIGITS = 18;
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * A canonical non-negative decimal string with at most `scale` fraction
 * digits: no sign, no exponent, no leading zeros, no trailing point.
 *
 * @param {unknown} value
 * @param {number} scale
 * @returns {value is string}
 */
export function isScaledDecimal(value, scale) {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    return false;
  }
  if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
    return false;
  }
  const point = value.indexOf(".");
  const fraction = point === -1 ? "" : value.slice(point + 1);
  if (fraction.length > scale) {
    return false;
  }
  const whole = point === -1 ? value : value.slice(0, point);
  return whole.length + fraction.length <= MAX_INTEGER_DIGITS;
}

/**
 * Parses a canonical non-negative decimal string into bigint minor units at
 * `scale`, right-padding the fraction. Inputs with more precision than the
 * scale allows are rejected, never rounded.
 *
 * @param {unknown} value
 * @param {number} scale
 * @returns {bigint}
 */
export function parseScaledDecimal(value, scale) {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError("scale must be an integer between 0 and 18");
  }
  if (!isScaledDecimal(value, scale)) {
    throw new TypeError(`decimal must be canonical with at most ${scale} fraction digits`);
  }
  const text = /** @type {string} */ (value);
  const point = text.indexOf(".");
  const whole = point === -1 ? text : text.slice(0, point);
  const fraction = point === -1 ? "" : text.slice(point + 1);
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
}

/**
 * Formats bigint minor units as a canonical decimal string with exactly
 * `scale` fraction digits.
 *
 * @param {bigint} units
 * @param {number} scale
 * @returns {string}
 */
export function formatScaledDecimal(units, scale) {
  if (typeof units !== "bigint" || units < 0n) {
    throw new TypeError("units must be a non-negative bigint");
  }
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError("scale must be an integer between 0 and 18");
  }
  const digits = units.toString().padStart(scale + 1, "0");
  if (digits.length - scale > MAX_INTEGER_DIGITS) {
    throw new RangeError("decimal exceeds the supported integer digits");
  }
  return scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
