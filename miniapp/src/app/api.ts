import type {
  ActivityView,
  AddressScreeningView,
  CheckPreview,
  CheckView,
  ChecksView,
  DepositsView,
  DeviceSessionsView,
  ExchangeOrdersView,
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
} from "../shared/api";
import type { ScreeningAsset, ScreeningNetwork } from "../shared/address-screening";
import type { AssetCode } from "../shared/assets";
import type { SupportCategory } from "../shared/support";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly reason?: string) {
    super(code);
    this.name = "ApiError";
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
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = (payload ?? {}) as { error?: unknown; reason?: unknown };
    throw new ApiError(
      response.status,
      typeof record.error === "string" ? record.error : "request_failed",
      typeof record.reason === "string" ? record.reason : undefined
    );
  }
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
  payments: () => call<PaymentsView>("/bff/payments"),
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
