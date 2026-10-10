import { createHash } from "node:crypto";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticOperatorToken } from "@solidchange/customer-api/synthetic-token";
import type { OperatorRole } from "../auth/access.js";
import { isDeviceId } from "./device.js";

export const customerApiClientVersion = "solidchange-backoffice-bff/0.1.0";
export const customerApiPlatform = "operator-web";
const tokenTtlSeconds = 300;
export const maxCustomerApiResponseBytes = 16_384;

const operatorIdPattern = /^opr_[0-9a-f]{24}$/;
const operatorSubjectPattern = /^syn_oper_[a-z0-9]{8,32}$/;
const isoTimestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const operatorAdminViewKeys = [
  "created_at",
  "granted_capabilities",
  "mode",
  "operator_id",
  "role",
  "subject",
  "updated_at"
] as const;
const grantedCapabilitiesMaxItems = 32;
const grantedCapabilityMaxLength = 128;
const operatorRoles: ReadonlySet<string> = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);

export interface CustomerApiClientOptions {
  baseUrl?: string;
  devTokenKey?: string;
  timeoutMs?: number;
}

/** Wire view of GET /api/v1/operator/admin — snake_case contract fields. */
export interface CustomerApiOperatorAdminView {
  mode: "test";
  operator_id: string;
  subject: string;
  role: OperatorRole;
  granted_capabilities: readonly string[];
  created_at: string;
  updated_at: string;
}

export type CustomerApiOperatorAdmin =
  | { status: "ok"; view: CustomerApiOperatorAdminView }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiClient {
  readonly configured: boolean;
  operatorAdmin(bffSubject: string, deviceId: string, nowMs: number): Promise<CustomerApiOperatorAdmin>;
}

/** Maps a BFF pseudonymous operator subject onto the customer-api operator subject space. */
export function customerApiSubject(bffSubject: string): string {
  return `syn_oper_${createHash("sha256").update(`solidchange-backoffice-bff|${bffSubject}`).digest("hex").slice(0, 24)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && value.split(";")[0].trim().toLowerCase() === "application/json";
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (!isJsonContentType(response.headers.get("content-type"))
    || (declared !== null && !(/^\d{1,9}$/.test(declared) && Number(declared) <= maxCustomerApiResponseBytes))
    || !response.body) {
    await response.body?.cancel();
    throw new Error("customer-api response rejected");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxCustomerApiResponseBytes) throw new Error("customer-api response too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string"
    && isoTimestampPattern.test(value)
    && new Date(Date.parse(value)).toISOString() === value
  );
}

function validGrantedCapabilities(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value)
    && value.length <= grantedCapabilitiesMaxItems
    && new Set(value).size === value.length
    && value.every(
      (item) => typeof item === "string" && item.length >= 1 && item.length <= grantedCapabilityMaxLength
    )
  );
}

/**
 * Fail-closed parser for the operator admin contract view: exact key set,
 * `opr_*`/`syn_oper_*` patterns, the staff role enum, the granted capability
 * echo and coherent ISO timestamps — the same axes the upstream
 * `validOperatorAdminView` validator pins.
 */
function parseOperatorAdminView(value: unknown, expectedSubject: string): CustomerApiOperatorAdminView | undefined {
  if (!isRecord(value) || !hasExactKeys(value, operatorAdminViewKeys)) {
    return undefined;
  }
  if (
    value.mode !== "test"
    || typeof value.operator_id !== "string"
    || !operatorIdPattern.test(value.operator_id)
    || value.subject !== expectedSubject
    || !operatorSubjectPattern.test(value.subject)
    || typeof value.role !== "string"
    || !operatorRoles.has(value.role)
    || !validGrantedCapabilities(value.granted_capabilities)
    || !isIsoTimestamp(value.created_at)
    || !isIsoTimestamp(value.updated_at)
    // Record coherence mirrors the synthetic build: an operator record cannot
    // be updated before it was created.
    || Date.parse(value.updated_at) < Date.parse(value.created_at)
  ) {
    return undefined;
  }
  return Object.freeze({
    mode: "test",
    operator_id: value.operator_id,
    subject: value.subject,
    role: value.role as OperatorRole,
    granted_capabilities: Object.freeze([...(value.granted_capabilities as readonly string[])]),
    created_at: value.created_at,
    updated_at: value.updated_at
  });
}

class CustomerApiHttpError extends Error {
  constructor(readonly status: number) {
    super("customer-api request failed");
    this.name = "CustomerApiHttpError";
  }
}

/**
 * Server-side, read-only client for the dev customer API's operator audience.
 * It only issues the operator admin GET, always sends X-Device-Id (the
 * operator audience pins a bound workstation device on every request) and
 * fails closed to "unavailable" on any unexpected response, including a
 * non-JSON content type or a body above maxCustomerApiResponseBytes. The read
 * is granted to every operator token upstream, so there is no "denied" arm:
 * a refusal is contract drift, not a real denial.
 */
export function createCustomerApiClient(options: CustomerApiClientOptions): CustomerApiClient {
  const { baseUrl, devTokenKey } = options;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!baseUrl || !devTokenKey) {
    return Object.freeze({
      configured: false,
      operatorAdmin: async (): Promise<CustomerApiOperatorAdmin> => ({ status: "not-configured" })
    });
  }

  async function get(path: string, token: string, deviceId: string, nowMs: number): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": generateUuidV7(nowMs),
        "x-client-version": customerApiClientVersion,
        "x-platform": customerApiPlatform,
        "x-device-id": deviceId
      }
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new CustomerApiHttpError(response.status);
    }
    return readBoundedJson(response);
  }

  async function operatorAdmin(
    bffSubject: string,
    deviceId: string,
    nowMs: number
  ): Promise<CustomerApiOperatorAdmin> {
    // The route rejects absent or malformed device identities before calling;
    // this guard keeps the client itself from ever emitting a non-contract
    // X-Device-Id if it is reused elsewhere.
    if (!isDeviceId(deviceId)) {
      return { status: "unavailable" };
    }
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticOperatorToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/operator/admin", token, deviceId, nowMs);
      const view = parseOperatorAdminView(body, subject);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      return { status: "unavailable" };
    }
  }

  return Object.freeze({ configured: true, operatorAdmin });
}
