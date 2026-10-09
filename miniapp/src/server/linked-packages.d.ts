// Narrow type surface of the dependency-free dev workspace packages the BFF
// links with `file:`. Only members the BFF uses are declared.

declare module "@solidchange/provider-simulators" {
  import type { KeyObject } from "node:crypto";

  export type QuotePair = "USDT/RUB" | "TON/RUB" | "TON/USDT";
  export type QuoteScenario = "fresh_quote" | "expired_quote" | "stale_price" | "provider_outage";

  export interface SimulatorQuote {
    readonly schema: string;
    readonly environment: "dev-simulator";
    readonly domain: "quote";
    readonly quote_id: string;
    readonly pair: QuotePair;
    readonly base_asset: string;
    readonly quote_asset: string;
    readonly side: "buy" | "sell";
    readonly amount_mode: "base" | "quote";
    readonly requested_quote_amount: string | null;
    readonly base_amount: string;
    readonly mid_price: string;
    readonly price: string;
    readonly spread_bps: number;
    readonly fee_bps: number;
    readonly quote_amount: string;
    readonly fee_amount: string;
    readonly fee_asset: string;
    readonly total_quote_amount: string;
    readonly rounding: "down" | "up";
    readonly price_observed_at: string;
    readonly issued_at: string;
    readonly expires_at: string;
    readonly ttl_seconds: number;
    readonly status: "indicative";
    readonly execution: "not_supported";
  }

  export interface QuoteRequest {
    pair: QuotePair;
    side: "buy" | "sell";
    base_amount?: string;
    quote_amount?: string;
    idempotency_key: string;
  }

  export interface SimulatorKey {
    readonly keyId: string;
    readonly algorithm: "ed25519" | "hmac-sha256";
    readonly signingKey: KeyObject;
    readonly verificationKey: KeyObject;
  }

  export interface VerificationKey {
    readonly keyId: string;
    readonly algorithm: "ed25519" | "hmac-sha256";
    readonly key: KeyObject;
  }

  export interface SignedDelivery {
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Buffer;
  }

  export interface SimulatedClock {
    now(): number;
    advance(seconds: number): number;
  }

  export interface QuoteSimulator {
    readonly providerId: string;
    requestQuote(request: QuoteRequest): Promise<SimulatorQuote>;
    getQuote(quoteId: string): Promise<SimulatorQuote>;
    exportSignedQuote(quoteId: string): SignedDelivery;
  }

  export interface NonceStore {
    record(nonce: string, expiresAt: number, now: number): "recorded" | "replayed" | "full";
    size(): number;
  }

