import type { Capability, OperatorRole } from "../auth/access";
import type {
  AmlCase,
  ApprovalPreview,
  ApprovalSummary,
  AuditEvent,
  CustomerRow,
  FraudAlert,
  InvestigationCase,
  KycCase,
  Metric,
  QueueRow
} from "./demo";

export interface SignedEnvelope<T> {
  signatureVersion: 1;
  keyId: string;
  keyVersion: number;
  issuedAt: string;
  requestId: string;
  resource: string;
  payload: T;
  signature: string;
}

interface SigningKey {
  keyId: string;
  version: number;
  algorithm: "Ed25519";
  status: "active" | "retired";
  publicJwk: JsonWebKey;
}

interface SigningKeyset {
  formatVersion: 1;
  backend: "ephemeral-dev";
  activeKeyId: string;
  keys: readonly SigningKey[];
}

export interface SessionPayload {
  operator: {
    subject: string;
    email: string;
    name: string;
    role: OperatorRole;
    label: string;
    initials: string;
    capabilities: readonly Capability[];
  };
  expiresAt: string;
}

export interface DashboardPayload {
  metrics: readonly Metric[];
  queues: readonly QueueRow[];
}

export interface CustomersPayload {
  customers: readonly CustomerRow[];
}

export interface KycPayload {
  cases: readonly KycCase[];
}

export interface AmlPayload {
  cases: readonly AmlCase[];
}

export interface InvestigationsPayload {
  cases: readonly InvestigationCase[];
}

export interface FraudPayload {
  alerts: readonly FraudAlert[];
}

export interface ApprovalsPayload {
  approvals: readonly ApprovalSummary[];
}

export interface AuditPayload {
  events: readonly AuditEvent[];
  chain: {
    backend: "synthetic-memory" | "postgresql";
    durable: boolean;
    retentionDays: number;
    verified: boolean;
    length: number;
    headHash: string;
  };
}

export interface AuditExportPayload {
  formatVersion: 1;
  generatedAt: string;
  storage: {
    backend: "synthetic-memory" | "postgresql";
    durable: boolean;
    retentionDays: number;
  };
  chain: AuditPayload["chain"];
  events: readonly AuditEvent[];
}

export interface HealthPayload {
  mode: "dev-dry-run";
  oidcConfigured: boolean;
  devLoginEnabled: boolean;
  dataSource: "synthetic";
  audit: {
    backend: "synthetic-memory" | "postgresql";
    durable: boolean;
    retentionDays: number;
    verified: boolean;
  };
  stepUp: {
    provider: "synthetic-dev";
    challengeTtlSeconds: number;
    maxAttempts: number;
    productionReady: false;
  };
  signing: {
    backend: "ephemeral-dev";
    rotationSeconds: number;
    retainedVerificationKeys: number;
    productionReady: false;
  };
  commandsEnabled: false;
}

export interface StepUpChallengePayload {
  challengeVersion: 1;
  challengeId: string;
  provider: "synthetic-dev";
  expiresAt: string;
  attemptsRemaining: number;
  devVerificationCode: string;
}

export interface StepUpVerificationPayload {
  grant: string;
  provider: "synthetic-dev";
  expiresAt: string;
}

export interface AuthStatusPayload {
  authenticated: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly state?: string,
    readonly attemptsRemaining?: number
  ) {
    super(message);
  }
}

let signingKeysetPromise: Promise<SigningKeyset> | undefined;

function bytes(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return bytes(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function canonicalMessage<T>(envelope: SignedEnvelope<T>): ArrayBuffer {
  return bytes(new TextEncoder().encode(JSON.stringify({
    signatureVersion: envelope.signatureVersion,
    keyId: envelope.keyId,
    keyVersion: envelope.keyVersion,
    issuedAt: envelope.issuedAt,
    requestId: envelope.requestId,
    resource: envelope.resource,
    payload: envelope.payload
  })));
}

async function signingKeyset(forceRefresh = false): Promise<SigningKeyset> {
  if (forceRefresh) signingKeysetPromise = undefined;
  signingKeysetPromise ??= fetch("/bff/api/signing-keys", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status, "Signing keys unavailable");
    const keyset = await response.json() as SigningKeyset;
    if (
      keyset.formatVersion !== 1
      || keyset.backend !== "ephemeral-dev"
      || typeof keyset.activeKeyId !== "string"
      || !Array.isArray(keyset.keys)
      || keyset.keys.filter((key) => key.status === "active").length !== 1
    ) throw new Error("Backoffice signing keyset is invalid");
    return keyset;
  });
  return signingKeysetPromise;
}

