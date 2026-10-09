import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type {
  ActivityView,
  DeviceSessionsView,
  HealthView,
  KycStatus,
  KycVerificationState,
  NotificationTemplate,
  NotificationsView,
  SessionView,
  SupportRequestsView
} from "../shared/api.js";
import { isAssetCode } from "../shared/assets.js";
import { type ActivityLog, createActivityLog, maxActivityPerSubject } from "./activity.js";
import { type CheckBook, CheckError, createCheckBook } from "./checks.js";
import { type ServerConfig, isLoopbackHostname } from "./config.js";
import { signInitData, verifyInitData } from "./init-data.js";
import { type CustomerApiClient, createCustomerApiClient } from "./customer-api-client.js";
import { type QuoteProvider, createLocalQuoteProvider, createSimulatorQuoteProvider } from "./provider-quotes.js";
import {
  type AddressScreeningService,
  ScreeningInputError,
  ScreeningRateLimitError,
  ScreeningUnavailableError,
  createAddressScreeningService
} from "./address-screening.js";
import {
  type KycService,
  KycUnavailableError,
  contractKycVerificationView,
  createKycService
} from "./kyc.js";
import {
  type NotificationOutbox,
  contractNotificationsView,
  createNotificationOutbox,
  defaultMaxPerSubject,
  notificationIdPattern
} from "./notifications.js";
import { type Gauge, createRequestObserver, metricsContentType, metricsRequestAllowed } from "./observability.js";
import { contractProfileView } from "./profile.js";
import { QuoteError } from "./quotes.js";
import { RequestBodyError, readJsonBody } from "./request-body.js";
import { apiSecurityHeaders, guardRawResponses, requestHostname } from "./security-headers.js";
import {
  type CustomerSession,
  ExpiringStore,
  createSessionHandles,
  lastSeenGranularityMs,
  sessionHandlePattern
} from "./session.js";
import {
  type SupportDesk,
  SupportInputError,
  SupportLimitError,
  SupportRateLimitError,
  contractSupportRequestsView,
  createSupportDesk
} from "./support.js";
import { syntheticData, walletView } from "./synthetic.js";

export const sessionCookie = "solidchange_ma_session";
const displayName = "Тестовый клиент";
const devTelegramUserId = 900_000_001;
const maxSessionsPerSubject = 5;
const maxRevokedHandlesPerSubject = 20;

export interface Route {
  method: "GET" | "POST";
  path: string;
}

export const routeTable: readonly Route[] = Object.freeze([
  { method: "GET", path: "/bff/health" },
  { method: "GET", path: "/bff/session" },
  { method: "POST", path: "/bff/session/telegram" },
  { method: "POST", path: "/bff/auth/dev-session" },
  { method: "POST", path: "/bff/auth/logout" },
  { method: "GET", path: "/bff/wallet" },
  { method: "GET", path: "/bff/operations" },
  { method: "GET", path: "/bff/operations/:id" },
  { method: "GET", path: "/bff/profile" },
  { method: "GET", path: "/bff/quotes/preview" },
  { method: "GET", path: "/bff/checks" },
  { method: "GET", path: "/bff/checks/preview" },
  { method: "GET", path: "/bff/checks/:id" },
  { method: "POST", path: "/bff/kyc/applications" },
  { method: "POST", path: "/bff/address-screening" },
  { method: "GET", path: "/bff/address-screening/:id" },
  { method: "GET", path: "/bff/kyc/status" },
  { method: "GET", path: "/bff/notifications" },
  { method: "GET", path: "/bff/activity" },
  { method: "GET", path: "/bff/sessions" },
  { method: "POST", path: "/bff/sessions/revoke" },
  { method: "POST", path: "/bff/sessions/revoke-others" },
  { method: "POST", path: "/bff/notifications/read" },
  { method: "POST", path: "/bff/support/requests" },
  { method: "GET", path: "/bff/support/requests" },
  { method: "GET", path: "/bff/support/requests/:id" },
  { method: "GET", path: "/bff/metrics" }
] satisfies Route[]);

