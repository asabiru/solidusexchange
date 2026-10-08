import { type CheckDirection, type CheckStatus, isCheckDirection, isCheckStatus } from "../shared/checks.js";
import type { MessageKey } from "./i18n.js";

export interface CheckStatusBadge {
  label: MessageKey;
  tone: string;
}

const statusBadges: Readonly<Record<CheckStatus, CheckStatusBadge>> = {
  created: { label: "checks.statusCreated", tone: "warning" },
  awaiting_recipient_kyc: { label: "checks.statusAwaitingKyc", tone: "warning" },
  claimed: { label: "checks.statusClaimed", tone: "success" },
  cancelled: { label: "checks.statusCancelled", tone: "muted" },
  expired: { label: "checks.statusExpired", tone: "muted" }
};

const directionKeys: Readonly<Record<CheckDirection, MessageKey>> = {
  sent: "checks.sent",
  received: "checks.received"
};

/**
 * Server-provided check fields are untrusted input: only declared members map
 * to a badge, so a foreign status or a prototype member such as "constructor"
 * falls back instead of dereferencing a non-badge value.
 */
export function checkStatusBadge(status: string): CheckStatusBadge | undefined {
  return isCheckStatus(status) ? statusBadges[status] : undefined;
}

export function checkDirectionKey(direction: string): MessageKey | undefined {
  return isCheckDirection(direction) ? directionKeys[direction] : undefined;
}
