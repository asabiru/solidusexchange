import { createHash } from "node:crypto";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";
import type { CustomerApiAccess, KycVerificationState, NotificationTemplate } from "../shared/api.js";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import { isDecimalString } from "../shared/decimal.js";
import { isNotificationTemplate, notificationIdPattern } from "./notifications.js";

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

export interface CustomerApiNotification {
  notification_id: string;
  created_at: string;
  channel: "telegram-draft";
  template: NotificationTemplate;
  locale: "ru";
  text: string;
  mode: "test";
  delivered: false;
  read: boolean;
}

export type CustomerApiNotifications =
  | { status: "ok"; unread: number; notifications: readonly CustomerApiNotification[] }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "not-configured" };

export type CustomerApiSessionKyc = "unverified" | "pending" | "verified";
type CustomerApiKycReasonCode = "SIM_DOCUMENT_UNREADABLE" | "SIM_DATA_MISMATCH";
type CustomerApiKycRequestedItem = "proof_of_address" | "selfie_retake";

export interface CustomerApiKycStatusView {
  mode: "test";
  provider: "simulator";
  session_kyc: CustomerApiSessionKyc;
  status: KycVerificationState;
  application_id?: string;
  submitted_at?: string;
  updated_at: string;
  review_deadline?: string;
  reason_codes?: readonly CustomerApiKycReasonCode[];
  requested_items?: readonly CustomerApiKycRequestedItem[];
  can_submit: boolean;
}

/**
 * The KYC status read has no "denied" arm: customer.kyc.read is granted at
 * every session KYC status upstream (a verified gate would deadlock
 * onboarding), so a 403 can only mean contract drift or misconfiguration — it
 * maps to "unavailable" with every other non-200 outcome.
 */
export type CustomerApiKyc =
  | { status: "ok"; view: CustomerApiKycStatusView }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiProfileView {
  mode: "test";
  customer_ref: string;
  display_name: string;
  locale: "en" | "ky" | "ru";
  registered_at: string;
}

/**
 * The profile read has no "denied" arm either: customer.profile.read is
 * granted at every session KYC status upstream (like customer.kyc.read), so
 * a 403 can only mean contract drift — it maps to "unavailable" with every
 * other non-200 outcome.
 */
export type CustomerApiProfile =
  | { status: "ok"; view: CustomerApiProfileView }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiClient {
  readonly configured: boolean;
  access(bffSubject: string, nowMs: number): Promise<CustomerApiAccess>;
  wallets(bffSubject: string, nowMs: number): Promise<CustomerApiWallets>;
  notifications(bffSubject: string, nowMs: number): Promise<CustomerApiNotifications>;
  kyc(bffSubject: string, nowMs: number): Promise<CustomerApiKyc>;
  profile(bffSubject: string, nowMs: number): Promise<CustomerApiProfile>;
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

const isoTimestampPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

function parseNotificationsView(
  value: unknown
): { unread: number; notifications: readonly CustomerApiNotification[] } | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["delivery", "mode", "notifications", "unread"])
    || value.mode !== "test"
    || value.delivery !== "disabled"
    || typeof value.unread !== "number"
    || !Number.isSafeInteger(value.unread)
    || value.unread < 0
    || !Array.isArray(value.notifications)
  ) {
    return undefined;
  }
  const notifications: CustomerApiNotification[] = [];
  for (const entry of value.notifications) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, [
        "notification_id",
        "created_at",
        "channel",
        "template",
        "locale",
        "text",
        "mode",
        "delivered",
        "read"
      ])
      || typeof entry.notification_id !== "string"
      || !notificationIdPattern.test(entry.notification_id)
      || typeof entry.created_at !== "string"
      || !isoTimestampPattern.test(entry.created_at)
      || !Number.isFinite(Date.parse(entry.created_at))
      || entry.channel !== "telegram-draft"
      || typeof entry.template !== "string"
      || !isNotificationTemplate(entry.template)
      || entry.locale !== "ru"
      || typeof entry.text !== "string"
      || entry.text.length < 1
      || entry.text.length > 128
      || entry.mode !== "test"
      || entry.delivered !== false
      || typeof entry.read !== "boolean"
    ) {
      return undefined;
    }
    notifications.push(Object.freeze({
      notification_id: entry.notification_id,
      created_at: entry.created_at,
      channel: entry.channel,
      template: entry.template,
      locale: entry.locale,
      text: entry.text,
      mode: entry.mode,
      delivered: entry.delivered,
      read: entry.read
    }));
  }
  return Object.freeze({ unread: value.unread, notifications: Object.freeze(notifications) });
}

