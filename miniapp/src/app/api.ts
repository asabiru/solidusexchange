import type {
  ActivityView,
  AddressScreeningView,
  CardsView,
  CheckPreview,
  CheckView,
  ChecksView,
  DepositsView,
  DeviceSessionsView,
  DocumentsView,
  ExchangeOrdersView,
  MarketDepthView,
  MarketsView,
  TradesView,
  HealthView,
  KycStatus,
  KycVerificationView,
  NotificationsView,
  OperationDetail,
  OperationSummary,
  PaymentsView,
  ProfileView,
  QuotePreview,
  QuotesView,
  SessionView,
  SupportRequestView,
  SupportRequestsView,
  WalletView,
  WithdrawalsView
} from "../shared/api.js";
import type { ScreeningAsset, ScreeningNetwork } from "../shared/address-screening.js";
import type { AssetCode } from "../shared/assets.js";
import type { SupportCategory } from "../shared/support.js";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly reason?: string) {
    super(code);
    this.name = "ApiError";
  }
}

// Body bound and canonical-depth bound mirror the backoffice BFF client: an
// oversized or unparseable payload is a rejected response, never a silent {}.
const MAX_BFF_RESPONSE_BYTES = 262_144;
const MAX_PAYLOAD_DEPTH = 16;

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Miniapp response is not JSON");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && !(/^\d{1,9}$/.test(declared) && Number(declared) <= MAX_BFF_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Miniapp response too large");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BFF_RESPONSE_BYTES) {
      throw new Error("Miniapp response too large");
    }
    return JSON.parse(text) as unknown;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BFF_RESPONSE_BYTES) throw new Error("Miniapp response too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCanonicalJson(value: unknown, depth = 0): void {
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new Error("Miniapp response payload is not canonical JSON");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error("Miniapp response payload is not canonical JSON");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalJson(item, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertCanonicalJson(item, depth + 1);
  }
}

async function call<T>(path: string, body?: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body
      ? { accept: "application/json", "content-type": "application/json" }
      : { accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    // Error bodies only carry the error/reason strings the app surfaces; a
    // bound- or type-violating detail collapses to request_failed, never a
    // thrown read error that would mask the HTTP status.
    const payload: unknown = await readBoundedJson(response).catch(() => ({}));
    const record = (payload ?? {}) as { error?: unknown; reason?: unknown };
    throw new ApiError(
      response.status,
      typeof record.error === "string" ? record.error : "request_failed",
      typeof record.reason === "string" ? record.reason : undefined
    );
  }
  const payload: unknown = await readBoundedJson(response);
  assertCanonicalJson(payload);
  return payload as T;
}

export const api = {
  health: () => call<HealthView>("/bff/health"),
  session: () => call<SessionView>("/bff/session"),
  devLogin: (kyc: KycStatus) => call<SessionView>("/bff/auth/dev-session", { kyc }),
  telegramLogin: (initData: string) => call<SessionView>("/bff/session/telegram", { initData }),
  logout: () => call<{ ok: true }>("/bff/auth/logout", {}),
  wallet: () => call<WalletView>("/bff/wallet"),
  deposits: () => call<DepositsView>("/bff/deposits"),
  withdrawals: () => call<WithdrawalsView>("/bff/withdrawals"),
  quotes: () => call<QuotesView>("/bff/quotes"),
  exchangeOrders: () => call<ExchangeOrdersView>("/bff/exchange-orders"),
  trades: () => call<TradesView>("/bff/trades"),
  markets: () => call<MarketsView>("/bff/markets"),
  marketDepth: (instrument: string) => call<MarketDepthView>(`/bff/markets/${encodeURIComponent(instrument)}`),
  payments: () => call<PaymentsView>("/bff/payments"),
  cards: () => call<CardsView>("/bff/cards"),
  operations: () => call<{ operations: OperationSummary[] }>("/bff/operations"),
  operation: (id: string) => call<OperationDetail>(`/bff/operations/${encodeURIComponent(id)}`),
  profile: () => call<ProfileView>("/bff/profile"),
  kycStatus: () => call<KycVerificationView>("/bff/kyc/status"),
  submitKyc: () => call<KycVerificationView>("/bff/kyc/applications", {}),
  notifications: () => call<NotificationsView>("/bff/notifications"),
  activity: () => call<ActivityView>("/bff/activity"),
  sessions: () => call<DeviceSessionsView>("/bff/sessions"),
  revokeSession: (handle: string) => call<DeviceSessionsView>("/bff/sessions/revoke", { handle }),
  revokeOtherSessions: () => call<DeviceSessionsView>("/bff/sessions/revoke-others", {}),
  screenAddress: (asset: ScreeningAsset, network: ScreeningNetwork, address: string) =>
    call<AddressScreeningView>("/bff/address-screening", { asset, network, address }),
  supportRequests: () => call<SupportRequestsView>("/bff/support/requests"),
  documents: () => call<DocumentsView>("/bff/documents"),
  createSupportRequest: (category: SupportCategory, topic: string, message: string, activityId?: string) =>
    call<SupportRequestView>("/bff/support/requests", activityId ? { category, topic, message, activityId } : { category, topic, message }),
  addressScreening: (id: string) => call<AddressScreeningView>(`/bff/address-screening/${encodeURIComponent(id)}`),
  quote: (from: AssetCode, to: AssetCode, amount: string) => {
    const query = new URLSearchParams({ from, to, amount });
    return call<QuotePreview>(`/bff/quotes/preview?${query.toString()}`);
  },
  checks: () => call<ChecksView>("/bff/checks"),
  check: (reference: string) => call<CheckView>(`/bff/checks/${encodeURIComponent(reference)}`),
  checkPreview: (asset: AssetCode, amount: string) => {
    const query = new URLSearchParams({ asset, amount });
    return call<CheckPreview>(`/bff/checks/preview?${query.toString()}`);
  }
};
