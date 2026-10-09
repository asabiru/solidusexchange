import { randomBytes } from "node:crypto";

export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isUuidV7(value) {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

export function generateUuidV7(nowMs = Date.now()) {
  const bytes = randomBytes(16);
  // BigInt() throws on non-integer or non-finite input (for example a caller
  // passing performance.now), and callers invoke this outside the request
  // pipeline's error boundary, so the id stays generatable for any clock drift.
  let timestamp = BigInt(Number.isFinite(nowMs) ? Math.trunc(nowMs) : 0);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
