import type { CheckPreview, CheckStatusEntry, CheckView } from "../shared/api.js";
import { isCheckDirection, isCheckStatus } from "../shared/checks.js";
import { assetMetaOf } from "../shared/assets.js";
import { isDecimalString } from "../shared/decimal.js";
import { boundedRows, hasContractKeys, hasExactKeys, isEpochMs, isNonNegativeInt, isRecord, type ServedRows } from "./served-views.js";

/**
 * Served-view adapters for the checks sheet: the collection, the member read
 * (rendered under the sheet idiom) and the issuance preview are all untrusted
 * payloads. Exact keys, contract ids, enums and decimal grammar must hold —
 * a foreign view resolves to undefined so the sheet fails closed to its
 * load-failed state rather than rendering drifted fields.
 */

const checkReferencePattern = /^chk_[0-9a-f]{24}$/;
const checkPreviewIdPattern = /^CHK-[0-9A-F]{12}$/;
const checkUnavailableReasons = new Set(["dev_test_version"]);

function isTimelineStep(value: unknown): value is CheckStatusEntry {
  return (
    isRecord(value)
    && hasExactKeys(value, ["status", "at"])
    && typeof value.status === "string"
    && isCheckStatus(value.status)
    && isEpochMs(value.at)
  );
}

const checkViewKeys = [
  "reference",
  "mode",
  "direction",
  "status",
  "asset",
  "amount",
  "fee",
  "total",
  "claimRule",
  "timeline",
  "createdAt",
  "expiresAt",
  "executable",
  "executionUnavailableReason"
] as const;

/** Validates one served check member (collection row or detail read). */
export function checkViewOf(value: unknown): CheckView | undefined {
  if (!isRecord(value) || !hasContractKeys(value, checkViewKeys, ["comment"])) return undefined;
  if (typeof value.asset !== "string") return undefined;
  const meta = assetMetaOf(value.asset);
  if (meta === undefined) return undefined;
  if (
    typeof value.reference !== "string"
    || !checkReferencePattern.test(value.reference)
    || value.mode !== "test"
    || typeof value.direction !== "string"
    || !isCheckDirection(value.direction)
    || typeof value.status !== "string"
    || !isCheckStatus(value.status)
    || typeof value.amount !== "string"
    || !isDecimalString(value.amount, meta.scale)
    || typeof value.fee !== "string"
    || !isDecimalString(value.fee, meta.scale)
    || typeof value.total !== "string"
    || !isDecimalString(value.total, meta.scale)
    || value.claimRule !== "personal"
    || (value.comment !== undefined && typeof value.comment !== "string")
    || !Array.isArray(value.timeline)
    || !(value.timeline as readonly unknown[]).every(isTimelineStep)
    || !isEpochMs(value.createdAt)
    || !isEpochMs(value.expiresAt)
    || value.executable !== false
    || !checkUnavailableReasons.has(value.executionUnavailableReason as string)
  ) {
    return undefined;
  }
  return value as unknown as CheckView;
}

/** Validates the served checks collection, bounding the rendered history. */
export function checksViewOf(view: unknown): ServedRows<CheckView> | undefined {
  if (
    !isRecord(view)
    || !hasExactKeys(view, ["mode", "checks"])
    || view.mode !== "test"
    || !Array.isArray(view.checks)
    || !(view.checks as readonly unknown[]).every((member) => checkViewOf(member) !== undefined)
  ) {
    return undefined;
  }
  return boundedRows(view.checks as readonly CheckView[]);
}

const previewKeys = [
  "id",
  "mode",
  "asset",
  "amount",
  "fee",
  "feeAsset",
  "feeBps",
  "total",
  "claimRule",
  "issuedAt",
  "expiresAt",
  "ttlSeconds",
  "serverTime",
  "insufficientBalance",
  "kycRequired",
  "executable",
  "executionUnavailableReason"
] as const;

/**
 * Validates the issuance preview: the CHK- id, the asset/fees' decimal
 * grammar at the declared asset scale, and the literal flags. executable must
 * be a boolean — the sheet already keeps previews non-executable.
 */
export function checkPreviewOf(value: unknown): CheckPreview | undefined {
  if (!isRecord(value) || !hasExactKeys(value, previewKeys)) return undefined;
  if (typeof value.asset !== "string" || typeof value.feeAsset !== "string") return undefined;
  const meta = assetMetaOf(value.asset);
  const feeMeta = assetMetaOf(value.feeAsset);
  if (meta === undefined || feeMeta === undefined) return undefined;
  if (
    typeof value.id !== "string"
    || !checkPreviewIdPattern.test(value.id)
    || value.mode !== "test"
    || typeof value.amount !== "string"
    || !isDecimalString(value.amount, meta.scale)
    || typeof value.fee !== "string"
    || !isDecimalString(value.fee, feeMeta.scale)
    || !isNonNegativeInt(value.feeBps)
    || typeof value.total !== "string"
    || !isDecimalString(value.total, meta.scale)
    || value.claimRule !== "personal"
    || !isEpochMs(value.issuedAt)
    || !isEpochMs(value.expiresAt)
    || !isNonNegativeInt(value.ttlSeconds)
    || !isEpochMs(value.serverTime)
    || typeof value.insufficientBalance !== "boolean"
    || typeof value.kycRequired !== "boolean"
    || value.executable !== false
    || !checkUnavailableReasons.has(value.executionUnavailableReason as string)
  ) {
    return undefined;
  }
  return value as unknown as CheckPreview;
}
