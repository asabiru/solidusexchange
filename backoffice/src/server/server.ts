import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { can, findRole, type Capability, type OperatorRole } from "../auth/access.js";
import { demoRepository } from "../data/demo.js";
import type { ServerConfig } from "./config.js";
import {
  authorizationUrl,
  createOpaqueValue,
  exchangeAuthorizationCode,
  verifyIdToken
} from "./oidc.js";
import { createDeviceId, deviceDigest, isDeviceId } from "./device.js";
import { ExpiringStore, type OperatorSession, type PendingLogin } from "./session.js";
import {
  EphemeralSigningKeyProvider,
  ResponseSigner
} from "./signing.js";
import {
  AuditUnavailableError,
  AuditStoreError,
  type AuditStore,
  MemoryAuditStore
} from "./audit-store.js";
import {
  approvalCommandDigest,
  buildApprovalPreview
} from "./controls.js";
import { checkAccessEvent, checkStatuses, isCheckStatus } from "./checks.js";
import { isSupportTicketStatus, supportAccessEvent, supportTicketStatuses } from "./support.js";
import { isWithdrawalStatus, withdrawalAccessEvent, withdrawalStatuses } from "./withdrawals.js";
import { isSubjectRef, subjectTimelineAccessEvent } from "./subjects.js";
import { createProviderEvidenceSource } from "./provider-evidence.js";
import {
  buildReport,
  buildReportExport,
  findReportDefinition,
  listReports,
  reportAccessEvent
} from "./reports.js";
import { type Gauge, createRequestObserver, metricsContentType, metricsRequestAllowed } from "./observability.js";
import { RequestBodyError, readJsonBody } from "./request-body.js";
import { apiSecurityHeaders, guardRawResponses } from "./security-headers.js";
import {
  StepUpRejectedError,
  SyntheticStepUpService
} from "./step-up.js";

const sessionCookie = "solidchange_bo_session";
const oidcTransactionCookie = "solidchange_bo_oidc_transaction";
const deviceCookie = "solidchange_bo_device";
const deviceCookieMaxAgeSeconds = 400 * 24 * 60 * 60;
const validRoles = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "fraud-investigator",
  "auditor"
]);

function securityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(apiSecurityHeaders)) response.setHeader(name, value);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  securityHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function redirect(response: ServerResponse, location: string): void {
  securityHeaders(response);
  response.statusCode = 302;
  response.setHeader("location", location);
  response.end();
}

function appendCookie(response: ServerResponse, value: string): void {
  const current = response.getHeader("set-cookie");
  const cookies = Array.isArray(current)
    ? current.map(String)
    : current === undefined
      ? []
      : [String(current)];
  response.setHeader("set-cookie", [...cookies, value]);
}

function parseCookies(request: IncomingMessage): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {};
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name) cookies[name] = decodeURIComponent(value.join("="));
  }
  return cookies;
}

function isLoopback(host: string): boolean {
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
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
    return isLoopback(new URL(origin).host);
  } catch {
    return false;
  }
}

/** Frozen route templates; observability labels never carry raw paths. */
export const routeTemplates: readonly string[] = Object.freeze([
  "/bff/healthz",
  "/bff/metrics",
  "/bff/auth/login",
  "/bff/auth/device",
  "/bff/auth/status",
  "/bff/auth/callback",
  "/bff/auth/dev-session",
  "/bff/auth/logout",
  "/bff/api/signing-key",
  "/bff/api/signing-keys",
  "/bff/api/session",
  "/bff/api/dashboard",
  "/bff/api/customers",
  "/bff/api/checks",
  "/bff/api/checks/:checkId",
  "/bff/api/support",
  "/bff/api/support/:ticketId",
  "/bff/api/withdrawals",
  "/bff/api/withdrawals/:withdrawalId",
  "/bff/api/subjects/:ref/timeline",
  "/bff/api/kyc",
  "/bff/api/aml",
  "/bff/api/investigations",
  "/bff/api/fraud-alerts",
  "/bff/api/approvals",
  "/bff/api/audit",
  "/bff/api/audit/export",
  "/bff/api/reports",
  "/bff/api/reports/:reportId",
  "/bff/api/reports/:reportId/export",
  "/bff/api/approvals/:approvalId/step-up/challenges",
  "/bff/api/approvals/:approvalId/step-up/challenges/:challengeId/verify",
  "/bff/api/approvals/:approvalId/preview"
]);