export interface MiniappServerOptions {
  clock?: () => number;
  devBotToken?: string;
  quoteProvider?: QuoteProvider;
  customerApi?: CustomerApiClient;
  kyc?: KycService;
  addressScreening?: AddressScreeningService;
  notifications?: NotificationOutbox;
  activity?: ActivityLog;
  support?: SupportDesk;
  checks?: CheckBook;
  /** Receives one JSON log line per completed request when MINIAPP_LOG=json. */
  logSink?: (line: string) => void;
  /** Monotonic milliseconds for request durations. */
  timer?: () => number;
}

const kycTemplates: Readonly<Partial<Record<KycVerificationState, NotificationTemplate>>> = Object.freeze({
  submitted: "kyc_submitted",
  in_review: "kyc_in_review",
  approved: "kyc_approved",
  rejected: "kyc_rejected",
  needs_more_data: "kyc_needs_more_data",
  timed_out: "kyc_timed_out",
  unavailable: "kyc_unavailable"
});

const maxReadIds = defaultMaxPerSubject;
const activityQueryPattern = /^\?limit=([1-9][0-9]?)$/;

function parseActivityLimit(search: string): number | undefined {
  if (search === "") return maxActivityPerSubject;
  const limit = Number(activityQueryPattern.exec(search)?.[1]);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= maxActivityPerSubject ? limit : undefined;
}

function parseNotificationIds(value: string): readonly string[] | undefined {
  const ids = value.split(",");
  if (ids.length > maxReadIds || new Set(ids).size !== ids.length) return undefined;
  return ids.every((id) => notificationIdPattern.test(id)) ? ids : undefined;
}

function securityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(apiSecurityHeaders)) response.setHeader(name, value);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function parseCookies(request: IncomingMessage): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value.join("="));
    } catch {
      cookies[name] = "";
    }
  }
  return cookies;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1"
    || address === "::1"
    || address?.startsWith("::ffff:127.") === true;
}

function exactOrigin(request: IncomingMessage, config: ServerConfig): string | undefined {
  const origin = request.headers.origin;
  return origin && config.allowedOrigins.includes(origin) ? origin : undefined;
}

