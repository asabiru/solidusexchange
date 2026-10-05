// Deny-by-default customer capability policy. Every financial capability stays
// disabled: README stop condition 4 forbids money-moving endpoints until
// idempotency, policy decision, immutable audit, ledger effect and
// reconciliation exist, and the referenced decisions are still open.
// CapabilitiesView has no field for denial reasons, so only granted
// capabilities are returned to clients.

export const KYC_STATUSES = Object.freeze(["unverified", "pending", "verified"]);

export const REASON_CODES = Object.freeze({
  financialCommandsDisabled: "FINANCIAL_COMMANDS_DISABLED",
  kycVerificationRequired: "KYC_VERIFICATION_REQUIRED",
  operationNotImplemented: "OPERATION_NOT_IMPLEMENTED"
});

export function decisionReasonCode(decisionId) {
  return `DECISION_${decisionId.replace("-", "_")}_OPEN`;
}

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
  entry("customer.kyc.submit", "onboarding", false, ["D-001", "D-008"]),
  entry("customer.wallets.read", "financial", true, ["D-001", "D-002"]),
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

export function evaluateCapabilities({ kycStatus }) {
  if (!KYC_STATUSES.includes(kycStatus)) {
    throw new Error("Unknown KYC status");
  }
  const granted = [];
  const denied = [];
  for (const policy of CAPABILITY_POLICY) {
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
