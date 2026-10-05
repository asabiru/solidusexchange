import type {
  HealthView,
  KycStatus,
  OperationDetail,
  OperationSummary,
  ProfileView,
  QuotePreview,
  SessionView,
  WalletView
} from "../shared/api";
import type { AssetCode } from "../shared/assets";

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
  operations: () => call<{ operations: OperationSummary[] }>("/bff/operations"),
  operation: (id: string) => call<OperationDetail>(`/bff/operations/${encodeURIComponent(id)}`),
  profile: () => call<ProfileView>("/bff/profile"),
  quote: (from: AssetCode, to: AssetCode, amount: string) => {
    const query = new URLSearchParams({ from, to, amount });
    return call<QuotePreview>(`/bff/quotes/preview?${query.toString()}`);
  }
};