  export type QuoteVerification =
    | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly reason: string };

  export type QuoteAssessmentReason = null | "invalid_quote" | "not_yet_valid" | "expired" | "stale_price";

  export class ProviderError extends Error {
    readonly code: "provider_unavailable" | "idempotency_conflict" | "invalid_request" | "not_found" | "scenario_not_configured";
    readonly retryable: boolean;
  }

  export const QUOTE_SCENARIOS: Readonly<Record<QuoteScenario, unknown>>;
  export function generateSimulatorKey(options: { keyId: string; algorithm?: "ed25519" | "hmac-sha256" }): SimulatorKey;
  export function verificationKeyOf(key: SimulatorKey): VerificationKey;
  export function createVerificationKeyring(keys: readonly VerificationKey[]): ReadonlyMap<string, VerificationKey>;
  export function createNonceStore(options?: { maxEntries?: number }): NonceStore;
  export function createQuoteSimulator(options: {
    seed: string;
    key: SimulatorKey;
    clock?: SimulatedClock;
    scenarios?: Partial<Record<QuotePair, QuoteScenario>>;
    defaultScenario?: QuoteScenario;
    ttlSeconds?: number;
    spreadBps?: number;
    feeBps?: number;
  }): QuoteSimulator;
  export function createQuoteVerifier(options: {
    keyring: ReadonlyMap<string, VerificationKey>;
    nonceStore: NonceStore;
    maxAgeSeconds?: number;
    maxFutureSeconds?: number;
  }): (input: { headers: unknown; body: unknown; now: number }) => QuoteVerification;
  export type KycScenario =
    | "approve"
    | "reject"
    | "needs_more_data"
    | "pending_timeout"
    | "provider_outage"
    | "duplicate_callback"
    | "out_of_order_callback"
    | "late_callback";
  export type KycProviderStatus = "submitted" | "in_review" | "approved" | "rejected" | "needs_more_data";

  export interface KycSubmission {
    readonly provider_reference: string;
    readonly applicant_ref: string;
    readonly level: "basic" | "enhanced";
    readonly status: "submitted";
    readonly submitted_at: string;
    readonly review_deadline: string;
  }

  export interface ScheduledDelivery {
    readonly deliverAt: number;
    readonly headers: Record<string, string>;
    readonly body: Buffer;
  }

  export interface KycSimulator {
    readonly providerId: string;
    submitApplicant(request: { applicant_ref: string; level: "basic" | "enhanced"; idempotency_key: string }): Promise<KycSubmission>;
    getApplicantStatus(providerReference: string): Promise<{
      readonly provider_reference: string;
      readonly status: KycProviderStatus;
      readonly sequence: number;
      readonly updated_at: string;
    }>;
    drainCallbacks(): ScheduledDelivery[];
    pendingCallbacks(): number;
  }

  export type CallbackVerification =
    | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>>; readonly keyId: string; readonly timestamp: number; readonly nonce: string }
    | { readonly ok: false; readonly reason: string };

  export type InboxAction =
    | "applied"
    | "buffered"
    | "duplicate"
    | "conflict"
    | "stale"
    | "late"
    | "invalid_transition"
    | "unknown_subject";

  export interface InboxSubject {
    readonly status: string;
    readonly sequence: number;
    readonly deadline: number;
    readonly timedOut: boolean;
    readonly lateEvents: number;
    readonly reviewEvents: number;
    readonly buffered: number;
  }

  export interface CallbackInbox {
    openSubject(subjectId: string, options: { deadline: number }): void;
    accept(payload: Readonly<Record<string, unknown>>, options: { receivedAt: number }): {
      readonly action: InboxAction;
      readonly status: string | null;
      readonly appliedStatuses: readonly string[];
    };
    expire(now: number): string[];
    get(subjectId: string): InboxSubject | undefined;
  }

  export const KYC_SCENARIOS: Readonly<Record<KycScenario, unknown>>;
  export function createKycSimulator(options: {
    seed: string;
    key: SimulatorKey;
    clock?: SimulatedClock;
    scenarios?: Readonly<Record<string, KycScenario>>;
    defaultScenario?: KycScenario;
    reviewTimeoutSeconds?: number;
  }): KycSimulator;
  export function createKycCallbackVerifier(options: {
    keyring: ReadonlyMap<string, VerificationKey>;
    nonceStore: NonceStore;
    maxAgeSeconds?: number;
    maxFutureSeconds?: number;
  }): (input: { headers: unknown; body: unknown; now: number }) => CallbackVerification;
  export function createKycCallbackInbox(): CallbackInbox;
  export type KytScenario =
    | "low"
    | "medium"
    | "high"
    | "severe"
    | "sanctions_hit"
    | "pending_timeout"
    | "provider_outage"
    | "duplicate_callback"
    | "out_of_order_callback"
    | "late_callback";
  export type KytRiskLevel = "low" | "medium" | "high" | "severe";

  export interface KytBinding {
    readonly asset: string;
    readonly network: string;
    readonly direction: string;
    readonly address: string;
    readonly tx_ref: string | null;
    readonly amount: string;
  }

  export interface KytAssessment {
    readonly assessment_id: string;
    readonly status: "pending" | "completed";
    readonly risk_level: KytRiskLevel | null;
    readonly risk_score: number | null;
    readonly sanctions_hit: boolean | null;
    readonly categories: readonly string[];
    readonly binding: KytBinding;
    readonly binding_digest: string;
    readonly assessed_at: string;
  }

  export interface KytSimulator {
    readonly providerId: string;
    screenTransfer(request: {
      asset: "TON" | "USDT";
      network: "TON_TESTNET" | "TRON_TESTNET";
      direction: "inbound" | "outbound";
      address: string;
      tx_ref?: string;
      amount: string;
      idempotency_key: string;
    }): Promise<KytAssessment & { readonly screening_deadline: string }>;
    getAssessment(assessmentId: string): Promise<KytAssessment>;
    drainCallbacks(): ScheduledDelivery[];
    pendingCallbacks(): number;
  }

  export const KYT_SCENARIOS: Readonly<Record<KytScenario, unknown>>;
  export const KYT_ASSET_NETWORKS: readonly { readonly asset: string; readonly network: string }[];
  export function kytBindingDigest(binding: KytBinding): string;
  export function formatAmount(asset: string, units: bigint): string;
  export function createKytSimulator(options: {
    seed: string;
    key: SimulatorKey;
    clock?: SimulatedClock;
    scenarios?: Readonly<Record<string, KytScenario>>;
    defaultScenario?: KytScenario;
    screeningTimeoutSeconds?: number;
  }): KytSimulator;
  export function createKytCallbackVerifier(options: {
    keyring: ReadonlyMap<string, VerificationKey>;
    nonceStore: NonceStore;
    maxAgeSeconds?: number;
    maxFutureSeconds?: number;
  }): (input: { headers: unknown; body: unknown; now: number }) => CallbackVerification;
  export function createKytCallbackInbox(): CallbackInbox;
  export function validateSignedQuote(payload: Readonly<Record<string, unknown>>): string | null;
  export function assessQuote(
    quote: Readonly<Record<string, unknown>>,
    options: { now: number; maxPriceAgeSeconds?: number }
  ): { readonly displayable: boolean; readonly reason: QuoteAssessmentReason; readonly executable: false };
}