async function verifyEnvelope<T>(
  envelope: SignedEnvelope<T>,
  expectedResource: string
): Promise<T> {
  if (envelope.signatureVersion !== 1) {
    throw new Error("Backoffice response signature version is unsupported");
  }
  let keys = await signingKeyset();
  let key = keys.keys.find((candidate) => candidate.keyId === envelope.keyId);
  if (!key) {
    keys = await signingKeyset(true);
    key = keys.keys.find((candidate) => candidate.keyId === envelope.keyId);
  }
  if (
    !key
    || key.version !== envelope.keyVersion
    || key.algorithm !== "Ed25519"
    || (key.status !== "active" && key.status !== "retired")
    || (key.status === "active") !== (key.keyId === keys.activeKeyId)
  ) throw new Error("Backoffice response key mismatch");
  if (envelope.resource !== expectedResource) {
    throw new Error("Backoffice response resource mismatch");
  }
  const issuedAt = Date.parse(envelope.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 5 * 60 * 1_000) {
    throw new Error("Backoffice response is outside the accepted time window");
  }
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    key.publicJwk,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    decodeBase64Url(envelope.signature),
    canonicalMessage(envelope)
  );
  if (!verified) throw new Error("Backoffice response signature is invalid");
  return envelope.payload;
}

async function getSigned<T>(path: string, resource: string): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(response.status, `Backoffice API rejected ${path}`);
  return verifyEnvelope(await response.json() as SignedEnvelope<T>, resource);
}

async function postSigned<T>(
  path: string,
  resource: string,
  body: Readonly<Record<string, unknown>>
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let detail: {
      error?: string;
      state?: string;
      attemptsRemaining?: number;
    } = {};
    try {
      detail = await response.json() as typeof detail;
    } catch {
      detail = {};
    }
    throw new ApiError(
      response.status,
      `Backoffice API rejected ${path}`,
      detail.error,
      detail.state,
      detail.attemptsRemaining
    );
  }
  return verifyEnvelope(await response.json() as SignedEnvelope<T>, resource);
}

export async function getHealth(): Promise<HealthPayload> {
  const response = await fetch("/bff/healthz", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(response.status, "Backoffice BFF unavailable");
  return await response.json() as HealthPayload;
}

export async function getAuthStatus(): Promise<AuthStatusPayload> {
  const response = await fetch("/bff/auth/status", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(response.status, "Session status unavailable");
  return await response.json() as AuthStatusPayload;
}

export function getSession(): Promise<SessionPayload> {
  return getSigned("/bff/api/session", "session");
}

export function getDashboard(): Promise<DashboardPayload> {
  return getSigned("/bff/api/dashboard", "dashboard");
}

export function getCustomers(): Promise<CustomersPayload> {
  return getSigned("/bff/api/customers", "customers");
}

export function getKycCases(): Promise<KycPayload> {
  return getSigned("/bff/api/kyc", "kyc-cases");
}

export function getAmlCases(): Promise<AmlPayload> {
  return getSigned("/bff/api/aml", "aml-cases");
}

export function getInvestigations(): Promise<InvestigationsPayload> {
  return getSigned("/bff/api/investigations", "investigations");
}

export function getFraudAlerts(): Promise<FraudPayload> {
  return getSigned("/bff/api/fraud-alerts", "fraud-alerts");
}

export function getApprovals(): Promise<ApprovalsPayload> {
  return getSigned("/bff/api/approvals", "approvals");
}

export function getAudit(): Promise<AuditPayload> {
  return getSigned("/bff/api/audit", "audit");
}

export async function getAuditExport(): Promise<SignedEnvelope<AuditExportPayload>> {
  const response = await fetch("/bff/api/audit/export", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new ApiError(response.status, "Audit export was rejected");
  const envelope = await response.json() as SignedEnvelope<AuditExportPayload>;
  await verifyEnvelope(envelope, "audit-export");
  return envelope;
}

export function previewApproval(
  approvalId: string,
  commandDigest: string,
  stepUpGrant?: string
): Promise<ApprovalPreview> {
  const path = `/bff/api/approvals/${encodeURIComponent(approvalId)}/preview`;
  return postSigned(path, `approval-preview:${approvalId}`, {
    commandDigest,
    ...(stepUpGrant ? { stepUpGrant } : {})
  });
}

export function createStepUpChallenge(
  approvalId: string,
  commandDigest: string
): Promise<StepUpChallengePayload> {
  const encodedApproval = encodeURIComponent(approvalId);
  return postSigned(
    `/bff/api/approvals/${encodedApproval}/step-up/challenges`,
    `step-up-challenge:${approvalId}`,
    { commandDigest }
  );
}

export function verifyStepUpChallenge(
  approvalId: string,
  commandDigest: string,
  challengeId: string,
  code: string
): Promise<StepUpVerificationPayload> {
  const encodedApproval = encodeURIComponent(approvalId);
  const encodedChallenge = encodeURIComponent(challengeId);
  return postSigned(
    `/bff/api/approvals/${encodedApproval}/step-up/challenges/${encodedChallenge}/verify`,
    `step-up-verification:${approvalId}`,
    { commandDigest, code }
  );
}

export async function createDevSession(role: OperatorRole): Promise<void> {
  const response = await fetch("/bff/auth/dev-session", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ role })
  });
  if (!response.ok) throw new ApiError(response.status, "Dev session was rejected");
}

export async function logout(): Promise<void> {
  const response = await fetch("/bff/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });
  if (!response.ok && response.status !== 204) {
    throw new ApiError(response.status, "Logout failed");
  }
}
