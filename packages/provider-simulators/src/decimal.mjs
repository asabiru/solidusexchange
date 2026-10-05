/**
 * Exact decimal-string money handling. Amounts are never JavaScript numbers:
 * they are canonical strings with exactly the asset scale, converted to
 * bigint minor units for arithmetic.
 */

export const ASSET_SCALES = Object.freeze({ RUB: 2, USDT: 6, TON: 9 });

/** Price and rate scale used by the quote simulator. */
export const PRICE_SCALE = 8;

const MAX_INTEGER_DIGITS = 18;

/** @typedef {keyof typeof ASSET_SCALES} Asset */
/** @typedef {"down" | "up" | "half_even"} RoundingMode */

/**
 * @param {unknown} asset
 * @returns {asset is Asset}
 */
export function isSupportedAsset(asset) {
  return typeof asset === "string" && Object.hasOwn(ASSET_SCALES, asset);
}

/**
 * @param {unknown} asset
 * @returns {number}
 */
export function assetScale(asset) {
  if (!isSupportedAsset(asset)) {
    throw new TypeError("unsupported asset");
  }
  return ASSET_SCALES[asset];
}

/**
 * @param {number} scale
 */
function decimalPattern(scale) {
  const fraction = scale === 0 ? "" : `\\.[0-9]{${scale}}`;
  return new RegExp(`^(?:0|[1-9][0-9]{0,${MAX_INTEGER_DIGITS - 1}})${fraction}$`);
}

/**
 * Parses a canonical non-negative decimal string with exactly `scale`
 * fraction digits into integer units.
 *
 * @param {unknown} value
 * @param {number} scale
 * @returns {bigint}
 */
export function parseDecimal(value, scale) {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError("scale must be an integer between 0 and 18");
  }
  if (typeof value !== "string") {
    throw new TypeError("decimal amounts must be strings, never numbers");
  }
  if (!decimalPattern(scale).test(value)) {
    throw new TypeError(`decimal must be canonical with exactly ${scale} fraction digits`);
  }
  return BigInt(value.replace(".", ""));
}

/**
 * @param {bigint} units
 * @param {number} scale
 * @returns {string}
 */
export function formatDecimal(units, scale) {
  if (typeof units !== "bigint" || units < 0n) {
    throw new TypeError("units must be a non-negative bigint");
  }
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 18) {
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

/**
 * @param {unknown} asset
 * @param {unknown} value
 * @returns {bigint} minor units
 */
export function parseAmount(asset, value) {
  return parseDecimal(value, assetScale(asset));
}

/**
 * @param {unknown} asset
 * @param {unknown} value
 * @returns {bigint} strictly positive minor units
 */
export function parsePositiveAmount(asset, value) {
  const units = parseAmount(asset, value);
  if (units === 0n) {
    throw new RangeError("amount must be greater than zero");
  }
  return units;
}

/**
 * @param {unknown} asset
 * @param {bigint} units
 */
export function formatAmount(asset, units) {
  return formatDecimal(units, assetScale(asset));
}

/**
 * @param {unknown} asset
 * @param {unknown} value
 */
export function isCanonicalAmount(asset, value) {
  try {
    parseAmount(asset, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Non-negative integer division with an explicit rounding mode.
 *
 * @param {bigint} numerator
 * @param {bigint} denominator
 * @param {RoundingMode} mode
 * @returns {bigint}
 */
export function divideRounded(numerator, denominator, mode) {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError("division operands must be non-negative with a positive divisor");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "down") {
    return quotient;
  }
  if (mode === "up") {
    return quotient + 1n;
  }
  if (mode === "half_even") {
    const twice = remainder * 2n;
    if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) {
      return quotient + 1n;
    }
    return quotient;
  }
  throw new RangeError("unknown rounding mode");
}