declare module "@solidchange/customer-api/synthetic-token" {
  export const SYNTHETIC_SUBJECT_PATTERN: RegExp;
  export const DEV_TOKEN_KEY_PATTERN: RegExp;
  export function mintSyntheticCustomerToken(options: { key: string; subject: string; expiresAtSeconds: number }): string;
}

declare module "@solidchange/customer-api/request-id" {
  export function generateUuidV7(nowMs?: number): string;
}

declare module "@solidchange/customer-api/dev-server" {
  import type { AddressInfo } from "node:net";
  import type { Server } from "node:http";

  export interface CustomerApiDevConfig {
    readonly host: string;
    readonly port: number;
    readonly rateLimitPerMinute: number;
    readonly authMode: "synthetic-dev" | "deny-all";
    readonly devTokenKey: string | null;
  }

  export function startCustomerApi(
    config: CustomerApiDevConfig,
    options?: {
      kycDirectory?: { statusFor(subject: string): Promise<"unverified" | "pending" | "verified"> };
      walletDirectory?: {
        listFor(subject: string): Promise<{
          wallets: readonly { wallet_id: string; asset: string; available: string; hold: string }[];
        }>;
      };
      notificationDirectory?: {
        listFor(subject: string): Promise<{
          mode: "test";
          delivery: "disabled";
          unread: number;
          notifications: readonly {
            notification_id: string;
            created_at: string;
            channel: "telegram-draft";
            template: string;
            locale: "ru";
            text: string;
            mode: "test";
            delivered: false;
            read: boolean;
          }[];
        }>;
      };
      kycApplicationDirectory?: {
        viewFor(
          subject: string,
          sessionKyc: "unverified" | "pending" | "verified"
        ): Promise<{
          mode: "test";
          provider: "simulator";
          session_kyc: "unverified" | "pending" | "verified";
          status:
            | "not_started"
            | "submitted"
            | "in_review"
            | "approved"
            | "rejected"
            | "needs_more_data"
            | "timed_out"
            | "unavailable";
          application_id?: string;
          submitted_at?: string;
          updated_at: string;
          review_deadline?: string;
          reason_codes?: readonly string[];
          requested_items?: readonly string[];
          can_submit: boolean;
        }>;
      };
      profileDirectory?: {
        viewFor(subject: string): Promise<{
          mode: "test";
          customer_ref: string;
          display_name: string;
          locale: "en" | "ky" | "ru";
          registered_at: string;
        }>;
      };
      clock?: () => number;
    }
  ): Promise<{ server: Server; verifierKind: string; address: AddressInfo }>;
}
