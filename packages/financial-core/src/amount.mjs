const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function parseAmount(value, scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new TypeError("Asset scale must be an integer between 0 and 18.");
  }
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new TypeError("Amount must be a non-negative canonical decimal string.");
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) {
    throw new RangeError("Amount exceeds the configured asset scale.");
  }
  if (whole.length + fraction.length > 78) {
    throw new RangeError("Amount exceeds the ledger precision limit.");
  }

  const minorUnits = BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  if (minorUnits <= 0n) {
    throw new RangeError("Ledger entry amount must be greater than zero.");
  }
  return minorUnits;
}

export function formatAmount(minorUnits, scale) {
  if (typeof minorUnits !== "bigint") {
    throw new TypeError("Minor-unit amount must be a bigint.");
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new TypeError("Asset scale must be an integer between 0 and 18.");
  }

  const sign = minorUnits < 0n ? "-" : "";
  const digits = (minorUnits < 0n ? -minorUnits : minorUnits).toString();
  if (scale === 0) return `${sign}${digits}`;
  const padded = digits.padStart(scale + 1, "0");
  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}
