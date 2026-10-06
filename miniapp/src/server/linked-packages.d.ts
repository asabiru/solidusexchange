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
      clock?: () => number;
    }
  ): Promise<{ server: Server; verifierKind: string; address: AddressInfo }>;
}
