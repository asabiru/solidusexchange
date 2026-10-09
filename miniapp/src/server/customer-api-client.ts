import { createHash } from "node:crypto";
import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";
import type {
  CustomerApiAccess,
  DepositStatus,
  ExchangeOrderStatus,
  ExchangeOrderType,
  KycVerificationState,
  NotificationTemplate,
  QuotePair,
  QuoteRounding,
  QuoteSide,
  WithdrawalStatus
} from "../shared/api.js";
import type { ScreeningNetwork } from "../shared/address-screening.js";
import { type AssetCode, assets, isAssetCode } from "../shared/assets.js";
import { fromUnits, isDecimalString, toUnits } from "../shared/decimal.js";
import { type SupportCategory, type SupportStatus, isSupportCategory, isSupportStatus } from "../shared/support.js";
import { depositIdPattern, depositPaymentReferencePattern, isDepositStatus } from "./deposits.js";
import {
  contractExchangeOrderAmounts,
  exchangeOrderIdPattern,
  exchangeOrderMaxBps,
  exchangeOrderPriceScale,
  isExchangeOrderStatus,
  isExchangeOrderType
} from "./exchange-orders.js";
import { isNotificationTemplate, notificationIdPattern } from "./notifications.js";
import {
  contractQuoteAmounts,
  contractQuotePair,
  isQuoteSide,
  quoteIdPattern,
  quoteMaxBps,
  quoteMaxTtlSeconds,
  quotePriceScale
} from "./quotes.js";
import {
  destinationReferencePattern,
  isWithdrawalNetwork,
  isWithdrawalPair,
  isWithdrawalStatus,
  withdrawalIdPattern,
  withdrawalLegIdPattern
} from "./withdrawals.js";

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

export interface CustomerApiDeposit {
  deposit_id: string;
  asset: AssetCode;
  method: "sbp";
  status: DepositStatus;
  expected_amount: string;
  received_total: string;
  reversed_total: string;
  payment_reference: string;
  created_at: string;
  updated_at: string;
  posting: "none";
}

export type CustomerApiDeposits =
  | { status: "ok"; deposits: readonly CustomerApiDeposit[] }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiWithdrawalLeg {
  leg_id: string;
  asset: AssetCode;
  amount: string;
  direction: "out";
}

export interface CustomerApiWithdrawal {
  withdrawal_id: string;
  asset: AssetCode;
  network: ScreeningNetwork;
  status: WithdrawalStatus;
  amount: string;
  fee_amount: string;
  destination_reference: string;
  legs: readonly CustomerApiWithdrawalLeg[];
  created_at: string;
  updated_at: string;
  expires_at: string;
  posting: "none";
}

export type CustomerApiWithdrawals =
  | { status: "ok"; withdrawals: readonly CustomerApiWithdrawal[] }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiQuote {
  quote_id: string;
  pair: QuotePair;
  base_asset: AssetCode;
  quote_asset: AssetCode;
  side: QuoteSide;
  base_amount: string;
  mid_price: string;
  price: string;
  spread_bps: number;
  fee_bps: number;
  quote_amount: string;
  fee_amount: string;
  total_quote_amount: string;
  rounding: QuoteRounding;
  price_observed_at: string;
  issued_at: string;
  expires_at: string;
  ttl_seconds: number;
  status: "indicative";
  execution: "not_supported";
  posting: "none";
}

export type CustomerApiQuotes =
  | { status: "ok"; quotes: readonly CustomerApiQuote[] }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiExchangeOrder {
  order_id: string;
  pair: QuotePair;
  base_asset: AssetCode;
  quote_asset: AssetCode;
  side: QuoteSide;
  order_type: ExchangeOrderType;
  base_amount: string;
  price: string;
  quote_amount: string;
  fee_bps: number;
  fee_amount: string;
  total_quote_amount: string;
  status: ExchangeOrderStatus;
  created_at: string;
  updated_at: string;
  execution: "not_supported";
  posting: "none";
}

export type CustomerApiExchangeOrders =
  | { status: "ok"; orders: readonly CustomerApiExchangeOrder[] }
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

export interface CustomerApiTicketTimelineEntry {
  status: SupportStatus;
  at: string;
}