export interface ObservabilityOptions {
  /** Receives one JSON log line per completed request when BACKOFFICE_LOG=json. */
  logSink?: (line: string) => void;
  /** Monotonic milliseconds for request durations. */
  timer?: () => number;
}

function defaultAuditStore(config: ServerConfig): AuditStore {
  if (config.audit.storage !== "memory") {
    throw new AuditUnavailableError("PostgreSQL audit storage must be initialized before BFF");
  }
  return new MemoryAuditStore(demoRepository.auditSource(), config.audit.retentionDays);
}

export function createBackofficeServer(
  config: ServerConfig,
  auditStore: AuditStore = defaultAuditStore(config),
  injectedSigningKeys?: EphemeralSigningKeyProvider,
  observability: ObservabilityOptions = {}
) {
  const pendingLogins = new ExpiringStore<PendingLogin>();
  const sessions = new ExpiringStore<OperatorSession>();
  const signingKeys = injectedSigningKeys
    ?? new EphemeralSigningKeyProvider(config.signing.retainedVerificationKeys);
  const signer = new ResponseSigner(signingKeys);
  const stepUp = new SyntheticStepUpService(config.stepUp);
  const providerEvidence = createProviderEvidenceSource();
  const deviceBinding = config.deviceBinding ?? { mode: "off", approvedDeviceDigests: [] };
  const enforceDevices = deviceBinding.mode === "enforce";
  const approvedDevices = new Set(deviceBinding.approvedDeviceDigests);

  function setSessionCookie(response: ServerResponse, session: OperatorSession): void {
    const secure = config.allowedOrigins.every((origin) => origin.startsWith("https://"));
    const flags = [
      `${sessionCookie}=${encodeURIComponent(session.id)}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/bff",
      `Max-Age=${config.sessionTtlSeconds}`
    ];
    if (secure) flags.push("Secure");
    appendCookie(response, flags.join("; "));
  }

  function clearSessionCookie(response: ServerResponse): void {
    appendCookie(
      response,
      `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/bff; Max-Age=0`
    );
  }

  function setOidcTransactionCookie(response: ServerResponse, state: string): void {
    const flags = [
      `${oidcTransactionCookie}=${encodeURIComponent(state)}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/bff/auth/callback",
      "Max-Age=300"
    ];
    if (config.oidc && new URL(config.oidc.redirectUri).protocol === "https:") {
      flags.push("Secure");
    }
    appendCookie(response, flags.join("; "));
  }

  function clearOidcTransactionCookie(response: ServerResponse): void {
    appendCookie(
      response,
      `${oidcTransactionCookie}=; HttpOnly; SameSite=Lax; Path=/bff/auth/callback; Max-Age=0`
    );
  }

  function requestDeviceId(request: IncomingMessage): string | undefined {
    const value = parseCookies(request)[deviceCookie];
    return isDeviceId(value) ? value : undefined;
  }

  function ensureDeviceId(request: IncomingMessage, response: ServerResponse): string {
    const existing = requestDeviceId(request);
    if (existing) return existing;
    const deviceId = createDeviceId();
    const flags = [
      `${deviceCookie}=${deviceId}`,
      "HttpOnly",
      "SameSite=Lax",
      "Path=/bff",
      `Max-Age=${deviceCookieMaxAgeSeconds}`
    ];
    if (config.allowedOrigins.every((origin) => origin.startsWith("https://"))) {
      flags.push("Secure");
    }
    appendCookie(response, flags.join("; "));
    return deviceId;
  }

  function deviceApproved(deviceId: string | undefined): boolean {
    return deviceId !== undefined && approvedDevices.has(deviceDigest(deviceId));
  }

  function admittedDevice(
    request: IncomingMessage,
    response: ServerResponse
  ): { deviceId?: string } | undefined {
    if (!enforceDevices) return {};
    const deviceId = ensureDeviceId(request, response);
    if (deviceApproved(deviceId)) return { deviceId };
    json(response, 403, {
      error: "device_not_approved",
      deviceDigest: deviceDigest(deviceId)
    });
    return undefined;
  }

  function currentSession(request: IncomingMessage): OperatorSession | undefined {
    const id = parseCookies(request)[sessionCookie];
    const session = id ? sessions.get(id) : undefined;
    if (!session || !enforceDevices) return session;
    const deviceId = requestDeviceId(request);
    return session.deviceId === deviceId && deviceApproved(deviceId) ? session : undefined;
  }

  function createSession(
    request: IncomingMessage,
    response: ServerResponse,
    identity: Omit<OperatorSession, "id" | "expiresAt">,
    loginStartSessionId?: string
  ): OperatorSession {
    const previousId = parseCookies(request)[sessionCookie];
    if (previousId) sessions.delete(previousId);
    if (loginStartSessionId) sessions.delete(loginStartSessionId);
    const { deviceId } = identity;
    if (deviceId) sessions.deleteWhere((session) => session.deviceId === deviceId);
    const session = {
      ...identity,
      id: createOpaqueValue(),
      expiresAt: Date.now() + config.sessionTtlSeconds * 1_000
    };
    sessions.set(session.id, session);
    setSessionCookie(response, session);
    return session;
  }

  function signed<T>(response: ServerResponse, resource: string, payload: T): void {
    json(response, 200, signer.envelope(resource, payload, randomUUID()));
  }

  function authorized(
    request: IncomingMessage,
    response: ServerResponse,
    capability?: Capability
  ): OperatorSession | undefined {
    const session = currentSession(request);
    if (!session) {
      json(response, 401, { error: "operator_session_required" });
      return undefined;
    }
    if (capability && !can(session.role, capability)) {
      json(response, 403, { error: "capability_denied" });
      return undefined;
    }
    return session;
  }

  const rotationTimer = setInterval(
    () => signingKeys.rotate(),
    config.signing.rotationSeconds * 1_000
  );
  rotationTimer.unref();

  const observer = createRequestObserver({
    service: "backoffice-bff",
    routes: routeTemplates,
    config: config.observability,
    sink: observability.logSink,
    timer: observability.timer
  });
  const gauges: readonly Gauge[] = Object.freeze([
    { name: "solidchange_backoffice_sessions_active", help: "Unexpired operator sessions.", value: () => sessions.size() },
    {
      name: "solidchange_backoffice_audit_events",
      help: "Events in the verified audit chain.",
      value: async () => {
        try {
          return (await auditStore.snapshot()).status.length;
        } catch {
          return undefined;
        }
      }
    }
  ]);

  const server = createServer(async (request, response) => {
    observer.observe(request, response);
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (path === "/bff/metrics") {
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
        return;
      }

      if (request.method === "GET" && path === "/bff/healthz") {
        const audit = await auditStore.snapshot();
        json(response, 200, {
          mode: "dev-dry-run",
          oidcConfigured: Boolean(config.oidc),
          devLoginEnabled: config.allowDevLogin,
          deviceBinding: deviceBinding.mode,
          dataSource: "synthetic",
          audit: {
            backend: audit.status.backend,
            durable: audit.status.durable,
            retentionDays: audit.status.retentionDays,
            verified: audit.status.verified
          },
          stepUp: {
            provider: config.stepUp.provider,
            challengeTtlSeconds: config.stepUp.challengeTtlSeconds,
            maxAttempts: config.stepUp.maxAttempts,
            productionReady: false
          },
          signing: {
            backend: signer.publicKeyset().backend,
            rotationSeconds: config.signing.rotationSeconds,
            retainedVerificationKeys: config.signing.retainedVerificationKeys,
            productionReady: false
          },
          commandsEnabled: false
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/auth/login") {
        if (!config.oidc) {
          json(response, 503, { error: "oidc_not_configured" });
          return;
        }
        const state = createOpaqueValue();
        const nonce = createOpaqueValue();
        const verifier = createOpaqueValue(48);
        pendingLogins.set(state, {
          nonce,
          verifier,
          previousSessionId: parseCookies(request)[sessionCookie] || undefined,
          expiresAt: Date.now() + 5 * 60 * 1_000
        });
        setOidcTransactionCookie(response, state);
        redirect(response, authorizationUrl(config.oidc, state, nonce, verifier));
        return;
      }

      if (request.method === "GET" && path === "/bff/auth/device") {
        if (!enforceDevices) {
          json(response, 200, { binding: "off" });
          return;
        }
        const deviceId = ensureDeviceId(request, response);
        json(response, 200, {
          binding: "enforce",
          deviceDigest: deviceDigest(deviceId),
          approved: deviceApproved(deviceId)
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/auth/status") {
        json(response, 200, { authenticated: Boolean(currentSession(request)) });
        return;
      }

      if (request.method === "GET" && path === "/bff/auth/callback") {
        if (!config.oidc) {
          json(response, 503, { error: "oidc_not_configured" });
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const transactionState = parseCookies(request)[oidcTransactionCookie];
        if (!code || !state || transactionState !== state) {
          clearOidcTransactionCookie(response);
          json(response, 400, { error: "oidc_callback_rejected" });
          return;
        }
        const pending = pendingLogins.take(state);
        if (!pending) {
          clearOidcTransactionCookie(response);
          json(response, 400, { error: "oidc_callback_rejected" });
          return;
        }
        clearOidcTransactionCookie(response);
        const device = admittedDevice(request, response);
        if (!device) return;
        const idToken = await exchangeAuthorizationCode(config.oidc, code, pending.verifier);
        const identity = await verifyIdToken(idToken, config.oidc, pending.nonce);
        createSession(
          request,
          response,
          { ...identity, ...device },
          pending.previousSessionId
        );
        redirect(response, config.allowedOrigins[0]);
        return;
      }

      if (request.method === "POST" && path === "/bff/auth/dev-session") {
        if (
          !config.allowDevLogin
          || !isLoopback(config.host)
          || !isLoopbackAddress(request.socket.remoteAddress)
          || !exactLoopbackOrigin(request, config)
        ) {
          json(response, 404, { error: "not_found" });
          return;
        }
        const { role } = await readJsonBody(request, ["role"]);
        if (!validRoles.has(role as OperatorRole)) {
          json(response, 400, { error: "unsupported_role" });
          return;
        }
        const profile = findRole(role);
        if (!profile) {
          json(response, 400, { error: "unsupported_role" });
          return;
        }
        const device = admittedDevice(request, response);
        if (!device) return;
        const session = createSession(request, response, {
          subject: `dev:${profile.id}`,
          email: `${profile.id}@dev.solidchange.invalid`,
          name: profile.operator,
          role: profile.id,
          ...device
        });
        signed(response, "auth/dev-session", {
          authenticated: true,
          expiresAt: session.expiresAt
        });
        return;
      }

      if (request.method === "POST" && path === "/bff/auth/logout") {
        if (!exactOrigin(request, config)) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const session = currentSession(request);
        if (session) sessions.delete(session.id);
        clearSessionCookie(response);
        json(response, 204, {});
        return;
      }

      if (request.method === "GET" && path === "/bff/api/signing-key") {
        const key = signer.currentPublicKey();
        json(response, 200, { keyId: key.keyId, publicJwk: key.publicJwk });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/signing-keys") {
        json(response, 200, signer.publicKeyset());
        return;
      }

      if (request.method === "GET" && path === "/bff/api/session") {
        const session = authorized(request, response);
        if (!session) return;
        const profile = findRole(session.role);
        if (!profile) {
          json(response, 403, { error: "role_not_found" });
          return;
        }
        signed(response, "session", {
          operator: {
            subject: session.subject,
            email: session.email,
            name: session.name,
            role: session.role,
            label: profile.label,
            initials: profile.initials,
            capabilities: profile.capabilities
          },
          expiresAt: new Date(session.expiresAt).toISOString()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/dashboard") {
        if (!authorized(request, response, "dashboard:read")) return;
        signed(response, "dashboard", {
          metrics: demoRepository.metrics(),
          queues: demoRepository.queues()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/customers") {
        if (!authorized(request, response, "customers:read")) return;
        signed(response, "customers", { customers: demoRepository.customers() });
        return;
      }

      const checkMatch = path.match(/^\/bff\/api\/checks\/([^/]+)$/);
      if (path === "/bff/api/checks" || checkMatch) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          json(response, 405, { error: "method_not_allowed" });
          return;
        }
        // Check views append audit events; SameSite=Strict still admits
        // same-site subresource requests (e.g. other loopback ports).
        const fetchSite = request.headers["sec-fetch-site"];
        if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
          json(response, 403, { error: "fetch_site_rejected" });
          return;
        }
        const session = authorized(request, response, "checks:read");
        if (!session) return;
        if (!checkMatch) {
          const statusFilters = url.searchParams.getAll("status");
          if (!statusFilters.every(isCheckStatus)) {
            json(response, 400, { error: "invalid_check_status" });
            return;
          }
          const wanted = new Set(statusFilters);
          const checks = demoRepository.chatChecks();
          signed(response, "checks", {
            statuses: checkStatuses,
            checks: wanted.size === 0 ? checks : checks.filter((check) => wanted.has(check.status))
          });
          return;
        }
        let checkId: string;
        try {
          checkId = decodeURIComponent(checkMatch[1]);
        } catch {
          json(response, 404, { error: "check_not_found" });
          return;
        }
        const check = demoRepository.chatChecks().find((item) => item.id === checkId);
        if (!check) {
          json(response, 404, { error: "check_not_found" });
          return;
        }
        const audit = await auditStore.snapshot();
        await auditStore.append(
          checkAccessEvent(`AUD-CHK-${randomUUID()}`, session.subject, check),
          audit.status.headHash
        );
        signed(response, `check:${check.id}`, check);
        return;
      }

      const ticketMatch = path.match(/^\/bff\/api\/support\/([^/]+)$/);
      if (path === "/bff/api/support" || ticketMatch) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          json(response, 405, { error: "method_not_allowed" });
          return;
        }
        // Ticket views append audit events; SameSite=Strict still admits
        // same-site subresource requests (e.g. other loopback ports).
        const fetchSite = request.headers["sec-fetch-site"];
        if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
          json(response, 403, { error: "fetch_site_rejected" });
          return;
        }
        const session = authorized(request, response, "support:read");
        if (!session) return;
        if (!ticketMatch) {
          const statusFilters = url.searchParams.getAll("status");
          if (!statusFilters.every(isSupportTicketStatus)) {
            json(response, 400, { error: "invalid_support_status" });
            return;
          }
          const wanted = new Set(statusFilters);
          const tickets = demoRepository.supportTickets();
          signed(response, "support", {
            statuses: supportTicketStatuses,
            tickets: wanted.size === 0 ? tickets : tickets.filter((ticket) => wanted.has(ticket.status))
          });
          return;
        }
        let ticketId: string;
        try {
          ticketId = decodeURIComponent(ticketMatch[1]);
        } catch {
          json(response, 404, { error: "ticket_not_found" });
          return;
        }
        const ticket = demoRepository.supportTickets().find((item) => item.id === ticketId);
        if (!ticket) {
          json(response, 404, { error: "ticket_not_found" });
          return;
        }
        const audit = await auditStore.snapshot();
        await auditStore.append(
          supportAccessEvent(`AUD-SUP-${randomUUID()}`, session.subject, ticket),
          audit.status.headHash
        );
        signed(response, `support:${ticket.id}`, ticket);
        return;
      }

      const withdrawalMatch = path.match(/^\/bff\/api\/withdrawals\/([^/]+)$/);
      if (path === "/bff/api/withdrawals" || withdrawalMatch) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          json(response, 405, { error: "method_not_allowed" });
          return;
        }
        // Withdrawal intent views append audit events; SameSite=Strict still admits
        // same-site subresource requests (e.g. other loopback ports).
        const fetchSite = request.headers["sec-fetch-site"];
        if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
          json(response, 403, { error: "fetch_site_rejected" });
          return;
        }
        const session = authorized(request, response, "custody:read");
        if (!session) return;
        if (!withdrawalMatch) {
          const statusFilters = url.searchParams.getAll("status");
          if (!statusFilters.every(isWithdrawalStatus)) {
            json(response, 400, { error: "invalid_withdrawal_status" });
            return;
          }
          const wanted = new Set(statusFilters);
          const intents = demoRepository.withdrawalIntents();
          signed(response, "withdrawals", {
            statuses: withdrawalStatuses,
            intents: wanted.size === 0 ? intents : intents.filter((intent) => wanted.has(intent.status))
          });
          return;
        }
        let withdrawalId: string;
        try {
          withdrawalId = decodeURIComponent(withdrawalMatch[1]);
        } catch {
          json(response, 404, { error: "withdrawal_not_found" });
          return;
        }
        const intent = demoRepository.withdrawalIntents().find((item) => item.id === withdrawalId);
        if (!intent) {
          json(response, 404, { error: "withdrawal_not_found" });
          return;
        }
        const audit = await auditStore.snapshot();
        await auditStore.append(
          withdrawalAccessEvent(`AUD-WDR-${randomUUID()}`, session.subject, intent),
          audit.status.headHash
        );
        signed(response, `withdrawal:${intent.id}`, intent);
        return;
      }

      const subjectMatch = path.match(/^\/bff\/api\/subjects\/([^/]+)\/timeline$/);
      if (subjectMatch) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          json(response, 405, { error: "method_not_allowed" });
          return;
        }
        // Timeline lookups append audit events; SameSite=Strict still admits
        // same-site subresource requests (e.g. other loopback ports).
        const fetchSite = request.headers["sec-fetch-site"];
        if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
          json(response, 403, { error: "fetch_site_rejected" });
          return;
        }
        const session = authorized(request, response, "subjects:read");
        if (!session) return;
        let ref: string;
        try {
          ref = decodeURIComponent(subjectMatch[1]);
        } catch {
          json(response, 404, { error: "subject_not_found" });
          return;
        }
        if (!isSubjectRef(ref)) {
          json(response, 400, { error: "invalid_subject_ref" });
          return;
        }
        const timeline = demoRepository.subjectTimeline(ref);
        if (!timeline) {
          json(response, 404, { error: "subject_not_found" });
          return;
        }
        const audit = await auditStore.snapshot();
        await auditStore.append(
          subjectTimelineAccessEvent(`AUD-SBJ-${randomUUID()}`, session.subject, timeline),
          audit.status.headHash
        );
        signed(response, `subject-timeline:${ref}`, timeline);
        return;
      }

      if (request.method === "GET" && path === "/bff/api/kyc") {
        if (!authorized(request, response, "kyc:read")) return;
        signed(response, "kyc-cases", {
          cases: demoRepository.kycCases(),
          providerEvidence: await providerEvidence.kyc()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/aml") {
        if (!authorized(request, response, "aml:read")) return;
        signed(response, "aml-cases", {
          cases: demoRepository.amlCases(),
          providerEvidence: await providerEvidence.kyt()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/investigations") {
        if (!authorized(request, response, "investigations:read")) return;
        signed(response, "investigations", {
          cases: demoRepository.investigationCases()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/fraud-alerts") {
        if (!authorized(request, response, "fraud:read")) return;
        signed(response, "fraud-alerts", {
          alerts: demoRepository.fraudAlerts()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/approvals") {
        if (!authorized(request, response, "approvals:read")) return;
        signed(response, "approvals", {
          approvals: demoRepository.approvals().map((approval) => ({
            ...approval,
            commandDigest: approvalCommandDigest(approval)
          }))
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/audit") {
        if (!authorized(request, response, "audit:read")) return;
        const audit = await auditStore.snapshot();
        signed(response, "audit", {
          events: audit.events,
          chain: audit.status
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/audit/export") {
        if (!authorized(request, response, "audit:export")) return;
        const audit = await auditStore.snapshot();
        signed(response, "audit-export", {
          formatVersion: 1,
          generatedAt: new Date().toISOString(),
          storage: {
            backend: audit.status.backend,
            durable: audit.status.durable,
            retentionDays: audit.status.retentionDays
          },
          chain: audit.status,
          events: audit.events
        });
        return;
      }

      const reportMatch = path.match(/^\/bff\/api\/reports\/([^/]+)$/);
      const reportExportMatch = path.match(/^\/bff\/api\/reports\/([^/]+)\/export$/);
      if (path === "/bff/api/reports" || reportMatch || reportExportMatch) {
        if (request.method !== "GET") {
          response.setHeader("allow", "GET");
          json(response, 405, { error: "method_not_allowed" });
          return;
        }
        // Report reads append audit events; SameSite=Strict still admits
        // same-site subresource requests (e.g. other loopback ports).
        const fetchSite = request.headers["sec-fetch-site"];
        if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
          json(response, 403, { error: "fetch_site_rejected" });
          return;
        }
        const session = authorized(request, response, "reports:read");
        if (!session) return;
        if (!reportMatch && !reportExportMatch) {
          signed(response, "reports", listReports(new Date().toISOString()));
          return;
        }
        let reportId: string;
        try {
          reportId = decodeURIComponent((reportMatch ?? reportExportMatch)?.[1] ?? "");
        } catch {
          json(response, 404, { error: "report_not_found" });
          return;
        }
        const definition = findReportDefinition(reportId);
        if (!definition) {
          json(response, 404, { error: "report_not_found" });
          return;
        }
        const audit = await auditStore.snapshot();
        const report = buildReport(definition.id, {
          repository: demoRepository,
          kycEvidence: await providerEvidence.kyc(),
          kytEvidence: await providerEvidence.kyt(),
          auditEvents: audit.events
        }, new Date().toISOString());
        await auditStore.append(
          reportAccessEvent(
            `AUD-RPT-${randomUUID()}`,
            session.subject,
            report,
            reportExportMatch ? "report.exported" : "report.viewed"
          ),
          audit.status.headHash
        );
        if (reportExportMatch) {
          signed(response, `report-export:${report.id}`, buildReportExport(report));
        } else {
          signed(response, `report:${report.id}`, report);
        }
        return;
      }

      const challengeMatch = path.match(
        /^\/bff\/api\/approvals\/([^/]+)\/step-up\/challenges$/
      );
      if (request.method === "POST" && challengeMatch) {
        if (!exactOrigin(request, config)) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const session = authorized(request, response, "approvals:step-up");
        if (!session) return;
        let approvalId: string;
        try {
          approvalId = decodeURIComponent(challengeMatch[1]);
        } catch {
          json(response, 400, { error: "invalid_approval_id" });
          return;
        }
        if (!/^APV-\d{6}$/.test(approvalId)) {
          json(response, 400, { error: "invalid_approval_id" });
          return;
        }
        const approval = demoRepository.approvals().find((item) => item.id === approvalId);
        if (!approval) {
          json(response, 404, { error: "approval_not_found" });
          return;
        }
        if (!approval.stepUpRequired) {
          json(response, 409, { error: "step_up_not_required" });
          return;
        }
        const { commandDigest } = await readJsonBody(request, ["commandDigest"]);
        if (commandDigest !== approvalCommandDigest(approval)) {
          json(response, 409, { error: "approval_version_mismatch" });
          return;
        }
        const audit = await auditStore.snapshot();
        signed(response, `step-up-challenge:${approval.id}`, stepUp.begin({
          sessionId: session.id,
          subject: session.subject,
          approvalId: approval.id,
          commandDigest,
          auditHeadHash: audit.status.headHash
        }));
        return;
      }

      const verificationMatch = path.match(
        /^\/bff\/api\/approvals\/([^/]+)\/step-up\/challenges\/([^/]+)\/verify$/
      );
      if (request.method === "POST" && verificationMatch) {
        if (!exactOrigin(request, config)) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const session = authorized(request, response, "approvals:step-up");
        if (!session) return;
        let approvalId: string;
        let challengeId: string;
        try {
          approvalId = decodeURIComponent(verificationMatch[1]);
          challengeId = decodeURIComponent(verificationMatch[2]);
        } catch {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        if (!/^APV-\d{6}$/.test(approvalId) || !/^[A-Za-z0-9_-]{32,}$/.test(challengeId)) {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        const approval = demoRepository.approvals().find((item) => item.id === approvalId);
        if (!approval) {
          json(response, 404, { error: "approval_not_found" });
          return;
        }
        const { commandDigest, code } = await readJsonBody(request, ["commandDigest", "code"]);
        if (!/^\d{6}$/.test(code)) {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        if (commandDigest !== approvalCommandDigest(approval)) {
          json(response, 409, { error: "approval_version_mismatch" });
          return;
        }
        const audit = await auditStore.snapshot();
        signed(
          response,
          `step-up-verification:${approval.id}`,
          stepUp.verify(challengeId, code, {
            sessionId: session.id,
            subject: session.subject,
            approvalId: approval.id,
            commandDigest,
            auditHeadHash: audit.status.headHash
          })
        );
        return;
      }

      const previewMatch = path.match(/^\/bff\/api\/approvals\/([^/]+)\/preview$/);
      if (request.method === "POST" && previewMatch) {
        if (!exactOrigin(request, config)) {
          json(response, 403, { error: "origin_rejected" });
          return;
        }
        const session = authorized(request, response, "approvals:preview");
        if (!session) return;
        let approvalId: string;
        try {
          approvalId = decodeURIComponent(previewMatch[1]);
        } catch {
          json(response, 400, { error: "invalid_approval_id" });
          return;
        }
        if (!/^APV-\d{6}$/.test(approvalId)) {
          json(response, 400, { error: "invalid_approval_id" });
          return;
        }
        const approval = demoRepository.approvals().find((item) => item.id === approvalId);
        if (!approval) {
          json(response, 404, { error: "approval_not_found" });
          return;
        }
        const { commandDigest, stepUpGrant } = await readJsonBody(
          request,
          ["commandDigest"],
          ["stepUpGrant"]
        );
        if (commandDigest !== approvalCommandDigest(approval)) {
          json(response, 409, { error: "approval_version_mismatch" });
          return;
        }
        const audit = await auditStore.snapshot();
        let stepUpVerified = false;
        if (stepUpGrant !== undefined) {
          if (!approval.stepUpRequired) {
            json(response, 409, { error: "step_up_not_required" });
            return;
          }
          stepUp.consume(stepUpGrant, {
            sessionId: session.id,
            subject: session.subject,
            approvalId: approval.id,
            commandDigest,
            auditHeadHash: audit.status.headHash
          });
          stepUpVerified = true;
        }
        signed(
          response,
          `approval-preview:${approval.id}`,
          buildApprovalPreview(
            approval,
            session.subject,
            audit.events,
            stepUpVerified
          )
        );
        return;
      }

      json(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof RequestBodyError) {
        json(response, error.status, {
          error: error.status === 415 ? "unsupported_media_type" : "invalid_request"
        });
        return;
      }
      if (error instanceof AuditStoreError) {
        json(response, 503, { error: "audit_integrity_unavailable" });
        return;
      }
      if (error instanceof StepUpRejectedError) {
        json(response, 409, {
          error: "step_up_rejected",
          state: error.state,
          attemptsRemaining: error.attemptsRemaining
        });
        return;
      }
      json(response, 500, { error: "request_failed" });
    }
  });
  guardRawResponses(server, apiSecurityHeaders);
  server.once("close", () => clearInterval(rotationTimer));
  return server;
}