const kycSessionStatuses: readonly CustomerApiSessionKyc[] = ["unverified", "pending", "verified"];
const kycApplicationStatuses: readonly KycVerificationState[] = [
  "not_started",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "needs_more_data",
  "timed_out",
  "unavailable"
];
const kycReasonCodes: readonly CustomerApiKycReasonCode[] = ["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"];
const kycRequestedItems: readonly CustomerApiKycRequestedItem[] = ["proof_of_address", "selfie_retake"];
const kycApplicationIdPattern = /^kyc_[0-9a-f]{24}$/;
const kycStatusViewKeys = [
  "application_id",
  "can_submit",
  "mode",
  "provider",
  "reason_codes",
  "requested_items",
  "review_deadline",
  "session_kyc",
  "status",
  "submitted_at",
  "updated_at"
] as const;
const kycStatusRequiredKeys = ["can_submit", "mode", "provider", "session_kyc", "status", "updated_at"] as const;

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && isoTimestampPattern.test(value) && Number.isFinite(Date.parse(value));
}

function isCodeList(value: unknown, allowed: readonly string[]): boolean {
  return (
    Array.isArray(value)
    && value.length >= 1
    && value.length <= allowed.length
    && new Set(value).size === value.length
    && value.every((item) => typeof item === "string" && allowed.includes(item))
  );
}

const profileLocales: readonly CustomerApiProfileView["locale"][] = ["en", "ky", "ru"];
const profileCustomerRefPattern = /^SC-DEV-[0-9A-Z]{5}$/;
const profileDisplayNamePattern = /^Customer [0-9a-f]{8}$/;

function parseProfileView(value: unknown): CustomerApiProfileView | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["customer_ref", "display_name", "locale", "mode", "registered_at"])
    || value.mode !== "test"
    || typeof value.customer_ref !== "string"
    || !profileCustomerRefPattern.test(value.customer_ref)
    || typeof value.display_name !== "string"
    || !profileDisplayNamePattern.test(value.display_name)
    || typeof value.locale !== "string"
    || !profileLocales.includes(value.locale as CustomerApiProfileView["locale"])
    || !isIsoTimestamp(value.registered_at)
  ) {
    return undefined;
  }
  return Object.freeze({
    mode: "test",
    customer_ref: value.customer_ref,
    display_name: value.display_name,
    locale: value.locale as CustomerApiProfileView["locale"],
    registered_at: value.registered_at
  });
}

