import type { Capability, OperatorRole } from "../auth/access";
import type {
  ApprovalPreview,
  ApprovalSummary,
  AuditEvent,
  CustomerRow,
  Metric,
  QueueRow
} from "./demo";

interface SignedEnvelope<T> {
  keyId: string;
  issuedAt: string;
  requestId: string;
  resource: string;
  payload: T;
  signature: string;
}

interface SigningKey {
  keyId: string;
  publicJwk: JsonWebKey;
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

export interface ApprovalsPayload {
  approvals: readonly ApprovalSummary[];
}

export interface AuditPayload {
  events: readonly AuditEvent[];
  chain: {
    verified: boolean;
    length: number;
    headHash: string;
  };
}

export interface HealthPayload {
  mode: "dev-dry-run";
  oidcConfigured: boolean;
  devLoginEnabled: boolean;
  dataSource: "synthetic";
  commandsEnabled: false;
}

export interface AuthStatusPayload {
  authenticated: boolean;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

let signingKeyPromise: Promise<SigningKey> | undefined;

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
    issuedAt: envelope.issuedAt,
    requestId: envelope.requestId,
    resource: envelope.resource,
    payload: envelope.payload
  })));
}

async function signingKey(forceRefresh = false): Promise<SigningKey> {
  if (forceRefresh) signingKeyPromise = undefined;
  signingKeyPromise ??= fetch("/bff/api/signing-key", {
    credentials: "same-origin",
    headers: { accept: "application/json" }
  }).then(async (response) => {
    if (!response.ok) throw new ApiError(response.status, "Signing key unavailable");
    return await response.json() as SigningKey;
  });
  return signingKeyPromise;
}

async function verifyEnvelope<T>(
  envelope: SignedEnvelope<T>,
  expectedResource: string
): Promise<T> {
  let key = await signingKey();
  if (envelope.keyId !== key.keyId) key = await signingKey(true);
  if (envelope.keyId !== key.keyId) throw new Error("Backoffice response key mismatch");
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
  if (!response.ok) throw new ApiError(response.status, `Backoffice API rejected ${path}`);
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

export function getApprovals(): Promise<ApprovalsPayload> {
  return getSigned("/bff/api/approvals", "approvals");
}

export function getAudit(): Promise<AuditPayload> {
  return getSigned("/bff/api/audit", "audit");
}

export function previewApproval(
  approvalId: string,
  commandDigest: string
): Promise<ApprovalPreview> {
  const path = `/bff/api/approvals/${encodeURIComponent(approvalId)}/preview`;
  return postSigned(path, `approval-preview:${approvalId}`, { commandDigest });
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
