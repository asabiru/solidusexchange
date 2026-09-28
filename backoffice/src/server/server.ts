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
import { ExpiringStore, type OperatorSession, type PendingLogin } from "./session.js";
import { ResponseSigner } from "./signing.js";
import {
  approvalCommandDigest,
  buildApprovalPreview,
  buildAuditChain,
  verifyAuditChain
} from "./controls.js";

const sessionCookie = "solidchange_bo_session";
const validRoles = new Set<OperatorRole>([
  "compliance-lead",
  "support-l1",
  "aml-investigator",
  "auditor"
]);

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

function redirect(response: ServerResponse, location: string): void {
  securityHeaders(response);
  response.statusCode = 302;
  response.setHeader("location", location);
  response.end();
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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 4_096) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createBackofficeServer(config: ServerConfig) {
  const pendingLogins = new ExpiringStore<PendingLogin>();
  const sessions = new ExpiringStore<OperatorSession>();
  const signer = new ResponseSigner();
  const audit = buildAuditChain(demoRepository.auditSource());
  if (!verifyAuditChain(audit)) throw new Error("Synthetic audit chain is invalid");

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
    response.setHeader("set-cookie", flags.join("; "));
  }

  function clearSessionCookie(response: ServerResponse): void {
    response.setHeader(
      "set-cookie",
      `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/bff; Max-Age=0`
    );
  }

  function currentSession(request: IncomingMessage): OperatorSession | undefined {
    const id = parseCookies(request)[sessionCookie];
    return id ? sessions.get(id) : undefined;
  }

  function createSession(
    response: ServerResponse,
    identity: Omit<OperatorSession, "id" | "expiresAt">
  ): OperatorSession {
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

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const path = url.pathname;

      if (request.method === "GET" && path === "/bff/healthz") {
        json(response, 200, {
          mode: "dev-dry-run",
          oidcConfigured: Boolean(config.oidc),
          devLoginEnabled: config.allowDevLogin,
          dataSource: "synthetic",
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
          expiresAt: Date.now() + 5 * 60 * 1_000
        });
        redirect(response, authorizationUrl(config.oidc, state, nonce, verifier));
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
        const pending = state ? pendingLogins.take(state) : undefined;
        if (!code || !pending) {
          json(response, 400, { error: "oidc_callback_rejected" });
          return;
        }
        const idToken = await exchangeAuthorizationCode(config.oidc, code, pending.verifier);
        const identity = await verifyIdToken(idToken, config.oidc, pending.nonce);
        createSession(response, identity);
        redirect(response, config.allowedOrigins[0]);
        return;
      }

      if (request.method === "POST" && path === "/bff/auth/dev-session") {
        if (
          !config.allowDevLogin
          || !isLoopback(config.host)
          || !isLoopbackAddress(request.socket.remoteAddress)
          || !exactOrigin(request, config)
        ) {
          json(response, 404, { error: "not_found" });
          return;
        }
        const body = await readJson(request);
        const role = body && typeof body === "object" && "role" in body ? body.role : undefined;
        if (typeof role !== "string" || !validRoles.has(role as OperatorRole)) {
          json(response, 400, { error: "unsupported_role" });
          return;
        }
        const profile = findRole(role);
        if (!profile) {
          json(response, 400, { error: "unsupported_role" });
          return;
        }
        const session = createSession(response, {
          subject: `dev:${profile.id}`,
          email: `${profile.id}@dev.solidchange.invalid`,
          name: profile.operator,
          role: profile.id
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
        json(response, 200, { keyId: signer.keyId, publicJwk: signer.publicJwk });
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
        const head = audit.at(-1);
        signed(response, "audit", {
          events: audit,
          chain: {
            verified: true,
            length: audit.length,
            headHash: head?.hash ?? ""
          }
        });
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
        let body: unknown;
        try {
          body = await readJson(request);
        } catch {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        const commandDigest = body && typeof body === "object" && "commandDigest" in body
          ? body.commandDigest
          : undefined;
        if (typeof commandDigest !== "string") {
          json(response, 400, { error: "invalid_request" });
          return;
        }
        if (commandDigest !== approvalCommandDigest(approval)) {
          json(response, 409, { error: "approval_version_mismatch" });
          return;
        }
        signed(
          response,
          `approval-preview:${approval.id}`,
          buildApprovalPreview(approval, session.subject, audit)
        );
        return;
      }

      json(response, 404, { error: "not_found" });
    } catch {
      json(response, 500, { error: "request_failed" });
    }
  });
}
