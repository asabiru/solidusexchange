import type { Tone } from "./demo.js";

export type ProviderEvidenceDomain = "kyc" | "kyt";

export type ProviderInboxAction =
  | "applied"
  | "buffered"
  | "duplicate"
  | "conflict"
  | "stale"
  | "late"
  | "invalid_transition"
  | "unknown_subject";

export interface ProviderCallbackRecord {
  readonly deliveryId: string;
  readonly deliveredAt: string;
  readonly origin: "simulator" | "synthetic-probe";
  readonly probe: "replay" | "tampered-body" | "foreign-key" | null;
  readonly verification: "verified" | "rejected";
  readonly verificationReason: string | null;
  readonly eventId: string | null;
  readonly sequence: number | null;
  readonly status: string | null;
  readonly inboxAction: ProviderInboxAction | null;
  readonly accepted: boolean;
}

export interface ProviderVerificationSummary {
  readonly result: "all-verified" | "rejections-present" | "no-callbacks";
  readonly delivered: number;
  readonly verified: number;
  readonly rejected: number;
  readonly applied: number;
  readonly heldForReview: number;
}

export interface ProviderOutage {
  readonly code: string;
  readonly retryable: boolean;
}

interface ProviderEvidenceBase {
  readonly source: "provider-simulator";
  readonly evidence_only: true;
  readonly environment: "dev-simulator";
  readonly domain: ProviderEvidenceDomain;
  readonly id: string;
  readonly linkedCaseId: string | null;
  readonly scenario: string;
  readonly label: string;
  readonly providerReference: string | null;
  readonly providerStatus: string;
  readonly projectedStatus: string;
  readonly sequence: number;
  readonly deadline: string | null;
  readonly timedOut: boolean;
  readonly lateEvents: number;
  readonly reviewEvents: number;
  readonly buffered: number;
  readonly outage: ProviderOutage | null;
  readonly tone: Tone;
  readonly verification: ProviderVerificationSummary;
  readonly receivedCallbacks: readonly ProviderCallbackRecord[];
  readonly rejectedCallbacks: readonly ProviderCallbackRecord[];
  readonly operatorReview: {
    readonly required: true;
    readonly decision: null;
    readonly decisionPath: "maker-checker-approval";
  };
}

export interface KycProviderEvidence extends ProviderEvidenceBase {
  readonly domain: "kyc";
  readonly applicantRef: string;
  readonly level: "basic" | "enhanced";
  readonly reasonCodes: readonly string[];
  readonly requestedItems: readonly string[];
}

export interface KytProviderEvidence extends ProviderEvidenceBase {
  readonly domain: "kyt";
  readonly asset: string;
  readonly network: string;
  readonly direction: "inbound" | "outbound";
  readonly addressRef: string;
  readonly txRef: string | null;
  readonly amount: string;
  readonly bindingDigest: string | null;
  readonly riskLevel: string | null;
  readonly riskScore: number | null;
  readonly sanctionsHit: boolean | null;
  readonly reasonCodes: readonly string[];
}

export interface ProviderEvidenceFeed<T extends ProviderEvidenceBase> {
  readonly source: "provider-simulator";
  readonly evidence_only: true;
  readonly environment: "dev-simulator";
  readonly decisionAuthority: "none";
  readonly decisionPath: "maker-checker-approval";
  readonly cases: readonly T[];
}
