import type { KycStatus } from "../shared/api.js";

/**
 * Shared guards for the served-view adapters. Every /bff payload is untrusted
 * input: a view renders only when its keys, ids, enums and decimals match the
 * contract view model exactly, and the rendered list stays bounded. A foreign
 * or malformed view resolves to undefined — the sheet fails closed to its
 * load-failed state instead of rendering drifted fields (mirrors money-flow.ts).
 */
export const servedRowsLimit = 50;

export interface ServedRows<T> {
  rows: readonly T[];
  /** Row count before the served cap applied — drives the truncation note. */
  total: number;
}

export interface ServedKycRows<T> extends ServedRows<T> {
  kyc: KycStatus;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Exact keys allowing a fixed set of optional members (each still validated when present). */
export function hasContractKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

export function isEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonNegativeInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isKycFlag(value: unknown): value is KycStatus {
  return value === "verified" || value === "kyc-gated";
}

export function boundedRows<T>(rows: readonly T[]): ServedRows<T> {
  return { rows: rows.slice(0, servedRowsLimit), total: rows.length };
}
