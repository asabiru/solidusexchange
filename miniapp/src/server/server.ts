import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { HealthView, KycStatus, SessionView } from "../shared/api.js";
import { isAssetCode } from "../shared/assets.js";
import { type ServerConfig, isLoopbackHostname } from "./config.js";
import { signInitData, verifyInitData } from "./init-data.js";
import { type CustomerApiClient, createCustomerApiClient } from "./customer-api-client.js";
import { type QuoteProvider, createLocalQuoteProvider, createSimulatorQuoteProvider } from "./provider-quotes.js";
import { type KycService, KycUnavailableError, createKycService } from "./kyc.js";
import { QuoteError } from "./quotes.js";
import { RequestBodyError, readJsonBody } from "./request-body.js";
import { type CustomerSession, ExpiringStore } from "./session.js";
import { syntheticData } from "./synthetic.js";

export const sessionCookie = "solidchange_ma_session";
const displayName = "Тестовый клиент";
const devTelegramUserId = 900_000_001;

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
  { method: "POST", path: "/bff/kyc/applications" },
  { method: "GET", path: "/bff/kyc/status" }
] satisfies Route[]);

export interface MiniappServerOptions {
  clock?: () => number;
  devBotToken?: string;
  quoteProvider?: QuoteProvider;
  customerApi?: CustomerApiClient;
  kyc?: KycService;
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
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

function hostnameOf(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
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

function pseudonymousSubject(telegramUserId: number): string {
  return `tg-${createHash("sha256").update(`solidchange-miniapp-dev|${telegramUserId}`).digest("hex").slice(0, 16)}`;
}

export function createMiniappServer(
  config: ServerConfig,
  options: MiniappServerOptions = {}
): Server {
  const clock = options.clock ?? Date.now;
  const devBotToken = options.devBotToken ?? `0:${randomBytes(32).toString("base64url")}`;
  const sessions = new ExpiringStore<CustomerSession>(clock);
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

  function currentSession(request: IncomingMessage): CustomerSession | undefined {
    const id = parseCookies(request)[sessionCookie];
    const session = id ? sessions.get(id) : undefined;
    if (session?.kyc === "kyc-gated" && kycOnboarding.isVerified(session.subject)) session.kyc = "verified";
    return session;
  }

  function startSession(
    request: IncomingMessage,
    response: ServerResponse,
    origin: string,
    session: Omit<CustomerSession, "id" | "expiresAt">
  ): void {
    const previous = parseCookies(request)[sessionCookie];
    if (previous) sessions.delete(previous);
    const created: CustomerSession = {
      ...session,
      id: randomUUID(),
      expiresAt: clock() + config.sessionTtlSeconds * 1_000
    };
    sessions.set(created.id, created);
    response.setHeader("set-cookie", sessionCookieValue(created.id, config.sessionTtlSeconds, origin));
    json(response, 201, sessionView(created));
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLoopbackHostname(hostnameOf(request.headers.host ?? ""))) {
      json(response, 421, { error: "host_rejected" });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

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
        const subject = pseudonymousSubject(verified.value.user.id);
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
          subject: pseudonymousSubject(verified.value.user.id),
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
      json(response, 200, syntheticData.wallet(session.kyc));
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
      const apiAccess = await customerApi.access(session.subject, clock());
      json(response, 200, { ...syntheticData.profile(session.kyc, displayName, customerRef(session.subject)), apiAccess });
      return;
    }
    if (path === "/bff/kyc/status") {
      json(response, 200, kycOnboarding.view(session.subject, session.kyc));
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

    json(response, 404, { error: "not_found" });
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (error instanceof RequestBodyError) {
        json(response, error.status, { error: error.status === 415 ? "unsupported_media_type" : "invalid_request" });
        return;
      }
      json(response, 500, { error: "internal_error" });
    });
  });
}