function exactLoopbackOrigin(request: IncomingMessage, config: ServerConfig): boolean {
  const origin = exactOrigin(request, config);
  if (!origin) return false;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// SameSite=Strict still attaches the cookie to same-site subresource requests
// from other loopback ports, and every route can append audit rows (the lazy
// KYC sync inside currentSession drains signed provider callbacks; quote
// previews record activity). The fetch-site contract is therefore uniform.
function customerFetchAllowed(request: IncomingMessage): boolean {
  const fetchSite = request.headers["sec-fetch-site"];
  return fetchSite === undefined || fetchSite === "same-origin" || fetchSite === "none";
}

function sessionCookieValue(id: string, maxAge: number, origin: string): string {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${sessionCookie}=${encodeURIComponent(id)}; Path=/bff; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function customerRef(subject: string): string {
  return `SC-DEV-${subject.slice(-5).toUpperCase()}`;
}

function sessionView(session: CustomerSession): SessionView {
  return {
    authenticated: true,
    source: session.source,
    kyc: session.kyc,
    displayName,
    customerRef: customerRef(session.subject),
    expiresAt: session.expiresAt
  };
}

function pseudonymousSubject(source: CustomerSession["source"], telegramUserId: number): string {
  if (source === "dev-synthetic") {
    return `dev-${createHash("sha256").update(`solidchange-miniapp-dev-synthetic|${telegramUserId}`).digest("hex").slice(0, 16)}`;
  }
  return `tg-${createHash("sha256").update(`solidchange-miniapp-dev|${telegramUserId}`).digest("hex").slice(0, 16)}`;
}

export function createMiniappServer(
  config: ServerConfig,
  options: MiniappServerOptions = {}
): Server {
  const clock = options.clock ?? Date.now;
  const devBotToken = options.devBotToken ?? `0:${randomBytes(32).toString("base64url")}`;
  const sessions = new ExpiringStore<CustomerSession>(clock);
  const handleOf = createSessionHandles();
  const revokedHandles = new ExpiringStore<{ subject: string; expiresAt: number }>(clock);
  const quoteProvider = options.quoteProvider ?? (config.quoteSource === "provider-simulator"
    ? createSimulatorQuoteProvider({
      seed: config.quoteSeed,
      ttlSeconds: config.quoteTtlSeconds,
      scenario: config.quoteScenario,
      clock
    })
    : createLocalQuoteProvider());
  const customerApi = options.customerApi ?? createCustomerApiClient({
    baseUrl: config.customerApiUrl,
    devTokenKey: config.customerApiDevTokenKey
  });

  const kycOnboarding = options.kyc ?? createKycService({
    seed: config.kycSeed,
    scenario: config.kycScenario,
    reviewTimeoutSeconds: config.kycReviewTimeoutSeconds,
    clock
  });

  const addressScreening = options.addressScreening ?? createAddressScreeningService({
    seed: config.kytSeed,
    scenario: config.kytScenario,
    screeningTimeoutSeconds: config.kytScreeningTimeoutSeconds,
    clock
  });

  const outbox = options.notifications ?? createNotificationOutbox({ clock });
  const activity = options.activity ?? createActivityLog({ clock });
  const support = options.support ?? createSupportDesk({ clock });
  const checks = options.checks ?? createCheckBook({ clock });
  const unsubscribeKyc = kycOnboarding.subscribe((subject, state) => {
    const template = kycTemplates[state];
    if (template) outbox.record(subject, template);
    activity.recordKyc(subject, state);
  });

  const observer = createRequestObserver({
    service: "miniapp-bff",
    routes: routeTable.map((route) => route.path),
    config: config.observability,
    sink: options.logSink,
    timer: options.timer,
    wallClock: clock
  });
  const gauges: readonly Gauge[] = Object.freeze([
    { name: "solidchange_miniapp_sessions_active", help: "Unexpired Mini App BFF sessions.", value: () => sessions.size() },
    { name: "solidchange_miniapp_notification_drafts", help: "Draft notifications held in the test-mode outbox.", value: () => outbox.size() },
    { name: "solidchange_miniapp_address_screenings", help: "Address screenings tracked in memory.", value: () => addressScreening.trackedCount() },
    { name: "solidchange_miniapp_support_requests", help: "Test-mode support request drafts held in memory.", value: () => support.size() }
  ]);

  async function metrics(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Only the exact request target: dot-segment or backslash spellings that
    // normalize to this path arrive via the Vite proxy on the app origin.
    if (!observer.metricsEnabled || request.url !== "/bff/metrics" || !metricsRequestAllowed(request)) {
      json(response, 404, { error: "not_found" });
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      json(response, 405, { error: "method_not_allowed" });
      return;
    }
    const body = await observer.renderMetrics(gauges);
    securityHeaders(response);
    response.statusCode = 200;
    response.setHeader("content-type", metricsContentType);
    response.end(body);
  }

  function notificationsView(subject: string): NotificationsView {
    return {
      mode: "test",
      delivery: "disabled",
      unread: outbox.unread(subject),
      notifications: outbox.list(subject, defaultMaxPerSubject)
    };
  }

  function currentSession(request: IncomingMessage): CustomerSession | undefined {
    const id = parseCookies(request)[sessionCookie];
    const session = id ? sessions.get(id) : undefined;
    if (!session) return undefined;
    if (session.kyc === "kyc-gated" && kycOnboarding.isVerified(session.subject)) session.kyc = "verified";
    const now = clock();
    if (now - session.lastSeenAt >= lastSeenGranularityMs) session.lastSeenAt = now;
    return session;
  }

  function sessionsView(current: CustomerSession): DeviceSessionsView {
    const own = sessions.entries((entry) => entry.subject === current.subject).map(([, entry]) => ({
      handle: handleOf(entry.id),
      client: entry.source === "telegram" ? "telegram" as const : "dev-login" as const,
      createdAt: entry.createdAt,
      lastSeenAt: entry.lastSeenAt,
      current: entry.id === current.id
    }));
    own.sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt || b.createdAt - a.createdAt);
    return { mode: "test", sessions: own };
  }

  function revoke(session: CustomerSession): void {
    sessions.delete(session.id);
    revokedHandles.set(handleOf(session.id), { subject: session.subject, expiresAt: session.expiresAt });
    revokedHandles.retainNewest((entry) => entry.subject === session.subject, maxRevokedHandlesPerSubject);
  }

  function startSession(
    request: IncomingMessage,
    response: ServerResponse,
    origin: string,
    session: Omit<CustomerSession, "id" | "createdAt" | "lastSeenAt" | "expiresAt">
  ): void {
    const previous = parseCookies(request)[sessionCookie];
    if (previous) sessions.delete(previous);
    const now = clock();
    const created: CustomerSession = {
      ...session,
      id: randomUUID(),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + config.sessionTtlSeconds * 1_000
    };
    sessions.set(created.id, created);
    sessions.retainNewest((entry) => entry.subject === created.subject, maxSessionsPerSubject);
    outbox.record(created.subject, "session_login");
    activity.recordLogin(created.subject, created.source);
    response.setHeader("set-cookie", sessionCookieValue(created.id, config.sessionTtlSeconds, origin));
    json(response, 201, sessionView(created));
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLoopbackHostname(requestHostname(request.headers.host) ?? "")) {
      json(response, 421, { error: "host_rejected" });
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    const path = url.pathname;

    if (path === "/bff/metrics") {
      await metrics(request, response);
      return;
    }

    // X-Device-Id is an operator-only header: customer and metadata requests
    // must not carry it. The guard is uniform here because a per-route subset
    // had already drifted (several customer routes lacked it).
    if (request.headers["x-device-id"] !== undefined) {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    if (!customerFetchAllowed(request)) {
      json(response, 403, { error: "fetch_site_rejected" });
      return;
    }

    if (request.method === "POST") {
      const origin = exactOrigin(request, config);

      if (path === "/bff/auth/dev-session") {
        if (
          !config.allowDevLogin
          || !isLoopbackHostname(config.host)
          || !isLoopbackAddress(request.socket.remoteAddress)
          || !origin
          || !exactLoopbackOrigin(request, config)
        ) {
          json(response, 404, { error: "not_found" });
          return;
        }
        const body = await readJsonBody(request, [], ["kyc"]);
        const kyc = body.kyc ?? "verified";
        if (kyc !== "verified" && kyc !== "kyc-gated") {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        const fabricated = signInitData(new Map([
          ["auth_date", String(Math.floor(clock() / 1_000))],
          ["query_id", `dev-${randomBytes(8).toString("hex")}`],
          ["user", JSON.stringify({ id: devTelegramUserId, first_name: "Тестовый", language_code: "ru" })]
        ]), devBotToken);
        const verified = verifyInitData(fabricated, devBotToken, {
          nowMs: clock(),
          maxAgeSeconds: config.initDataMaxAgeSeconds
        });
        if (!verified.ok) {
          json(response, 500, { error: "dev_session_unavailable" });
          return;
        }
        const subject = pseudonymousSubject("dev-synthetic", verified.value.user.id);
        kycOnboarding.reset(subject);
        startSession(request, response, origin, {
          subject,
          source: "dev-synthetic",
          kyc: kyc as KycStatus
        });
        return;
      }

      if (path === "/bff/session/telegram") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const body = await readJsonBody(request, ["initData"]);
        if (!config.telegramBotToken) {
          json(response, 503, { error: "telegram_verification_not_configured" });
          return;
        }
        const verified = verifyInitData(body.initData, config.telegramBotToken, {
          nowMs: clock(),
          maxAgeSeconds: config.initDataMaxAgeSeconds
        });
        if (!verified.ok) {
          json(response, 401, { error: "init_data_rejected", reason: verified.reason });
          return;
        }
        startSession(request, response, origin, {
          subject: pseudonymousSubject("telegram", verified.value.user.id),
          source: "telegram",
          kyc: "kyc-gated"
        });
        return;
      }

      if (path === "/bff/auth/logout") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const id = parseCookies(request)[sessionCookie];
        if (id) sessions.delete(id);
        response.setHeader("set-cookie", sessionCookieValue("", 0, origin));
        json(response, 200, { ok: true });
        return;
      }

      if (path === "/bff/sessions/revoke" || path === "/bff/sessions/revoke-others") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const single = path === "/bff/sessions/revoke";
        const { handle } = await readJsonBody(request, single ? ["handle"] : []);
        const session = currentSession(request);
        if (!session) {
          json(response, 401, { error: "unauthenticated" });
          return;
        }
        if (single) {
          if (typeof handle !== "string" || !sessionHandlePattern.test(handle)) {
            json(response, 400, { error: "invalid_request" });
            return;
          }
          if (handle === handleOf(session.id)) {
            json(response, 409, { error: "current_session" });
            return;
          }
          const target = sessions.entries((entry) => entry.subject === session.subject && entry.id !== session.id)
            .find(([id]) => handleOf(id) === handle)?.[1];
          if (target) {
            revoke(target);
            activity.recordSessionsRevoked(session.subject, "single", 1);
          } else if (revokedHandles.get(handle)?.subject !== session.subject) {
            json(response, 404, { error: "not_found" });
            return;
          }
        } else {
          const others = sessions.entries((entry) => entry.subject === session.subject && entry.id !== session.id);
          for (const [, other] of others) revoke(other);
          activity.recordSessionsRevoked(session.subject, "others", others.length);
        }
        json(response, 200, sessionsView(session));
        return;
      }

      if (path === "/bff/kyc/applications") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        await readJsonBody(request, []);
        const session = currentSession(request);
        if (!session) {
          json(response, 401, { error: "unauthenticated" });
          return;
        }
        if (session.kyc === "verified") {
          json(response, 409, { error: "kyc_already_verified" });
          return;
        }
        try {
          const { created } = await kycOnboarding.submit(session.subject);
          json(response, created ? 202 : 200, kycOnboarding.view(session.subject, session.kyc));
        } catch (error) {
          if (error instanceof KycUnavailableError) {
            json(response, 503, { error: "kyc_unavailable" });
            return;
          }
          throw error;
        }
        return;
      }

      if (path === "/bff/address-screening") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const body = await readJsonBody(request, ["asset", "network", "address"]);
        const session = currentSession(request);
        if (!session) {
          json(response, 401, { error: "unauthenticated" });
          return;
        }
        if (session.kyc !== "verified") {
          json(response, 403, { error: "kyc_required" });
          return;
        }
        try {
          const { created, view } = await addressScreening.submit(session.subject, body);
          const subject = session.subject;
          if (created) activity.recordScreening(subject, view, () => addressScreening.view(subject, view.id)?.status);
          json(response, created ? 202 : 200, view);
        } catch (error) {
          if (error instanceof ScreeningInputError) {
            json(response, 400, { error: error.code });
            return;
          }
          if (error instanceof ScreeningRateLimitError) {
            json(response, 429, { error: "screening_rate_limited" });
            return;
          }
          if (error instanceof ScreeningUnavailableError) {
            activity.recordScreening(session.subject, error.view);
            json(response, 503, { error: "screening_unavailable", screening: error.view });
            return;
          }
          throw error;
        }
        return;
      }

      if (path === "/bff/support/requests") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const body = await readJsonBody(request, ["category", "topic", "message"], ["activityId"]);
        const session = currentSession(request);
        if (!session) {
          json(response, 401, { error: "unauthenticated" });
          return;
        }
        const subject = session.subject;
        try {
          const created = support.create(subject, body, (id) => activity.kindOf(subject, id));
          activity.recordSupport(subject, created.category, created.id);
          outbox.record(subject, created.category === "complaint" ? "complaint_received" : "support_received");
          observer.event("support_request_created", { category: created.category, support_id: created.id });
          json(response, 201, created);
        } catch (error) {
          if (error instanceof SupportInputError) {
            json(response, 400, { error: error.code });
            return;
          }
          if (error instanceof SupportRateLimitError) {
            json(response, 429, { error: "support_rate_limited" });
            return;
          }
          if (error instanceof SupportLimitError) {
            json(response, error.code === "support_capacity" ? 503 : 409, { error: error.code });
            return;
          }
          throw error;
        }
        return;
      }

      if (path === "/bff/notifications/read") {
        if (!origin) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const body = await readJsonBody(request, ["ids"]);
        const session = currentSession(request);
        if (!session) {
          json(response, 401, { error: "unauthenticated" });
          return;
        }
        const ids = parseNotificationIds(body.ids);
        if (!ids) {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        const marked = outbox.markRead(session.subject, ids);
        json(response, 200, { marked, unread: outbox.unread(session.subject) });
        return;
      }

      json(response, 404, { error: "not_found" });
      return;
    }

    if (request.method !== "GET") {
      json(response, 404, { error: "not_found" });
      return;
    }

    if (path === "/bff/health") {
      const health: HealthView = {
        mode: "dev-synthetic",
        devLogin: config.allowDevLogin,
        telegramVerification: config.telegramBotToken ? "configured" : "not-configured",
        moneyMovement: "disabled"
      };
      json(response, 200, health);
      return;
    }

    const knownGet = routeTable.some((route) => route.method === "GET" && (
      route.path === path
      || (route.path.endsWith("/:id") && path.startsWith(route.path.slice(0, -3)))
    ));
    if (!knownGet) {
      json(response, 404, { error: "not_found" });
      return;
    }

    const session = currentSession(request);
    if (!session) {
      json(response, 401, { error: "unauthenticated" });
      return;
    }

    if (path === "/bff/session") {
      json(response, 200, sessionView(session));
      return;
    }
    if (path === "/bff/wallet") {
      // The local KYC gate and the standalone (unconfigured) dev BFF keep the
      // synthetic wallet surface; only a verified session with customer-api
      // access reads balances through the contract. An upstream refusal maps to
      // the KYC-gated view (degraded in place, like /bff/profile's apiAccess),
      // any other upstream failure to the sibling *_unavailable error shape.
      if (session.kyc !== "verified" || !customerApi.configured) {
        json(response, 200, syntheticData.wallet(session.kyc));
        return;
      }
      const upstream = await customerApi.wallets(session.subject, clock());
      if (upstream.status === "ok") {
        json(response, 200, walletView(session.kyc, upstream.wallets.map((wallet) => ({
          code: wallet.asset,
          available: wallet.available,
          hold: wallet.hold
        }))));
        return;
      }
      if (upstream.status === "denied") {
        json(response, 200, syntheticData.wallet("kyc-gated"));
        return;
      }
      json(response, 503, { error: "wallet_unavailable" });
      return;
    }
    if (path === "/bff/operations") {
      json(response, 200, { operations: syntheticData.operations(session.kyc) });
      return;
    }
    if (path.startsWith("/bff/operations/")) {
      const operation = syntheticData.operation(session.kyc, path.slice("/bff/operations/".length));
      if (!operation) {
        json(response, 404, { error: "not_found" });
        return;
      }
      json(response, 200, operation);
      return;
    }
    if (path === "/bff/profile") {
      // Like /bff/kyc/status — and unlike /bff/wallet and /bff/notifications
      // — the profile surface is not KYC-gated upstream: customer.profile.read
      // is granted at every session status, so a configured customer-api
      // answers gated sessions too and only the standalone unconfigured dev
      // BFF keeps the local synthetic view. Since the read is never denied, an
      // upstream 403 signals contract drift and maps, like every other non-ok
      // outcome, to the sibling *_unavailable shape.
      const local = () => syntheticData.profile(session.kyc, displayName, customerRef(session.subject));
      if (!customerApi.configured) {
        const apiAccess = await customerApi.access(session.subject, clock());
        json(response, 200, { ...local(), apiAccess });
        return;
      }
      const upstream = await customerApi.profile(session.subject, clock());
      if (upstream.status !== "ok") {
        json(response, 503, { error: "profile_unavailable" });
        return;
      }
      // The apiAccess block is still consulted separately and degrades in
      // place exactly as before; the upstream view only overlays the identity
      // fields the app shape has (displayName/customerRef).
      const apiAccess = await customerApi.access(session.subject, clock());
      json(response, 200, contractProfileView(upstream.view, local(), apiAccess));
      return;
    }
    if (path === "/bff/kyc/status") {
      // Unlike /bff/wallet and /bff/notifications, the KYC status surface is
      // not KYC-gated upstream: customer.kyc.read is granted at every session
      // status (a verified gate would deadlock onboarding), so a configured
      // customer-api answers gated sessions too and only the standalone
      // unconfigured dev BFF keeps the local synthetic view. Since the read is
      // never denied, an upstream 403 signals contract drift and maps, like
      // every other non-ok outcome, to the sibling *_unavailable shape.
      if (!customerApi.configured) {
        json(response, 200, kycOnboarding.view(session.subject, session.kyc));
        return;
      }
      const upstream = await customerApi.kyc(session.subject, clock());
      if (upstream.status !== "ok") {
        json(response, 503, { error: "kyc_unavailable" });
        return;
      }
      json(response, 200, contractKycVerificationView(upstream.view));
      return;
    }
    if (path === "/bff/notifications") {
      if (url.search !== "") {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      // The local KYC gate and the standalone (unconfigured) dev BFF keep the
      // synthetic outbox feed; only a verified session with customer-api access
      // reads the contract feed. An upstream refusal degrades the surface to the
      // same feed a gated session sees (in place, like /bff/wallet's gated
      // view); any other upstream failure answers the sibling *_unavailable
      // error shape.
      if (session.kyc !== "verified" || !customerApi.configured) {
        json(response, 200, notificationsView(session.subject));
        return;
      }
      const upstream = await customerApi.notifications(session.subject, clock());
      if (upstream.status === "ok") {
        json(response, 200, contractNotificationsView(upstream));
        return;
      }
      if (upstream.status === "denied") {
        json(response, 200, notificationsView(session.subject));
        return;
      }
      json(response, 503, { error: "notifications_unavailable" });
      return;
    }
    if (path === "/bff/activity") {
      const limit = parseActivityLimit(url.search);
      if (limit === undefined) {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      const view: ActivityView = { mode: "test", items: activity.list(session.subject, limit), executable: false };
      json(response, 200, view);
      return;
    }
    if (path === "/bff/sessions") {
      if (url.search !== "") {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      json(response, 200, sessionsView(session));
      return;
    }
    if (path === "/bff/support/requests" || path.startsWith("/bff/support/requests/")) {
      if (url.search !== "") {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      if (path === "/bff/support/requests") {
        // Like /bff/profile and /bff/kyc/status — and unlike /bff/wallet and
        // /bff/notifications — the support request list is not KYC-gated
        // upstream: customer.support.read is granted at every session status,
        // so a configured customer-api answers gated sessions too and only the
        // standalone unconfigured dev BFF keeps the local desk view. Since the
        // read is never denied, an upstream 403 signals contract drift and
        // maps, like every other non-ok outcome, to the sibling *_unavailable
        // shape.
        if (customerApi.configured) {
          const upstream = await customerApi.support(session.subject, clock());
          if (upstream.status !== "ok") {
            json(response, 503, { error: "support_unavailable" });
            return;
          }
          json(response, 200, contractSupportRequestsView(upstream.view));
          return;
        }
        const view: SupportRequestsView = { mode: "test", delivery: "disabled", requests: support.list(session.subject) };
        json(response, 200, view);
        return;
      }
      const found = support.view(session.subject, path.slice("/bff/support/requests/".length));
      if (!found) {
        json(response, 404, { error: "not_found" });
        return;
      }
      json(response, 200, found);
      return;
    }
    if (path.startsWith("/bff/address-screening/")) {
      if (url.search !== "") {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      if (session.kyc !== "verified") {
        json(response, 403, { error: "kyc_required" });
        return;
      }
      const screening = addressScreening.view(session.subject, path.slice("/bff/address-screening/".length));
      if (!screening) {
        json(response, 404, { error: "not_found" });
        return;
      }
      json(response, 200, screening);
      return;
    }
    if (path === "/bff/quotes/preview") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const amount = url.searchParams.get("amount") ?? "";
      try {
        const quote = await quoteProvider.preview({ from, to, amount }, {
          subject: session.subject,
          nowMs: clock(),
          ttlSeconds: config.quoteTtlSeconds,
          available: isAssetCode(from) ? syntheticData.available(session.kyc, from) : undefined,
          kycRequired: session.kyc !== "verified"
        });
        activity.recordQuote(session.subject, quote);
        json(response, 200, quote);
      } catch (error) {
        if (error instanceof QuoteError) {
          json(response, error.code === "quote_unavailable" ? 503 : 400, error.reason
            ? { error: error.code, reason: error.reason }
            : { error: error.code });
          return;
        }
        throw error;
      }
      return;
    }

    if (path === "/bff/checks" || path === "/bff/checks/preview" || path.startsWith("/bff/checks/")) {
      if (path === "/bff/checks") {
        if (url.search !== "") {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        json(response, 200, checks.list(session.kyc));
        return;
      }
      if (path === "/bff/checks/preview") {
        const asset = url.searchParams.get("asset") ?? "";
        const amount = url.searchParams.get("amount") ?? "";
        try {
          const preview = checks.preview({ asset, amount }, {
            nowMs: clock(),
            available: isAssetCode(asset) ? syntheticData.available(session.kyc, asset) : undefined,
            kycRequired: session.kyc !== "verified"
          });
          json(response, 200, preview);
        } catch (error) {
          if (error instanceof CheckError) {
            json(response, 400, { error: error.code });
            return;
          }
          throw error;
        }
        return;
      }
      if (url.search !== "") {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      const found = checks.view(path.slice("/bff/checks/".length), session.kyc);
      if (!found) {
        json(response, 404, { error: "not_found" });
        return;
      }
      json(response, 200, found);
      return;
    }

    json(response, 404, { error: "not_found" });
  }

  const server = createServer((request, response) => {
    observer.observe(request, response);
    handle(request, response).catch((error: unknown) => {
      if (error instanceof RequestBodyError) {
        json(response, error.status, { error: error.status === 415 ? "unsupported_media_type" : "invalid_request" });
        return;
      }
      json(response, 500, { error: "internal_error" });
    });
  });
  guardRawResponses(server, apiSecurityHeaders);
  server.once("close", unsubscribeKyc);
  return server;
}
