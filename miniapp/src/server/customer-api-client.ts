import { createHash } from "node:crypto";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";
import type { CustomerApiAccess } from "../shared/api.js";

export const customerApiClientVersion = "solidchange-miniapp-bff/0.1.0";
export const customerApiPlatform = "telegram-mini-app";
const tokenTtlSeconds = 300;
const capabilityPattern = /^customer\.[a-z-]+(?:\.[a-z-]+)*$/;
export const maxCustomerApiResponseBytes = 16_384;

export interface CustomerApiClientOptions {
  baseUrl?: string;
  devTokenKey?: string;
  timeoutMs?: number;
}

export interface CustomerApiClient {
  readonly configured: boolean;
  access(bffSubject: string, nowMs: number): Promise<CustomerApiAccess>;
}

/** Maps a BFF pseudonymous subject onto the customer-api synthetic subject space. */
export function customerApiSubject(bffSubject: string): string {
  return `syn_cust_${createHash("sha256").update(`solidchange-miniapp-bff|${bffSubject}`).digest("hex").slice(0, 24)}`;
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

/**
 * Server-side, read-only client for the dev customer API. It only issues the
 * customer session and capabilities GETs, never sends X-Device-Id and fails
 * closed to "unavailable" on any unexpected response, including a non-JSON
 * content type or a body above maxCustomerApiResponseBytes.
 */
export function createCustomerApiClient(options: CustomerApiClientOptions): CustomerApiClient {
  const { baseUrl, devTokenKey } = options;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!baseUrl || !devTokenKey) {
    return Object.freeze({
      configured: false,
      access: async (): Promise<CustomerApiAccess> => ({ status: "not-configured" })
    });
  }

  async function get(path: string, token: string, nowMs: number): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-request-id": generateUuidV7(nowMs),
        "x-client-version": customerApiClientVersion,
        "x-platform": customerApiPlatform
      }
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error("customer-api request failed");
    }
    return readBoundedJson(response);
  }

  async function access(bffSubject: string, nowMs: number): Promise<CustomerApiAccess> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const session = await get("/api/v1/customer/session", token, nowMs);
      if (
        !isRecord(session)
        || !hasExactKeys(session, ["actor_type", "expires_at", "scopes", "subject"])
        || session.subject !== subject
        || session.actor_type !== "customer"
      ) {
        return { status: "unavailable" };
      }
      const capabilities = await get("/api/v1/customer/capabilities", token, nowMs);
      if (
        !isRecord(capabilities)
        || !hasExactKeys(capabilities, ["capabilities", "commands_enabled"])
        || capabilities.commands_enabled !== false
        || !Array.isArray(capabilities.capabilities)
        || !capabilities.capabilities.every((entry) => typeof entry === "string" && capabilityPattern.test(entry))
      ) {
        return { status: "unavailable" };
      }
      return {
        status: "connected",
        granted: Object.freeze([...(capabilities.capabilities as string[])]),
        commandsEnabled: false
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  return Object.freeze({ configured: true, access });
}
