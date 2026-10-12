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
import { ExpiringStore, type PendingLogin } from "./session.js";
import {
  type OperatorSession,
  type SessionStore,
  SessionStoreError,
  SessionStoreUnavailableError,
  createMemorySessionStore,
  createOperatorSessionDirectory
} from "./session-store.js";
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
import { isSubjectRef, readableSubjectKinds, subjectTimelineAccessEvent } from "./subjects.js";
import { createProviderEvidenceSource } from "./provider-evidence.js";
import {
  type CustomerApiClient,
  createCustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
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
const oidcTransactionTtlSeconds = 600;
const maxPendingLoginsPerInitiator = 2;
const maxPendingLogins = 256;
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
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value.join("="));
    } catch {
      // A cookie pair with malformed percent-encoding is ignored, as if absent.
    }
  }
  return cookies;
}

function isLoopback(host: string): boolean {
  if (host === "::1") return true;
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
  "/bff/api/operator/admin",
  "/bff/api/operator/subjects",
  "/bff/api/operator/subjects/:id",
  "/bff/api/operator/queue",
  "/bff/api/operator/queue/:kind/:id",
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

function defaultSessionStore(config: ServerConfig): SessionStore {
  if (config.session && config.session.storage !== "memory") {
    throw new SessionStoreUnavailableError("PostgreSQL session storage must be initialized before BFF");
  }
  const store = createMemorySessionStore();
  // The memory backend's initialize body is synchronous, so this resolves
  // before the first request can reach a route that touches the store.
  void store.initialize();
  return store;
}

export function createBackofficeServer(
  config: ServerConfig,
  auditStore: AuditStore = defaultAuditStore(config),
  injectedSigningKeys?: EphemeralSigningKeyProvider,
  observability: ObservabilityOptions = {},
  customerApiClient?: CustomerApiClient,
  sessionStore?: SessionStore
) {
  const pendingLogins = new ExpiringStore<PendingLogin>();
  const sessions = sessionStore ?? defaultSessionStore(config);
  const sessionDirectory = createOperatorSessionDirectory({
    store: sessions,
    ttlMs: config.sessionTtlSeconds * 1_000
  });
  const signingKeys = injectedSigningKeys
    ?? new EphemeralSigningKeyProvider(config.signing.retainedVerificationKeys);
  const signer = new ResponseSigner(signingKeys);
  const stepUp = new SyntheticStepUpService(config.stepUp);
  const providerEvidence = createProviderEvidenceSource();
  const customerApi = customerApiClient
    ?? createCustomerApiClient({
      baseUrl: config.customerApiUrl,
      devTokenKey: config.customerApiDevTokenKey
    });
  const deviceBinding = config.deviceBinding ?? { mode: "off", approvedDeviceDigests: [] };
  const enforceDevices = deviceBinding.mode === "enforce";
  const approvedDevices = new Set(deviceBinding.approvedDeviceDigests);

  function setSessionCookie(response: ServerResponse, token: string): void {
    const secure = config.allowedOrigins.every((origin) => origin.startsWith("https://"));
    const flags = [
      `${sessionCookie}=${encodeURIComponent(token)}`,
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

  function oidcTxCookieValue(value: string, maxAge: number): string {
    const secure = config.allowedOrigins.every((origin) => origin.startsWith("https:"))
      ? "; Secure"
      : "";
    return `${oidcTransactionCookie}=${encodeURIComponent(value)}; Path=/bff/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  /** Every login-path failure collapses to one generic redirect. */
  function oidcAuthFailed(response: ServerResponse): void {
    response.setHeader("set-cookie", oidcTxCookieValue("", 0));
    redirect(response, `${config.allowedOrigins[0]}/?error=auth_failed`);
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
  ): { deviceId?: string } | { deniedDigest: string } {
    if (!enforceDevices) return {};
    const deviceId = ensureDeviceId(request, response);
    if (deviceApproved(deviceId)) return { deviceId };
    return { deniedDigest: deviceDigest(deviceId) };
  }

  async function currentSession(request: IncomingMessage): Promise<OperatorSession | undefined> {
    const token = parseCookies(request)[sessionCookie];
    const session = token ? await sessionDirectory.resolve(token) : null;
    if (!session || !enforceDevices) return session ?? undefined;
    const deviceId = requestDeviceId(request);
    return deviceId !== undefined
      && session.deviceDigest === deviceDigest(deviceId)
      && deviceApproved(deviceId)
      ? session
      : undefined;
  }

  async function createSession(
    request: IncomingMessage,
    response: ServerResponse,
    identity: Omit<OperatorSession, "id" | "expiresAt" | "deviceDigest"> & { deviceId?: string },
    loginStartSessionToken?: string
  ): Promise<OperatorSession> {
    const previousToken = parseCookies(request)[sessionCookie];
    if (previousToken) await sessionDirectory.revokeByToken(previousToken);
    if (loginStartSessionToken) await sessionDirectory.revokeByToken(loginStartSessionToken);
    const { deviceId, ...rest } = identity;
    const { session, token } = await sessionDirectory.issue({
      ...rest,
      deviceDigest: deviceId === undefined ? null : deviceDigest(deviceId)
    });
    setSessionCookie(response, token);
    return session;
  }

  function signed<T>(response: ServerResponse, resource: string, payload: T): void {
    json(response, 200, signer.envelope(resource, payload, randomUUID()));
  }

  async function authorized(
    request: IncomingMessage,
    response: ServerResponse,
    capability?: Capability
  ): Promise<OperatorSession | undefined> {
    const session = await currentSession(request);
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
    { name: "solidchange_backoffice_sessions_active", help: "Unexpired operator sessions.", value: () => sessionDirectory.countLive() },
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
      let url: URL;
      try {
        url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      } catch {
        json(response, 400, { error: "invalid_request" });
        return;
      }
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
          sessions: {
            backend: sessions.kind
          },
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
          json(response, 404, { error: "not_found" });
          return;
        }
        const presented = parseCookies(request)[oidcTransactionCookie];
        const presentedState = presented?.split(".")[0];
        const prior = presentedState ? pendingLogins.get(presentedState) : undefined;
        const current = await currentSession(request);
        const state = createOpaqueValue();
        const nonce = createOpaqueValue();
        const verifier = createOpaqueValue(48);
        // `sub` is unknowable until the token verifies, so the outstanding
        // bound keys on the initiating identity: the live session's subject
        // when one exists, otherwise the chain of transaction cookies this
        // browser presented (self-rooted on a first login).
        const initiator = current
          ? `sess:${current.subject}`
          : prior?.initiator ?? `flow:${state}`;
        pendingLogins.set(state, {
          nonce,
          verifier,
          initiator,
          previousSessionToken: parseCookies(request)[sessionCookie] || undefined,
          expiresAt: Date.now() + oidcTransactionTtlSeconds * 1_000
        });
        pendingLogins.retainNewest(
          (entry) => entry.initiator === initiator,
          maxPendingLoginsPerInitiator
        );
        pendingLogins.retainNewest(() => true, maxPendingLogins);
        response.setHeader(
          "set-cookie",
          oidcTxCookieValue(`${state}.${nonce}`, oidcTransactionTtlSeconds)
        );
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
        json(response, 200, { authenticated: Boolean(await currentSession(request)) });
        return;
      }

      if (request.method === "GET" && path === "/bff/auth/callback") {
        if (!config.oidc) {
          json(response, 404, { error: "not_found" });
          return;
        }
        if (url.searchParams.get("error") !== null) {
          oidcAuthFailed(response);
          return;
        }
        const codes = url.searchParams.getAll("code");
        const states = url.searchParams.getAll("state");
        if (codes.length !== 1 || states.length !== 1 || !codes[0]) {
          oidcAuthFailed(response);
          return;
        }
        const transaction = parseCookies(request)[oidcTransactionCookie];
        const [txState, txNonce] = transaction?.split(".") ?? [];
        if (txState !== states[0] || !txNonce) {
          oidcAuthFailed(response);
          return;
        }
        const pending = pendingLogins.take(states[0]);
        if (!pending || pending.nonce !== txNonce) {
          oidcAuthFailed(response);
          return;
        }
        const device = admittedDevice(request, response);
        if ("deniedDigest" in device) {
          oidcAuthFailed(response);
          return;
        }
        try {
          const exchange = await exchangeAuthorizationCode(
            config.oidc,
            codes[0],
            pending.verifier
          );
          const identity = await verifyIdToken(
            exchange.idToken,
            config.oidc,
            pending.nonce,
            exchange.accessToken
          );
          await createSession(
            request,
            response,
            { ...identity, subject: customerApiSubject(identity.subject), ...device },
            pending.previousSessionToken
          );
          appendCookie(response, oidcTxCookieValue("", 0));
          redirect(response, config.allowedOrigins[0]);
        } catch {
          oidcAuthFailed(response);
        }
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
        if ("deniedDigest" in device) {
          json(response, 403, {
            error: "device_not_approved",
            deviceDigest: device.deniedDigest
          });
          return;
        }
        const session = await createSession(request, response, {
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
        const session = await currentSession(request);
        if (session) await sessionDirectory.revoke(session.id);
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
        const session = await authorized(request, response);
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

      if (request.method === "GET" && path === "/bff/api/operator/admin") {
        const session = await authorized(request, response);
        if (!session) return;
        if (customerApi.configured) {
          // The upstream operator audience pins X-Device-Id to the session's
          // bound workstation device (in enforce mode currentSession already
          // proved the presented device equals the session's device digest). Without a
          // device identity the BFF cannot form a contract-valid request and
          // rejects locally before any upstream call.
          const deviceId = requestDeviceId(request);
          if (!deviceId) {
            json(response, 403, { error: "device_required" });
            return;
          }
          const upstream = await customerApi.operatorAdmin(session.subject, deviceId, Date.now());
          if (upstream.status !== "ok") {
            json(response, 503, { error: "operator_admin_unavailable" });
            return;
          }
          signed(response, "operator-admin", {
            mode: upstream.view.mode,
            operatorId: upstream.view.operator_id,
            subject: upstream.view.subject,
            role: upstream.view.role,
            grantedCapabilities: [...upstream.view.granted_capabilities],
            createdAt: upstream.view.created_at,
            updatedAt: upstream.view.updated_at
          });
          return;
        }
        // Unconfigured: the existing local synthetic behavior — the operator's
        // own session plus its role profile, with upstream-only directory
        // fields left empty rather than invented.
        const profile = findRole(session.role);
        if (!profile) {
          json(response, 403, { error: "role_not_found" });
          return;
        }
        signed(response, "operator-admin", {
          mode: "test",
          operatorId: null,
          subject: session.subject,
          role: session.role,
          grantedCapabilities: [...profile.capabilities],
          createdAt: null,
          updatedAt: null
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/operator/subjects") {
        const session = await authorized(request, response);
        if (!session) return;
        if (customerApi.configured) {
          // Same device gate as the operator admin read: the upstream
          // audience requires X-Device-Id, so the BFF rejects locally before
          // any call when the session presents no device identity.
          const deviceId = requestDeviceId(request);
          if (!deviceId) {
            json(response, 403, { error: "device_required" });
            return;
          }
          const upstream = await customerApi.operatorSubjects(session.subject, deviceId, Date.now());
          if (upstream.status !== "ok") {
            json(response, 503, { error: "operator_subjects_unavailable" });
            return;
          }
          signed(response, "operator-subjects", {
            mode: upstream.view.mode,
            subjects: upstream.view.subjects.map((row) => ({
              subjectId: row.subject_id,
              displayName: row.display_name,
              kycStatus: row.kyc_status,
              flags: row.flags,
              registeredAt: row.registered_at,
              lastActiveAt: row.last_active_at,
              posting: row.posting
            }))
          });
          return;
        }
        // Unconfigured: the local synthetic directory is the customer-360
        // roster, with the upstream-only fields (synthetic subject ref,
        // lifecycle status, activity timestamps) left null rather than
        // invented.
        signed(response, "operator-subjects", {
          mode: "test",
          subjects: demoRepository.customers().map((customer) => ({
            subjectId: null,
            displayName: customer.name,
            kycStatus: null,
            flags: customer.openAmlCases,
            registeredAt: null,
            lastActiveAt: null,
            posting: "none"
          }))
        });
        return;
      }

      const operatorSubjectMatch = path.match(/^\/bff\/api\/operator\/subjects\/([^/]+)$/);
      if (request.method === "GET" && operatorSubjectMatch) {
        const session = await authorized(request, response);
        if (!session) return;
        const requestedId = decodeURIComponent(operatorSubjectMatch[1]);
        if (customerApi.configured) {
          // Same device gate as the other operator reads: the upstream
          // audience requires X-Device-Id, so the BFF rejects locally before
          // any call when the session presents no device identity.
          const deviceId = requestDeviceId(request);
          if (!deviceId) {
            json(response, 403, { error: "device_required" });
            return;
          }
          const upstream = await customerApi.operatorSubject(session.subject, deviceId, requestedId, Date.now());
          // Unknown and non-contract ids share the upstream's uniform 404 —
          // the BFF keeps that shape instead of revealing which ids exist.
          if (upstream.status === "not-found") {
            json(response, 404, { error: "operator_subject_not_found" });
            return;
          }
          if (upstream.status !== "ok") {
            json(response, 503, { error: "operator_subject_unavailable" });
            return;
          }
          signed(response, `operator-subject:${requestedId}`, {
            mode: upstream.view.mode,
            subject: {
              subjectId: upstream.view.subject.subject_id,
              displayName: upstream.view.subject.display_name,
              kycStatus: upstream.view.subject.kyc_status,
              flags: upstream.view.subject.flags,
              registeredAt: upstream.view.subject.registered_at,
              lastActiveAt: upstream.view.subject.last_active_at,
              posting: upstream.view.subject.posting,
              accountStatus: upstream.view.subject.account_status,
              contactHash: upstream.view.subject.contact_hash,
              sessions: upstream.view.subject.sessions,
              devices: [...upstream.view.subject.devices],
              limits: {
                maxSessions: upstream.view.subject.limits.max_sessions,
                maxDevices: upstream.view.subject.limits.max_devices
              },
              recentActivity: upstream.view.subject.recent_activity.map((item) => ({
                activityId: item.activity_id,
                kind: item.kind,
                occurredAt: item.occurred_at,
                summary: item.summary,
                money: item.money === null ? null : { amount: item.money.amount, asset: item.money.asset }
              })),
              kyc: upstream.view.subject.kyc === null
                ? null
                : {
                    status: upstream.view.subject.kyc.status,
                    level: upstream.view.subject.kyc.level,
                    sessionId: upstream.view.subject.kyc.session_id,
                    history: upstream.view.subject.kyc.history.map((attempt) => ({
                      sessionId: attempt.session_id,
                      state: attempt.state,
                      submittedAt: attempt.submitted_at,
                      decidedAt: attempt.decided_at,
                      rejectionReason: attempt.rejection_reason
                    }))
                  }
            }
          });
          return;
        }
        // Unconfigured: the local synthetic directory resolves the row by its
        // customer id — the roster carries no upstream refs, so anything that
        // is not a local CUS-* id is the uniform not-found, and the
        // upstream-only detail fields stay null rather than invented.
        const customer = demoRepository.customers().find((row) => row.id === requestedId);
        if (!customer) {
          json(response, 404, { error: "operator_subject_not_found" });
          return;
        }
        signed(response, `operator-subject:${requestedId}`, {
          mode: "test",
          subject: {
            subjectId: null,
            displayName: customer.name,
            kycStatus: null,
            flags: customer.openAmlCases,
            registeredAt: null,
            lastActiveAt: null,
            posting: "none",
            accountStatus: null,
            contactHash: null,
            sessions: null,
            devices: [],
            limits: null,
            recentActivity: [],
            kyc: null
          }
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/operator/queue") {
        const session = await authorized(request, response);
        if (!session) return;
        // `kind` is the operator queue's only query parameter: absent means
        // kyc (the default upstream), anything outside the enum is invalid
        // input and fails closed locally rather than propagating upstream.
        const kindParam = url.searchParams.get("kind");
        const kind = kindParam === null ? "kyc" : kindParam;
        if (kind !== "kyc" && kind !== "aml" && kind !== "tickets") {
          json(response, 400, { error: "operator_queue_kind_invalid" });
          return;
        }
        if (customerApi.configured) {
          // Same device gate as the other operator reads: the upstream
          // audience requires X-Device-Id, so the BFF rejects locally before
          // any call when the session presents no device identity.
          const deviceId = requestDeviceId(request);
          if (!deviceId) {
            json(response, 403, { error: "device_required" });
            return;
          }
          const upstream = await customerApi.operatorQueue(session.subject, deviceId, kind, Date.now());
          if (upstream.status !== "ok") {
            json(response, 503, { error: "operator_queue_unavailable" });
            return;
          }
          // Per-kind item mapping: every kind carries the shared queue
          // axes (queueId/subjectId/state/priority/assignee/ageMs); the
          // kind-specific fields map alongside on the same camelCase
          // surface, and by_state keys pass through per kind.
          const items = upstream.view.queue.items.map((item) => {
            const core = {
              queueId: item.queue_id,
              subjectId: item.subject_id,
              state: item.state,
              priority: item.priority,
              assignee: item.assignee === null ? null : { subject: item.assignee.subject },
              ageMs: item.age_ms
            };
            if (upstream.view.queue.kind === "aml") {
              const aml = item as (typeof upstream.view.queue.items)[number] & {
                alert_type: string;
                evidence_refs: readonly string[];
                sla_due_at: string;
              };
              return { ...core, alertType: aml.alert_type, evidenceRefs: [...aml.evidence_refs], slaDueAt: aml.sla_due_at };
            }
            if (upstream.view.queue.kind === "tickets") {
              const ticket = item as (typeof upstream.view.queue.items)[number] & {
                category: string;
                opened_at: string;
              };
              return { ...core, category: ticket.category, openedAt: ticket.opened_at };
            }
            const kyc = item as (typeof upstream.view.queue.items)[number] & {
              display_name: string;
              submitted_at: string;
              sla_due_at: string;
            };
            return { ...core, displayName: kyc.display_name, submittedAt: kyc.submitted_at, slaDueAt: kyc.sla_due_at };
          });
          signed(response, `operator-queue:${kind}`, {
            mode: upstream.view.mode,
            queue: {
              kind: upstream.view.queue.kind,
              items,
              summary: {
                count: upstream.view.queue.summary.count,
                byState:
                  upstream.view.queue.kind === "tickets"
                    ? {
                        open: upstream.view.queue.summary.by_state.open,
                        waiting: upstream.view.queue.summary.by_state.waiting,
                        escalated: upstream.view.queue.summary.by_state.escalated
                      }
                    : {
                        pending: upstream.view.queue.summary.by_state.pending,
                        inReview: upstream.view.queue.summary.by_state.in_review,
                        escalated: upstream.view.queue.summary.by_state.escalated
                      }
              },
              posting: upstream.view.queue.posting
            }
          });
          return;
        }
        // Unconfigured: the matching local roster is the work queue for
        // each kind — only items still occupying the queue appear, with
        // the upstream-only fields (synthetic refs, derived enums, item
        // age, staff assignee) left null rather than invented.
        const localItems =
          kind === "aml"
            ? demoRepository.amlCases().map((row) => ({
                queueId: null,
                subjectId: null,
                alertType: null,
                evidenceRefs: [],
                slaDueAt: null,
                state: row.state === "escalated" ? "escalated" : row.state === "review" ? "in_review" : "pending",
                priority: row.severity === "High" ? "high" : "normal",
                assignee: null,
                ageMs: null
              }))
            : kind === "tickets"
              ? demoRepository
                  .supportTickets()
                  .filter((row) => row.status !== "resolved")
                  .map((row) => ({
                    queueId: null,
                    subjectId: null,
                    category: null,
                    openedAt: row.createdAt,
                    state: row.status === "escalated" ? "escalated" : row.status === "pending-customer" ? "waiting" : "open",
                    priority: row.priority === "urgent" ? "urgent" : row.priority === "high" ? "high" : "normal",
                    assignee: null,
                    ageMs: null
                  }))
              : demoRepository
                  .kycCases()
                  .filter((row) => row.status !== "verified")
                  .map((row) => ({
                    queueId: null,
                    subjectId: null,
                    displayName: row.subject,
                    submittedAt: row.openedAt,
                    slaDueAt: null,
                    state: row.status === "review" ? "in_review" : "pending",
                    priority: row.riskRating === "High" ? "high" : "normal",
                    assignee: null,
                    ageMs: null
                  }));
        // Match the upstream summary shape: every state key of the kind is
        // present even at zero.
        const byState: Record<string, number> =
          kind === "tickets" ? { open: 0, waiting: 0, escalated: 0 } : { pending: 0, inReview: 0, escalated: 0 };
        for (const item of localItems) {
          const key = item.state === "in_review" ? "inReview" : item.state;
          byState[key] += 1;
        }
        signed(response, `operator-queue:${kind}`, {
          mode: "test",
          queue: {
            kind,
            items: localItems,
            summary: { count: localItems.length, byState },
            posting: "none"
          }
        });
        return;
      }

      const operatorQueueItemMatch = path.match(/^\/bff\/api\/operator\/queue\/([^/]+)\/([^/]+)$/);
      if (request.method === "GET" && operatorQueueItemMatch) {
        const session = await authorized(request, response);
        if (!session) return;
        const kind = decodeURIComponent(operatorQueueItemMatch[1]);
        const itemId = decodeURIComponent(operatorQueueItemMatch[2]);
        // Unknown kind shares the member read's uniform 404 — same as
        // upstream, a kind outside the enum never reveals which ids exist.
        if (kind !== "kyc" && kind !== "aml" && kind !== "tickets") {
          json(response, 404, { error: "operator_queue_item_not_found" });
          return;
        }
        if (customerApi.configured) {
          // Same device gate as the other operator reads: the upstream
          // audience requires X-Device-Id, so the BFF rejects locally before
          // any call when the session presents no device identity.
          const deviceId = requestDeviceId(request);
          if (!deviceId) {
            json(response, 403, { error: "device_required" });
            return;
          }
          const upstream = await customerApi.operatorQueueItem(session.subject, deviceId, kind, itemId, Date.now());
          // Unknown and wrong-kind ids share the upstream's uniform 404 —
          // the BFF keeps that shape instead of revealing which ids exist.
          if (upstream.status === "not-found") {
            json(response, 404, { error: "operator_queue_item_not_found" });
            return;
          }
          if (upstream.status !== "ok") {
            json(response, 503, { error: "operator_queue_item_unavailable" });
            return;
          }
          const core = {
            queueId: upstream.view.item.queue_id,
            subjectId: upstream.view.item.subject_id,
            state: upstream.view.item.state,
            priority: upstream.view.item.priority,
            assignee: upstream.view.item.assignee === null ? null : { subject: upstream.view.item.assignee.subject },
            ageMs: upstream.view.item.age_ms
          };
          // Per-kind item mapping: the shared queue axes plus the kind's
          // detail fields on the same camelCase surface as the collection.
          let item: Record<string, unknown>;
          if (upstream.view.kind === "aml") {
            const detail = upstream.view.item;
            item = {
              ...core,
              alertType: detail.alert_type,
              evidenceRefs: [...detail.evidence_refs],
              slaDueAt: detail.sla_due_at,
              flags: detail.flags.map((flag) => ({ flagId: flag.flag_id, alertType: flag.alert_type, raisedAt: flag.raised_at }))
            };
          } else if (upstream.view.kind === "tickets") {
            const detail = upstream.view.item;
            item = {
              ...core,
              category: detail.category,
              openedAt: detail.opened_at,
              subject: detail.subject,
              lastMessageAt: detail.last_message_at,
              otherOpenTickets: detail.other_open_tickets
            };
          } else {
            const detail = upstream.view.item;
            item = {
              ...core,
              displayName: detail.display_name,
              submittedAt: detail.submitted_at,
              slaDueAt: detail.sla_due_at,
              kyc: detail.kyc === null
                ? null
                : {
                    status: detail.kyc.status,
                    level: detail.kyc.level,
                    sessionId: detail.kyc.session_id,
                    history: detail.kyc.history.map((attempt) => ({
                      sessionId: attempt.session_id,
                      state: attempt.state,
                      submittedAt: attempt.submitted_at,
                      decidedAt: attempt.decided_at,
                      rejectionReason: attempt.rejection_reason
                    }))
                  }
            };
          }
          signed(response, `operator-queue-item:${kind}:${itemId}`, {
            mode: upstream.view.mode,
            kind: upstream.view.kind,
            item
          });
          return;
        }
        // Unconfigured: the local synthetic directory has no queue ids to
        // resolve — the collection fabricates `queueId: null` rows, so any
        // member read is the uniform not-found rather than an invented
        // detail.
        json(response, 404, { error: "operator_queue_item_not_found" });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/dashboard") {
        if (!await authorized(request, response, "dashboard:read")) return;
        signed(response, "dashboard", {
          metrics: demoRepository.metrics(),
          queues: demoRepository.queues()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/customers") {
        if (!await authorized(request, response, "customers:read")) return;
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
        const session = await authorized(request, response, "checks:read");
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
        const session = await authorized(request, response, "support:read");
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
        const session = await authorized(request, response, "custody:read");
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
        const session = await authorized(request, response, "subjects:read");
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
        const timeline = demoRepository.subjectTimeline(ref, readableSubjectKinds(session.role));
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
        if (!await authorized(request, response, "kyc:read")) return;
        signed(response, "kyc-cases", {
          cases: demoRepository.kycCases(),
          providerEvidence: await providerEvidence.kyc()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/aml") {
        if (!await authorized(request, response, "aml:read")) return;
        signed(response, "aml-cases", {
          cases: demoRepository.amlCases(),
          providerEvidence: await providerEvidence.kyt()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/investigations") {
        if (!await authorized(request, response, "investigations:read")) return;
        signed(response, "investigations", {
          cases: demoRepository.investigationCases()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/fraud-alerts") {
        if (!await authorized(request, response, "fraud:read")) return;
        signed(response, "fraud-alerts", {
          alerts: demoRepository.fraudAlerts()
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/approvals") {
        if (!await authorized(request, response, "approvals:read")) return;
        signed(response, "approvals", {
          approvals: demoRepository.approvals().map((approval) => ({
            ...approval,
            commandDigest: approvalCommandDigest(approval)
          }))
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/audit") {
        if (!await authorized(request, response, "audit:read")) return;
        const audit = await auditStore.snapshot();
        signed(response, "audit", {
          events: audit.events,
          chain: audit.status
        });
        return;
      }

      if (request.method === "GET" && path === "/bff/api/audit/export") {
        if (!await authorized(request, response, "audit:export")) return;
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
        const session = await authorized(request, response, "reports:read");
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
        const session = await authorized(request, response, "approvals:step-up");
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
        const session = await authorized(request, response, "approvals:step-up");
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
        const session = await authorized(request, response, "approvals:preview");
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
      if (error instanceof SessionStoreError) {
        json(response, 503, { error: "session_store_unavailable" });
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