export interface CustomerApiTicketView {
  ticket_id: string;
  category: SupportCategory;
  topic: string;
  message: string;
  status: SupportStatus;
  timeline: readonly CustomerApiTicketTimelineEntry[];
  complaint_acknowledged: boolean;
  created_at: string;
  expires_at: string;
}

export interface CustomerApiSupportTicketsView {
  mode: "test";
  delivery: "disabled";
  tickets: readonly CustomerApiTicketView[];
}

/**
 * The support tickets read has no "denied" arm either: customer.support.read
 * is granted at every session KYC status upstream (like customer.kyc.read and
 * customer.profile.read), so a 403 can only mean contract drift — it maps to
 * "unavailable" with every other non-200 outcome.
 */
export type CustomerApiSupport =
  | { status: "ok"; view: CustomerApiSupportTicketsView }
  | { status: "unavailable" }
  | { status: "not-configured" };

export interface CustomerApiClient {
  readonly configured: boolean;
  access(bffSubject: string, nowMs: number): Promise<CustomerApiAccess>;
  wallets(bffSubject: string, nowMs: number): Promise<CustomerApiWallets>;
  deposits(bffSubject: string, nowMs: number): Promise<CustomerApiDeposits>;
  withdrawals(bffSubject: string, nowMs: number): Promise<CustomerApiWithdrawals>;
  quotes(bffSubject: string, nowMs: number): Promise<CustomerApiQuotes>;
  exchangeOrders(bffSubject: string, nowMs: number): Promise<CustomerApiExchangeOrders>;
  notifications(bffSubject: string, nowMs: number): Promise<CustomerApiNotifications>;
  kyc(bffSubject: string, nowMs: number): Promise<CustomerApiKyc>;
  profile(bffSubject: string, nowMs: number): Promise<CustomerApiProfile>;
  support(bffSubject: string, nowMs: number): Promise<CustomerApiSupport>;
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

const depositKeys = [
  "deposit_id",
  "asset",
  "method",
  "status",
  "expected_amount",
  "received_total",
  "reversed_total",
  "payment_reference",
  "created_at",
  "updated_at",
  "posting"
] as const;

function parseDepositsView(value: unknown): readonly CustomerApiDeposit[] | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["deposits", "mode"])
    || value.mode !== "test"
    || !Array.isArray(value.deposits)
  ) {
    return undefined;
  }
  const deposits: CustomerApiDeposit[] = [];
  for (const entry of value.deposits) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, depositKeys)
      || typeof entry.deposit_id !== "string"
      || !depositIdPattern.test(entry.deposit_id)
      || typeof entry.asset !== "string"
      || !isAssetCode(entry.asset)
      || entry.method !== "sbp"
      || !isDepositStatus(entry.status)
      || typeof entry.expected_amount !== "string"
      || typeof entry.received_total !== "string"
      || typeof entry.reversed_total !== "string"
      || !isDecimalString(entry.expected_amount, assets[entry.asset].scale)
      || !isDecimalString(entry.received_total, assets[entry.asset].scale)
      || !isDecimalString(entry.reversed_total, assets[entry.asset].scale)
      || typeof entry.payment_reference !== "string"
      || !depositPaymentReferencePattern.test(entry.payment_reference)
      || !isIsoTimestamp(entry.created_at)
      || !isIsoTimestamp(entry.updated_at)
      || entry.posting !== "none"
    ) {
      return undefined;
    }
    deposits.push(Object.freeze({
      deposit_id: entry.deposit_id,
      asset: entry.asset,
      method: entry.method,
      status: entry.status,
      expected_amount: entry.expected_amount,
      received_total: entry.received_total,
      reversed_total: entry.reversed_total,
      payment_reference: entry.payment_reference,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      posting: entry.posting
    }));
  }
  return Object.freeze(deposits);
}

const withdrawalKeys = [
  "withdrawal_id",
  "asset",
  "network",
  "status",
  "amount",
  "fee_amount",
  "destination_reference",
  "legs",
  "created_at",
  "updated_at",
  "expires_at",
  "posting"
] as const;
const withdrawalLegKeys = ["leg_id", "asset", "amount", "direction"] as const;

