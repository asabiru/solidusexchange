import type { Capability, OperatorRole } from "../auth/access.js";
import type {
  AmlCase,
  ApprovalPreview,
  ApprovalSummary,
  AuditEvent,
  ChatCheck,
  CheckStatus,
  CustomerRow,
  FraudAlert,
  InvestigationCase,
  KycCase,
  Metric,
  QueueRow,
  SupportTicket,
  SupportTicketStatus
} from "./demo.js";
import type {
  DraftReport,
  ReportExportPayload,
  ReportId,
  ReportListPayload
} from "./reports.js";
import type { KycProviderEvidence, KytProviderEvidence, ProviderEvidenceFeed } from "./provider-evidence.js";

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
  retiredAt?: string;
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

export interface ChecksPayload {
  statuses: readonly CheckStatus[];
  checks: readonly ChatCheck[];
}

export interface SupportTicketsPayload {
  statuses: readonly SupportTicketStatus[];
  tickets: readonly SupportTicket[];
}

export interface KycPayload {
  cases: readonly KycCase[];
  providerEvidence: ProviderEvidenceFeed<KycProviderEvidence>;
}

export interface AmlPayload {
  cases: readonly AmlCase[];
  providerEvidence: ProviderEvidenceFeed<KytProviderEvidence>;
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
  deviceBinding?: "off" | "enforce";
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

const KEYSET_MAX_AGE_MS = 60 * 1_000;
const RESPONSE_MAX_SKEW_MS = 5 * 60 * 1_000;
const ENVELOPE_FIELDS = [
  "issuedAt",
  "keyId",
  "keyVersion",
  "payload",
  "requestId",
  "resource",
  "signature",
  "signatureVersion"
] as const;

let signingKeysetPromise: Promise<SigningKeyset> | undefined;
let signingKeysetFetchedAt = 0;

function bytes(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function decodeBase64Url(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Backoffice response signature encoding is invalid");
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return bytes(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertCanonicalJson(value: unknown): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error("Backoffice response payload is not canonical JSON");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalJson(item);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertCanonicalJson(item);
  }
}

function assertEnvelopeShape(envelope: unknown): asserts envelope is SignedEnvelope<unknown> {
  if (
    !isRecord(envelope)
    || Object.keys(envelope).sort().join(",") !== ENVELOPE_FIELDS.join(",")
    || envelope.signatureVersion !== 1
    || typeof envelope.keyId !== "string"
    || !Number.isSafeInteger(envelope.keyVersion)
    || (envelope.keyVersion as number) < 1
    || typeof envelope.issuedAt !== "string"
    || typeof envelope.requestId !== "string"
    || envelope.requestId.length === 0
    || typeof envelope.resource !== "string"
    || typeof envelope.signature !== "string"
  ) throw new Error("Backoffice response envelope is malformed");
  assertCanonicalJson(envelope.payload);
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

function isValidKeyset(keyset: SigningKeyset): boolean {
  if (
    !isRecord(keyset)
    || keyset.formatVersion !== 1
    || keyset.backend !== "ephemeral-dev"
    || typeof keyset.activeKeyId !== "string"
    || !Array.isArray(keyset.keys)
  ) return false;
  const active = keyset.keys.filter((key) => isRecord(key) && key.status === "active");
  const keyIds = new Set(keyset.keys.map((key) => isRecord(key) ? key.keyId : undefined));
  return active.length === 1
    && active[0]?.keyId === keyset.activeKeyId
    && keyIds.size === keyset.keys.length;
}

async function signingKeyset(forceRefresh = false): Promise<SigningKeyset> {
  if (forceRefresh || Date.now() - signingKeysetFetchedAt > KEYSET_MAX_AGE_MS) {
    signingKeysetPromise = undefined;
  }
  if (!signingKeysetPromise) {
    signingKeysetFetchedAt = Date.now();
    const pending = fetch("/bff/api/signing-keys", {
      credentials: "same-origin",
      headers: { accept: "application/json" }
    }).then(async (response) => {
      if (!response.ok) throw new ApiError(response.status, "Signing keys unavailable");
      const keyset = await response.json() as SigningKeyset;
      if (!isValidKeyset(keyset)) throw new Error("Backoffice signing keyset is invalid");
      return keyset;
    });
    signingKeysetPromise = pending;
    pending.catch(() => {
      if (signingKeysetPromise === pending) signingKeysetPromise = undefined;
    });
  }
  return signingKeysetPromise;
}

async function verifyEnvelope<T>(
  envelope: SignedEnvelope<T>,
  expectedResource: string
): Promise<T> {
  assertEnvelopeShape(envelope);
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
  if (
    !Number.isFinite(issuedAt)
    || new Date(issuedAt).toISOString() !== envelope.issuedAt
    || Math.abs(Date.now() - issuedAt) > RESPONSE_MAX_SKEW_MS
  ) {
    throw new Error("Backoffice response is outside the accepted time window");
  }
  if (key.status === "retired") {
    const retiredAt = typeof key.retiredAt === "string" ? Date.parse(key.retiredAt) : Number.NaN;
    if (!Number.isFinite(retiredAt) || issuedAt > retiredAt) {
      throw new Error("Backoffice response was issued after its signing key was retired");
    }
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

export function getChecks(status?: CheckStatus): Promise<ChecksPayload> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return getSigned(`/bff/api/checks${query}`, "checks");
}

export function getCheck(id: string): Promise<ChatCheck> {
  return getSigned(`/bff/api/checks/${encodeURIComponent(id)}`, `check:${id}`);
}

export function getSupportTickets(status?: SupportTicketStatus): Promise<SupportTicketsPayload> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return getSigned(`/bff/api/support${query}`, "support");
}

export function getSupportTicket(id: string): Promise<SupportTicket> {
  return getSigned(`/bff/api/support/${encodeURIComponent(id)}`, `support:${id}`);
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

export function getReports(): Promise<ReportListPayload> {
  return getSigned("/bff/api/reports", "reports");
}

export function getReport(id: ReportId): Promise<DraftReport> {
  return getSigned(`/bff/api/reports/${encodeURIComponent(id)}`, `report:${id}`);
}

export function getReportExport(id: ReportId): Promise<ReportExportPayload> {
  return getSigned(`/bff/api/reports/${encodeURIComponent(id)}/export`, `report-export:${id}`);
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
  if (!response.ok) {
    let detail: { error?: string; deviceDigest?: string } = {};
    try {
      detail = await response.json() as typeof detail;
    } catch {
      detail = {};
    }
    if (detail.error === "device_not_approved" && typeof detail.deviceDigest === "string") {
      throw new ApiError(
        response.status,
        `Устройство не одобрено для backoffice. Передайте администратору отпечаток: ${detail.deviceDigest}`,
        detail.error
      );
    }
    throw new ApiError(response.status, "Dev session was rejected", detail.error);
  }
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
