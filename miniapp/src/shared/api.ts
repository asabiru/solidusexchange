import type { AssetCode } from "./assets.js";

export type KycStatus = "verified" | "kyc-gated";
export type SessionSource = "telegram" | "dev-synthetic";

export interface HealthView {
  mode: "dev-synthetic";
  devLogin: boolean;
  telegramVerification: "configured" | "not-configured";
  moneyMovement: "disabled";
}

export interface SessionView {
  authenticated: true;
  source: SessionSource;
  kyc: KycStatus;
  displayName: string;
  customerRef: string;
  expiresAt: number;
}

export interface AssetBalance {
  code: AssetCode;
  available: string;
  hold: string;
  valueRub: string;
}

export interface WalletView {
  kyc: KycStatus;
  totalRub: string;
  availableRub: string;
  holdRub: string;
  assets: readonly AssetBalance[];
}

export type OperationKind = "exchange" | "deposit" | "withdrawal" | "qr";
export type OperationStatus = "completed" | "in-review" | "needs-action" | "failed";

export interface OperationLeg {
  asset: AssetCode;
  amount: string;
  direction: "in" | "out";
}

export interface OperationSummary {
  id: string;
  reference: string;
  kind: OperationKind;
  status: OperationStatus;
  title: string;
  channel: string;
  createdAt: string;
  legs: readonly OperationLeg[];
}

export interface TimelineStep {
  title: string;
  detail: string;
  at?: string;
  state: "done" | "current" | "pending" | "blocked";
}

export interface ExchangeRate {
  base: AssetCode;
  quote: AssetCode;
  value: string;
}

export interface OperationDetail extends OperationSummary {
  fee?: { asset: AssetCode; amount: string };
  rate?: ExchangeRate;
  note: string;
  timeline: readonly TimelineStep[];
}

export interface ProfileStep {
  title: string;
  detail: string;
  state: "done" | "required";
}

export type CustomerApiAccess =
  | { status: "connected"; granted: readonly string[]; commandsEnabled: false }
  | { status: "not-configured" }
  | { status: "unavailable" };

export interface ProfileView {
  displayName: string;
  customerRef: string;
  kyc: {
    state: KycStatus;
    level: string;
    detail: string;
    steps: readonly ProfileStep[];
  };
  limits: {
    status: "not_configured";
    decision: "D-014";
    message: string;
  };
  fees: readonly { title: string; value: string }[];
  security: readonly { title: string; detail: string; status: "placeholder" }[];
  apiAccess: CustomerApiAccess;
}

export interface QuotePreview {
  id: string;
  from: AssetCode;
  to: AssetCode;
  amountIn: string;
  fee: string;
  feeAsset: AssetCode;
  feeBps: number;
  spreadBps: number;
  netIn: string;
  amountOut: string;
  total: string;
  rate: ExchangeRate;
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;
  serverTime: number;
  insufficientBalance: boolean;
  kycRequired: boolean;
  executable: false;
  executionUnavailableReason: "dev_test_version";
}