function parseWithdrawalsView(value: unknown): readonly CustomerApiWithdrawal[] | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["withdrawals", "mode"])
    || value.mode !== "test"
    || !Array.isArray(value.withdrawals)
  ) {
    return undefined;
  }
  const withdrawals: CustomerApiWithdrawal[] = [];
  for (const entry of value.withdrawals) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, withdrawalKeys)
      || typeof entry.withdrawal_id !== "string"
      || !withdrawalIdPattern.test(entry.withdrawal_id)
      || !isWithdrawalNetwork(entry.network)
      || !isWithdrawalPair(entry.asset, entry.network)
      || !isWithdrawalStatus(entry.status)
      || typeof entry.amount !== "string"
      || typeof entry.fee_amount !== "string"
      || !isDecimalString(entry.amount, assets[entry.asset].scale)
      || !isDecimalString(entry.fee_amount, assets[entry.asset].scale)
      || typeof entry.destination_reference !== "string"
      || !destinationReferencePattern.test(entry.destination_reference)
      || !Array.isArray(entry.legs)
      // The contract's two out-legs are principal first, fee second.
      || entry.legs.length !== 2
      || !isIsoTimestamp(entry.created_at)
      || !isIsoTimestamp(entry.updated_at)
      || !isIsoTimestamp(entry.expires_at)
      || entry.posting !== "none"
    ) {
      return undefined;
    }
    const legs: CustomerApiWithdrawalLeg[] = [];
    let legsOk = true;
    for (const [index, leg] of entry.legs.entries()) {
      if (
        !isRecord(leg)
        || !hasExactKeys(leg, withdrawalLegKeys)
        || typeof leg.leg_id !== "string"
        || !withdrawalLegIdPattern.test(leg.leg_id)
        || leg.asset !== entry.asset
        || typeof leg.amount !== "string"
        || !isDecimalString(leg.amount, assets[entry.asset].scale)
        || leg.direction !== "out"
        || leg.amount !== (index === 0 ? entry.amount : entry.fee_amount)
      ) {
        legsOk = false;
        break;
      }
      legs.push(Object.freeze({
        leg_id: leg.leg_id,
        asset: entry.asset,
        amount: leg.amount,
        direction: leg.direction
      }));
    }
    if (!legsOk) return undefined;
    withdrawals.push(Object.freeze({
      withdrawal_id: entry.withdrawal_id,
      asset: entry.asset,
      network: entry.network,
      status: entry.status,
      amount: entry.amount,
      fee_amount: entry.fee_amount,
      destination_reference: entry.destination_reference,
      legs: Object.freeze(legs),
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      expires_at: entry.expires_at,
      posting: entry.posting
    }));
  }
  return Object.freeze(withdrawals);
}

const quoteKeys = [
  "quote_id",
  "pair",
  "base_asset",
  "quote_asset",
  "side",
  "base_amount",
  "mid_price",
  "price",
  "spread_bps",
  "fee_bps",
  "quote_amount",
  "fee_amount",
  "total_quote_amount",
  "rounding",
  "price_observed_at",
  "issued_at",
  "expires_at",
  "ttl_seconds",
  "status",
  "execution",
  "posting"
] as const;

/** Canonical non-negative decimal string with exactly `scale` fraction digits (mirrors the contract's isScaledDecimal). */
function isScaledDecimal(value: unknown, scale: number): value is string {
  return typeof value === "string" && new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u").test(value);
}

