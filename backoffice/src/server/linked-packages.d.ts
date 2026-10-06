// Narrow type surface of the dependency-free dev workspace package the BFF
// links with `file:`. Only members the BFF uses are declared; browser code
// must never import it (tsconfig.app.json excludes src/server).

declare module "@solidchange/provider-simulators" {
  import type { KeyObject } from "node:crypto";

  export type KycScenario =
    | "approve"
    | "reject"
    | "needs_more_data"
    | "pending_timeout"
    | "provider_outage"
    | "duplicate_callback"
    | "out_of_order_callback"
    | "late_callback";

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

  export interface SimulatedClock {
    now(): number;
    advance(seconds: number): number;
  }

  export interface ScheduledDelivery {
    readonly deliverAt: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Buffer;
  }

  export interface NonceStore {
    record(nonce: string, expiresAt: number, now: number): "recorded" | "replayed" | "full";
    size(): number;
  }

  export type CallbackVerification =
    | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly reason: string };

  export type CallbackVerifier = (input: {
    headers: unknown;
    body: unknown;
    now: number;
  }) => CallbackVerification;

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
    accept(
      payload: Readonly<Record<string, unknown>>,
      options: { receivedAt: number }
    ): { readonly action: InboxAction; readonly status: string | null; readonly appliedStatuses: readonly string[] };
    expire(now: number): string[];
    get(subjectId: string): InboxSubject | undefined;
  }

  export interface KycSubmission {
    readonly provider_reference: string;
    readonly applicant_ref: string;
    readonly level: "basic" | "enhanced";
    readonly status: "submitted";
    readonly submitted_at: string;
    readonly review_deadline: string;
  }

  export interface KycSimulator {
    readonly providerId: string;
    submitApplicant(request: {
      applicant_ref: string;
      level: "basic" | "enhanced";
      idempotency_key: string;
    }): Promise<KycSubmission>;
    drainCallbacks(): ScheduledDelivery[];
  }

  export interface KytScreening {
    readonly assessment_id: string;
    readonly status: "pending" | "completed";
    readonly binding_digest: string;
    readonly screening_deadline: string;
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
    }): Promise<KytScreening>;
    drainCallbacks(): ScheduledDelivery[];
  }

  export class ProviderError extends Error {
    readonly code: "provider_unavailable" | "idempotency_conflict" | "invalid_request" | "not_found" | "scenario_not_configured";
    readonly retryable: boolean;
  }

  export function generateSimulatorKey(options: { keyId: string; algorithm?: "ed25519" | "hmac-sha256" }): SimulatorKey;
  export function verificationKeyOf(key: SimulatorKey): VerificationKey;
  export function createVerificationKeyring(keys: readonly VerificationKey[]): ReadonlyMap<string, VerificationKey>;
  export function createNonceStore(options?: { maxEntries?: number }): NonceStore;
  export function createSimulatedClock(startEpochSeconds?: number): SimulatedClock;
  export function createKycSimulator(options: {
    seed: string;
    key: SimulatorKey;
    clock?: SimulatedClock;
    scenarios?: Readonly<Record<string, KycScenario>>;
    defaultScenario?: KycScenario;
  }): KycSimulator;
  export function createKytSimulator(options: {
    seed: string;
    key: SimulatorKey;
    clock?: SimulatedClock;
    scenarios?: Readonly<Record<string, KytScenario>>;
    defaultScenario?: KytScenario;
  }): KytSimulator;
  export function createKycCallbackVerifier(options: {
    keyring: ReadonlyMap<string, VerificationKey>;
    nonceStore: NonceStore;
  }): CallbackVerifier;
  export function createKytCallbackVerifier(options: {
    keyring: ReadonlyMap<string, VerificationKey>;
    nonceStore: NonceStore;
  }): CallbackVerifier;
  export function createKycCallbackInbox(): CallbackInbox;
  export function createKytCallbackInbox(): CallbackInbox;
}
