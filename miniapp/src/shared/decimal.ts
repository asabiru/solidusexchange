export const groupSeparator = "\u00a0";
export const decimalSeparator = ",";
export const minusSign = "\u2212";

const unsignedPattern = /^(0|[1-9][0-9]{0,29})(?:\.([0-9]{1,30}))?$/;
const signedPattern = /^(-?)(0|[1-9][0-9]{0,29})(?:\.([0-9]{1,30}))?$/;

export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalError";
  }
}

export type Rounding = "down" | "up" | "half-up";

export function isDecimalString(value: string, maxScale: number): boolean {
  const match = unsignedPattern.exec(value);
  return match !== null && (match[2] ?? "").length <= maxScale;
}

export function toUnits(value: string, scale: number): bigint {
  const match = unsignedPattern.exec(value);
  if (!match) throw new DecimalError("Amount must be a non-negative decimal string");
  const fraction = match[2] ?? "";
  if (fraction.length > scale) throw new DecimalError("Amount has too many fraction digits");
  return BigInt(match[1] + fraction.padEnd(scale, "0"));
}

export function fromUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${integer}${scale > 0 ? `.${fraction}` : ""}`;
}

export function divideRounded(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new DecimalError("Division requires a non-negative numerator and positive denominator");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || rounding === "down") return quotient;
  if (rounding === "up") return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function rescaleUnits(
  units: bigint,
  fromScale: number,
  toScale: number,
  rounding: Rounding
): bigint {
  if (toScale >= fromScale) return units * 10n ** BigInt(toScale - fromScale);
  const negative = units < 0n;
  const rounded = divideRounded(
    negative ? -units : units,
    10n ** BigInt(fromScale - toScale),
    rounding
  );
  return negative ? -rounded : rounded;
}

function groupInteger(integer: string): string {
  let grouped = "";
  for (let index = 0; index < integer.length; index += 1) {
    const fromEnd = integer.length - index;
    if (index > 0 && fromEnd % 3 === 0) grouped += groupSeparator;
    grouped += integer[index];
  }
  return grouped;
}

export interface FormatOptions {
  fractionDigits: number;
  minFractionDigits?: number;
  signDisplay?: "auto" | "always";
}

export function formatDecimal(value: string, options: FormatOptions): string {
  const match = signedPattern.exec(value);
  if (!match) throw new DecimalError("Value must be a decimal string");
  const sourceFraction = match[3] ?? "";
  const sourceScale = sourceFraction.length;
  const units = BigInt(match[2] + sourceFraction);
  const rounded = rescaleUnits(units, sourceScale, options.fractionDigits, "half-up");
  const [integer, fullFraction = ""] = fromUnits(rounded, options.fractionDigits).split(".");
  const minFraction = Math.min(options.minFractionDigits ?? options.fractionDigits, options.fractionDigits);
  let fraction = fullFraction;
  while (fraction.length > minFraction && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  const body = `${groupInteger(integer)}${fraction ? `${decimalSeparator}${fraction}` : ""}`;
  if (rounded === 0n) return body;
  if (match[1] === "-") return `${minusSign}${body}`;
  return options.signDisplay === "always" ? `+${body}` : body;
}

export function compareDecimal(left: string, right: string, scale: number): -1 | 0 | 1 {
  const a = toUnits(left, scale);
  const b = toUnits(right, scale);
  return a === b ? 0 : a < b ? -1 : 1;
}

export function normalizeAmountInput(input: string): string {
  return input.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
}