function parseKycStatusView(value: unknown): CustomerApiKycStatusView | undefined {
  if (
    !isRecord(value)
    || !kycStatusRequiredKeys.every((key) => Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !kycStatusViewKeys.includes(key as (typeof kycStatusViewKeys)[number]))
    || value.mode !== "test"
    || value.provider !== "simulator"
    || typeof value.session_kyc !== "string"
    || !kycSessionStatuses.includes(value.session_kyc as CustomerApiSessionKyc)
    || typeof value.status !== "string"
    || !kycApplicationStatuses.includes(value.status as KycVerificationState)
    || !isIsoTimestamp(value.updated_at)
    || typeof value.can_submit !== "boolean"
  ) {
    return undefined;
  }
  const applicationFields = ["application_id", "submitted_at", "review_deadline", "reason_codes", "requested_items"];
  if (
    applicationFields.some((field) => Object.hasOwn(value, field))
    && !(typeof value.application_id === "string"
      && kycApplicationIdPattern.test(value.application_id)
      && isIsoTimestamp(value.submitted_at))
  ) {
    return undefined;
  }
  if (
    (Object.hasOwn(value, "review_deadline") && !isIsoTimestamp(value.review_deadline))
    || (Object.hasOwn(value, "reason_codes") && !isCodeList(value.reason_codes, kycReasonCodes))
    || (Object.hasOwn(value, "requested_items") && !isCodeList(value.requested_items, kycRequestedItems))
  ) {
    return undefined;
  }
  const view: CustomerApiKycStatusView = {
    mode: "test",
    provider: "simulator",
    session_kyc: value.session_kyc as CustomerApiSessionKyc,
    status: value.status as KycVerificationState,
    updated_at: value.updated_at,
    can_submit: value.can_submit
  };
  if (value.application_id !== undefined) view.application_id = value.application_id as string;
  if (value.submitted_at !== undefined) view.submitted_at = value.submitted_at as string;
  if (value.review_deadline !== undefined) view.review_deadline = value.review_deadline as string;
  if (value.reason_codes !== undefined) view.reason_codes = Object.freeze([...(value.reason_codes as string[])]) as readonly CustomerApiKycReasonCode[];
  if (value.requested_items !== undefined) view.requested_items = Object.freeze([...(value.requested_items as string[])]) as readonly CustomerApiKycRequestedItem[];
  return Object.freeze(view);
}

class CustomerApiHttpError extends Error {
  constructor(readonly status: number) {
    super("customer-api request failed");
    this.name = "CustomerApiHttpError";
  }
}

/**
 * Server-side, read-only client for the dev customer API. It only issues the
 * customer session, capabilities, wallets, notifications, kyc and profile
 * GETs, never sends X-Device-Id and fails closed to "unavailable" on any
 * unexpected response, including a non-JSON content type or a body above
 * maxCustomerApiResponseBytes. An upstream refusal of a collection read (403
 * capability gate) surfaces as "denied"; the KYC status and profile reads
 * are never gated upstream, so they report every non-200 outcome as
 * "unavailable".
 */
export function createCustomerApiClient(options: CustomerApiClientOptions): CustomerApiClient {
  const { baseUrl, devTokenKey } = options;
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!baseUrl || !devTokenKey) {
    return Object.freeze({
      configured: false,
      access: async (): Promise<CustomerApiAccess> => ({ status: "not-configured" }),
      wallets: async (): Promise<CustomerApiWallets> => ({ status: "not-configured" }),
      notifications: async (): Promise<CustomerApiNotifications> => ({ status: "not-configured" }),
      kyc: async (): Promise<CustomerApiKyc> => ({ status: "not-configured" }),
      profile: async (): Promise<CustomerApiProfile> => ({ status: "not-configured" })
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

  async function notifications(bffSubject: string, nowMs: number): Promise<CustomerApiNotifications> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/notifications", token, nowMs);
      const view = parseNotificationsView(body);
      return view === undefined
        ? { status: "unavailable" }
        : { status: "ok", unread: view.unread, notifications: view.notifications };
    } catch (error) {
      if (error instanceof CustomerApiHttpError && error.status === 403) {
        return { status: "denied" };
      }
      return { status: "unavailable" };
    }
  }

  async function kyc(bffSubject: string, nowMs: number): Promise<CustomerApiKyc> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/kyc", token, nowMs);
      const view = parseKycStatusView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      // No 403 carve-out: the read is granted at every upstream session
      // status, so a refusal is upstream contract drift, not a real denial.
      return { status: "unavailable" };
    }
  }

  async function profile(bffSubject: string, nowMs: number): Promise<CustomerApiProfile> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/profile", token, nowMs);
      const view = parseProfileView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      // No 403 carve-out, like kyc(): the read is granted at every upstream
      // session status, so a refusal is contract drift, not a real denial.
      return { status: "unavailable" };
    }
  }

  return Object.freeze({ configured: true, access, wallets, notifications, kyc, profile });
}
