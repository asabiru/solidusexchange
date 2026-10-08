export type CheckStatus = "created" | "awaiting_recipient_kyc" | "claimed" | "cancelled" | "expired";

export const checkStatuses: readonly CheckStatus[] = Object.freeze([
  "created",
  "awaiting_recipient_kyc",
  "claimed",
  "cancelled",
  "expired"
]);

export type CheckDirection = "sent" | "received";

/** Opaque synthetic claim reference. In this demo it is a fixed fixture value, never a real secret. */
export const checkReferencePattern = /^chk_[0-9a-f]{24}$/;

export function isCheckReference(value: string): boolean {
  return checkReferencePattern.test(value);
}

/** An unverified recipient sees the check but claiming waits for KYC (per the checks plan). */
export function effectiveCheckStatus(status: CheckStatus, direction: CheckDirection, kyc: "verified" | "kyc-gated"): CheckStatus {
  return status === "created" && direction === "received" && kyc !== "verified" ? "awaiting_recipient_kyc" : status;
}
