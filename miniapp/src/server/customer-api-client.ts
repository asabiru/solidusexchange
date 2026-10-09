import { createHash } from "node:crypto";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";
import type { CustomerApiAccess } from "../shared/api.js";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import { isDecimalString } from "../shared/decimal.js";

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

export interface CustomerApiWallet {
  wallet_id: string;
  asset: AssetCode;
  available: string;
  hold: string;
}

export type CustomerApiWallets =
  | { status: "ok"; wallets: readonly CustomerApiWallet[] }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiClient {
  readonly configured: boolean;
  access(bffSubject: string, nowMs: number): Promise<CustomerApiAccess>;
  wallets(bffSubject: string, nowMs: number): Promise<CustomerApiWallets>;
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

function parseWalletsView(value: unknown): readonly CustomerApiWallet[] | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["wallets"]) || !Array.isArray(value.wallets)) {
    return undefined;
  }
  const wallets: CustomerApiWallet[] = [];
  for (const entry of value.wallets) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, ["wallet_id", "asset", "available", "hold"])
      || typeof entry.wallet_id !== "string"
      || typeof entry.asset !== "string"
      || !isAssetCode(entry.asset)
      || typeof entry.available !== "string"
      || typeof entry.hold !== "string"
      || !isDecimalString(entry.available, assets[entry.asset].scale)
      || !isDecimalString(entry.hold, assets[entry.asset].scale)
    ) {
      return undefined;
    }
    wallets.push(Object.freeze({
      wallet_id: entry.wallet_id,
      asset: entry.asset,
      available: entry.available,
      hold: entry.hold
    }));
  }
  return Object.freeze(wallets);
}

class CustomerApiHttpError extends Error {
  constructor(readonly status: number) {
    super("customer-api request failed");
    this.name = "CustomerApiHttpError";
  }
}

/**
 * Server-side, read-only client for the dev customer API. It only issues the
 * customer session, capabilities and wallets GETs, never sends X-Device-Id and
 * fails closed to "unavailable" on any unexpected response, including a non-JSON
 * content type or a body above maxCustomerApiResponseBytes. An upstream refusal
 * of the wallets read (403 capability gate) surfaces as "denied".
 */
export function createCustomerApiClient(options: CustomerApiClientOptions): CustomerApiClient {
  const { baseUrl, devTokenKey } = options;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!baseUrl || !devTokenKey) {
    return Object.freeze({
      configured: false,
      access: async (): Promise<CustomerApiAccess> => ({ status: "not-configured" }),
      wallets: async (): Promise<CustomerApiWallets> => ({ status: "not-configured" })
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
      throw new CustomerApiHttpError(response.status);
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

  async function wallets(bffSubject: string, nowMs: number): Promise<CustomerApiWallets> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/wallets", token, nowMs);
      const view = parseWalletsView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", wallets: view };
    } catch (error) {
      if (error instanceof CustomerApiHttpError && error.status === 403) {
        return { status: "denied" };
      }
      return { status: "unavailable" };
    }
  }

  return Object.freeze({ configured: true, access, wallets });
}