function parseQuotesView(value: unknown): readonly CustomerApiQuote[] | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["mode", "quotes"])
    || value.mode !== "test"
    || !Array.isArray(value.quotes)
  ) {
    return undefined;
  }
  const quotes: CustomerApiQuote[] = [];
  for (const entry of value.quotes) {
    const pairDef = isRecord(entry) ? contractQuotePair(entry.pair) : undefined;
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, quoteKeys)
      || pairDef === undefined
      || entry.base_asset !== pairDef.base
      || entry.quote_asset !== pairDef.quote
      || !isQuoteSide(entry.side)
      || entry.rounding !== (entry.side === "buy" ? "up" : "down")
      || typeof entry.quote_id !== "string"
      || !quoteIdPattern.test(entry.quote_id)
      || typeof entry.spread_bps !== "number"
      || !Number.isSafeInteger(entry.spread_bps)
      || entry.spread_bps < 0
      || entry.spread_bps > quoteMaxBps
      || typeof entry.fee_bps !== "number"
      || !Number.isSafeInteger(entry.fee_bps)
      || entry.fee_bps < 0
      || entry.fee_bps > quoteMaxBps
      || typeof entry.ttl_seconds !== "number"
      || !Number.isSafeInteger(entry.ttl_seconds)
      || entry.ttl_seconds < 1
      || entry.ttl_seconds > quoteMaxTtlSeconds
      || !isScaledDecimal(entry.base_amount, pairDef.baseScale)
      || !isScaledDecimal(entry.mid_price, quotePriceScale)
      || !isScaledDecimal(entry.price, quotePriceScale)
      || !isScaledDecimal(entry.quote_amount, pairDef.quoteScale)
      || !isScaledDecimal(entry.fee_amount, pairDef.quoteScale)
      || !isScaledDecimal(entry.total_quote_amount, pairDef.quoteScale)
      || !isIsoTimestamp(entry.price_observed_at)
      || !isIsoTimestamp(entry.issued_at)
      || !isIsoTimestamp(entry.expires_at)
      || entry.status !== "indicative"
      || entry.execution !== "not_supported"
      || entry.posting !== "none"
    ) {
      return undefined;
    }
    const issued = Date.parse(entry.issued_at);
    const expires = Date.parse(entry.expires_at);
    const observed = Date.parse(entry.price_observed_at);
    if (expires - issued !== entry.ttl_seconds * 1_000 || observed > issued) {
      return undefined;
    }
    // Fail closed unless every derived amount recomputes exactly like the
    // upstream contract validator requires.
    const recomputed = contractQuoteAmounts(
      pairDef,
      entry.side,
      toUnits(entry.base_amount, pairDef.baseScale),
      toUnits(entry.mid_price, quotePriceScale),
      entry.spread_bps,
      entry.fee_bps
    );
    if (
      fromUnits(recomputed.price, quotePriceScale) !== entry.price
      || fromUnits(recomputed.quoteUnits, pairDef.quoteScale) !== entry.quote_amount
      || fromUnits(recomputed.fee, pairDef.quoteScale) !== entry.fee_amount
      || fromUnits(recomputed.total, pairDef.quoteScale) !== entry.total_quote_amount
      || recomputed.quoteUnits <= 0n
      || recomputed.total <= 0n
    ) {
      return undefined;
    }
    quotes.push(Object.freeze({
      quote_id: entry.quote_id,
      pair: pairDef.pair,
      base_asset: pairDef.base,
      quote_asset: pairDef.quote,
      side: entry.side,
      base_amount: entry.base_amount,
      mid_price: entry.mid_price,
      price: entry.price,
      spread_bps: entry.spread_bps,
      fee_bps: entry.fee_bps,
      quote_amount: entry.quote_amount,
      fee_amount: entry.fee_amount,
      total_quote_amount: entry.total_quote_amount,
      rounding: entry.side === "buy" ? "up" : "down",
      price_observed_at: entry.price_observed_at,
      issued_at: entry.issued_at,
      expires_at: entry.expires_at,
      ttl_seconds: entry.ttl_seconds,
      status: "indicative",
      execution: "not_supported",
      posting: "none"
    }));
  }
  return Object.freeze(quotes);
}

const exchangeOrderKeys = [
  "order_id",
  "pair",
  "base_asset",
  "quote_asset",
  "side",
  "order_type",
  "base_amount",
  "price",
  "quote_amount",
  "fee_bps",
  "fee_amount",
  "total_quote_amount",
  "status",
  "created_at",
  "updated_at",
  "execution",
  "posting"
] as const;

