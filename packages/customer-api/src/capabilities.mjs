// Deny-by-default customer capability policy. Every financial capability stays
// disabled: README stop condition 4 forbids money-moving endpoints until
// idempotency, policy decision, immutable audit, ledger effect and
// reconciliation exist, and the referenced decisions are still open.
// CapabilitiesView has no field for denial reasons, so only granted
// capabilities are returned to clients.

/** @type {readonly string[]} */
export const KYC_STATUSES = Object.freeze(["unverified", "pending", "verified"]);

export const REASON_CODES = Object.freeze({
  financialCommandsDisabled: "FINANCIAL_COMMANDS_DISABLED",
  kycVerificationRequired: "KYC_VERIFICATION_REQUIRED",
  operationNotImplemented: "OPERATION_NOT_IMPLEMENTED"
});

/** @param {string} decisionId */
export function decisionReasonCode(decisionId) {
  return `DECISION_${decisionId.replace("-", "_")}_OPEN`;
}

/**
 * @param {string} capability
 * @param {"read" | "onboarding" | "financial"} kind
 * @param {boolean} requiresVerifiedKyc
 * @param {string[]} decisions
 */
function entry(capability, kind, requiresVerifiedKyc, decisions) {
  return Object.freeze({
    capability,
    kind,
    requiresVerifiedKyc,
    decisions: Object.freeze(decisions)
  });
}

export const CAPABILITY_POLICY = Object.freeze([
  entry("customer.session.read", "read", false, []),
  entry("customer.capabilities.read", "read", false, []),
  // The KYC status read is the onboarding surface itself: it must stay
  // readable for unverified and pending subjects or they could never see the
  // state that gates everything else (a verified-KYC requirement would
  // deadlock onboarding). This mirrors the miniapp, which serves
  // /bff/kyc/status to kyc-gated sessions too. The submit side stays an
  // unserved onboarding capability below.
  entry("customer.kyc.read", "read", false, []),
  entry("customer.kyc.submit", "onboarding", false, ["D-001", "D-008"]),
  // The served profile read is the customer's own synthetic identity surface
  // (display name, locale, registration date — never real PII), not a
  // collection read on assets or activity: the miniapp serves /bff/profile
  // to every authenticated session, kyc-gated included, degrading apiAccess
  // in place instead of gating. Like the KYC status read it must stay
  // readable without a verified KYC status.
  entry("customer.profile.read", "read", false, []),
  // The served wallet collection read is KYC-gated but synthetic: it needs no
  // open money-movement decisions (D-001/D-002/D-014 keep gating financial ops).
  entry("customer.wallets.read", "read", true, []),
  // The served notification collection read is likewise KYC-gated synthetic
  // data (mirrors the miniapp's KYC-gated notifications feed), not a financial
  // capability: notifications is not a money namespace.
  entry("customer.notifications.read", "read", true, []),
  entry("customer.deposits.create", "financial", true, [
    "D-001",
    "D-002",
    "D-011",
    "D-014"
  ]),
  entry("customer.withdrawals.create", "financial", true, [
    "D-001",
    "D-002",
    "D-003",
    "D-011",
    "D-014"
  ]),
  entry("customer.quotes.create", "financial", true, ["D-001", "D-007", "D-014"]),
  entry("customer.exchange-orders.create", "financial", true, [
    "D-001",
    "D-007",
    "D-011",
    "D-014"
  ]),
  entry("customer.payments.create", "financial", true, [
    "D-001",
    "D-004",
    "D-010",
    "D-014"
  ]),
  entry("customer.cards.issue", "financial", true, [
    "D-001",
    "D-005",
    "D-006",
    "D-014"
  ])
]);

/** @param {{ kycStatus: string }} input */
export function evaluateCapabilities({ kycStatus }) {
  if (!KYC_STATUSES.includes(kycStatus)) {
    throw new Error("Unknown KYC status");
  }
  /** @type {string[]} */
  const granted = [];
  /** @type {Readonly<{ capability: string, reasons: readonly string[] }>[]} */
  const denied = [];
  for (const policy of CAPABILITY_POLICY) {
    /** @type {string[]} */
    const reasons = [];
    if (policy.kind === "financial") {
      reasons.push(REASON_CODES.financialCommandsDisabled);
    }
    if (policy.kind === "onboarding") {
      reasons.push(REASON_CODES.operationNotImplemented);
    }
    if (policy.requiresVerifiedKyc && kycStatus !== "verified") {
      reasons.push(REASON_CODES.kycVerificationRequired);
    }
    reasons.push(...policy.decisions.map(decisionReasonCode));
    if (policy.kind === "read" && reasons.length === 0) {
      granted.push(policy.capability);
    } else {
      denied.push(
        Object.freeze({
          capability: policy.capability,
          reasons: Object.freeze(reasons.length > 0 ? reasons : [REASON_CODES.operationNotImplemented])
        })
      );
    }
  }
  return Object.freeze({
    granted: Object.freeze(granted),
    denied: Object.freeze(denied),
    commandsEnabled: false
  });
}

// Synthetic KYC status source. A future KYC core adapter replaces it behind
// `statusFor(subject) -> Promise<"unverified" | "pending" | "verified">`.
/**
 * @typedef {object} KycDirectory
 * @property {(subject: string) => Promise<string>} statusFor
 */

/**
 * @param {Readonly<Record<string, string>>} [statuses]
 * @returns {KycDirectory}
 */
export function createSyntheticKycDirectory(statuses = {}) {
  const known = new Map(Object.entries(statuses));
  for (const status of known.values()) {
    if (!KYC_STATUSES.includes(status)) {
      throw new Error("Unknown KYC status");
    }
  }
  return Object.freeze({
    async statusFor(subject) {
      return known.get(subject) ?? "unverified";
    }
  });
}