function parseExchangeOrdersView(value: unknown): readonly CustomerApiExchangeOrder[] | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["mode", "orders"])
    || value.mode !== "test"
    || !Array.isArray(value.orders)
  ) {
    return undefined;
  }
  const orders: CustomerApiExchangeOrder[] = [];
  for (const entry of value.orders) {
    const pairDef = isRecord(entry) ? contractQuotePair(entry.pair) : undefined;
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, exchangeOrderKeys)
      || pairDef === undefined
      || entry.base_asset !== pairDef.base
      || entry.quote_asset !== pairDef.quote
      || !isQuoteSide(entry.side)
      || !isExchangeOrderType(entry.order_type)
      || typeof entry.order_id !== "string"
      || !exchangeOrderIdPattern.test(entry.order_id)
      || typeof entry.fee_bps !== "number"
      || !Number.isSafeInteger(entry.fee_bps)
      || entry.fee_bps < 0
      || entry.fee_bps > exchangeOrderMaxBps
      || !isScaledDecimal(entry.base_amount, pairDef.baseScale)
      || !isScaledDecimal(entry.price, exchangeOrderPriceScale)
      || !isScaledDecimal(entry.quote_amount, pairDef.quoteScale)
      || !isScaledDecimal(entry.fee_amount, pairDef.quoteScale)
      || !isScaledDecimal(entry.total_quote_amount, pairDef.quoteScale)
      || !isIsoTimestamp(entry.created_at)
      || !isIsoTimestamp(entry.updated_at)
      || !isExchangeOrderStatus(entry.status)
      || entry.execution !== "not_supported"
      || entry.posting !== "none"
    ) {
      return undefined;
    }
    const created = Date.parse(entry.created_at);
    const updated = Date.parse(entry.updated_at);
    // The contract lifecycle: updated never precedes created, and an order
    // still open has seen no update yet.
    if (updated < created || (entry.status === "open" && updated !== created)) {
      return undefined;
    }
    // Fail closed unless every derived amount recomputes exactly like the
    // upstream contract validator requires.
    const recomputed = contractExchangeOrderAmounts(
      pairDef,
      entry.side,
      toUnits(entry.base_amount, pairDef.baseScale),
      toUnits(entry.price, exchangeOrderPriceScale),
      entry.fee_bps
    );
    if (
      fromUnits(recomputed.quoteUnits, pairDef.quoteScale) !== entry.quote_amount
      || fromUnits(recomputed.fee, pairDef.quoteScale) !== entry.fee_amount
      || fromUnits(recomputed.total, pairDef.quoteScale) !== entry.total_quote_amount
      || recomputed.quoteUnits <= 0n
      || recomputed.total <= 0n
    ) {
      return undefined;
    }
    orders.push(Object.freeze({
      order_id: entry.order_id,
      pair: pairDef.pair,
      base_asset: pairDef.base,
      quote_asset: pairDef.quote,
      side: entry.side,
      order_type: entry.order_type,
      base_amount: entry.base_amount,
      price: entry.price,
      quote_amount: entry.quote_amount,
      fee_bps: entry.fee_bps,
      fee_amount: entry.fee_amount,
      total_quote_amount: entry.total_quote_amount,
      status: entry.status,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      execution: "not_supported",
      posting: "none"
    }));
  }
  return Object.freeze(orders);
}

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

const supportTicketIdPattern = /^tck_[0-9a-f]{24}$/;
const supportTicketKeys = [
  "ticket_id",
  "category",
  "topic",
  "message",
  "status",
  "timeline",
  "complaint_acknowledged",
  "created_at",
  "expires_at"
] as const;
const supportTimelineKeys = ["at", "status"] as const;
const supportTopicMaxLength = 120;
const supportMessageMaxLength = 1_000;

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

function parseSupportView(value: unknown): CustomerApiSupportTicketsView | undefined {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["delivery", "mode", "tickets"])
    || value.mode !== "test"
    || value.delivery !== "disabled"
    || !Array.isArray(value.tickets)
  ) {
    return undefined;
  }
  const tickets: CustomerApiTicketView[] = [];
  for (const entry of value.tickets) {
    if (
      !isRecord(entry)
      || !hasExactKeys(entry, supportTicketKeys)
      || typeof entry.ticket_id !== "string"
      || !supportTicketIdPattern.test(entry.ticket_id)
      || !isSupportCategory(entry.category)
      || typeof entry.topic !== "string"
      || [...entry.topic].length < 1
      || [...entry.topic].length > supportTopicMaxLength
      || typeof entry.message !== "string"
      || [...entry.message].length < 1
      || [...entry.message].length > supportMessageMaxLength
      || !isSupportStatus(entry.status)
      || !Array.isArray(entry.timeline)
      || entry.timeline.length < 1
      || typeof entry.complaint_acknowledged !== "boolean"
      || !isIsoTimestamp(entry.created_at)
      || !isIsoTimestamp(entry.expires_at)
    ) {
      return undefined;
    }
    const timeline: CustomerApiTicketTimelineEntry[] = [];
    for (const step of entry.timeline) {
      if (
        !isRecord(step)
        || !hasExactKeys(step, supportTimelineKeys)
        || !isSupportStatus(step.status)
        || !isIsoTimestamp(step.at)
      ) {
        return undefined;
      }
      timeline.push(Object.freeze({ status: step.status, at: step.at }));
    }
    if (timeline.at(-1)?.status !== entry.status) return undefined;
    tickets.push(Object.freeze({
      ticket_id: entry.ticket_id,
      category: entry.category,
      topic: entry.topic,
      message: entry.message,
      status: entry.status,
      timeline: Object.freeze(timeline),
      complaint_acknowledged: entry.complaint_acknowledged,
      created_at: entry.created_at,
      expires_at: entry.expires_at
    }));
  }
  return Object.freeze({ mode: "test", delivery: "disabled", tickets: Object.freeze(tickets) });
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
 * customer session, capabilities, wallets, deposits, withdrawals, quotes,
 * exchange-orders, notifications, kyc, profile and support GETs, never sends
 * X-Device-Id and
 * fails closed to "unavailable" on
 * any unexpected response, including a non-JSON content type or a body above
 * maxCustomerApiResponseBytes. An upstream refusal of a collection read (403
 * capability gate) surfaces as "denied"; the KYC status, profile and support
 * reads are never gated upstream, so they report every non-200 outcome as
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
      deposits: async (): Promise<CustomerApiDeposits> => ({ status: "not-configured" }),
      withdrawals: async (): Promise<CustomerApiWithdrawals> => ({ status: "not-configured" }),
      quotes: async (): Promise<CustomerApiQuotes> => ({ status: "not-configured" }),
      exchangeOrders: async (): Promise<CustomerApiExchangeOrders> => ({ status: "not-configured" }),
      notifications: async (): Promise<CustomerApiNotifications> => ({ status: "not-configured" }),
      kyc: async (): Promise<CustomerApiKyc> => ({ status: "not-configured" }),
      profile: async (): Promise<CustomerApiProfile> => ({ status: "not-configured" }),
      support: async (): Promise<CustomerApiSupport> => ({ status: "not-configured" })
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

  async function deposits(bffSubject: string, nowMs: number): Promise<CustomerApiDeposits> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/deposits", token, nowMs);
      const view = parseDepositsView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", deposits: view };
    } catch (error) {
      if (error instanceof CustomerApiHttpError && error.status === 403) {
        return { status: "denied" };
      }
      return { status: "unavailable" };
    }
  }

  async function withdrawals(bffSubject: string, nowMs: number): Promise<CustomerApiWithdrawals> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/withdrawals", token, nowMs);
      const view = parseWithdrawalsView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", withdrawals: view };
    } catch (error) {
      if (error instanceof CustomerApiHttpError && error.status === 403) {
        return { status: "denied" };
      }
      return { status: "unavailable" };
    }
  }

  async function quotes(bffSubject: string, nowMs: number): Promise<CustomerApiQuotes> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/quotes", token, nowMs);
      const view = parseQuotesView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", quotes: view };
    } catch (error) {
      if (error instanceof CustomerApiHttpError && error.status === 403) {
        return { status: "denied" };
      }
      return { status: "unavailable" };
    }
  }

  async function exchangeOrders(bffSubject: string, nowMs: number): Promise<CustomerApiExchangeOrders> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/exchange-orders", token, nowMs);
      const view = parseExchangeOrdersView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", orders: view };
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

  async function support(bffSubject: string, nowMs: number): Promise<CustomerApiSupport> {
    const subject = customerApiSubject(bffSubject);
    try {
      const token = mintSyntheticCustomerToken({
        key: devTokenKey as string,
        subject,
        expiresAtSeconds: Math.floor(nowMs / 1_000) + tokenTtlSeconds
      });
      const body = await get("/api/v1/customer/support", token, nowMs);
      const view = parseSupportView(body);
      return view === undefined ? { status: "unavailable" } : { status: "ok", view };
    } catch {
      // No 403 carve-out, like kyc() and profile(): the read is granted at
      // every upstream session status, so a refusal is contract drift, not a
      // real denial.
      return { status: "unavailable" };
    }
  }

  return Object.freeze({ configured: true, access, wallets, deposits, withdrawals, quotes, exchangeOrders, notifications, kyc, profile, support });
}
