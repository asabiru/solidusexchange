import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect, createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build, createServer as createViteServer, preview, resolveConfig } from "vite";
import type { ApprovalRow } from "../data/demo.js";
import { AuditStoreError, type AuditStore } from "./audit-store.js";
import type { ServerConfig } from "./config.js";
import {
  apiCspDirectives,
  apiSecurityHeaders,
  devDocumentCspDirectives,
  devDocumentSecurityHeaders,
  documentCspDirectives,
  documentSecurityHeaders,
  permissionsPolicy,
  serializeCsp
} from "./security-headers.js";
import { createBackofficeServer, routeTemplates } from "./server.js";

const backofficeRoot = fileURLToPath(new URL("../../", import.meta.url));
const origin = "http://127.0.0.1:4173";
const issuer = "https://identity.example.test";
const clientId = "solidchange-backoffice";
const schemeOnlySource = /^[a-z][a-z0-9+.-]*:$/;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface RawReply {
  status: number;
  headers: Map<string, string>;
}

function rawExchange(port: number, text: string): Promise<RawReply> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      const [statusLine, ...lines] = Buffer.concat(chunks).toString("latin1").split("\r\n\r\n")[0].split("\r\n");
      resolve({
        status: Number(statusLine.split(" ")[1]),
        headers: new Map(lines.map((line) => {
          const colon = line.indexOf(":");
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }))
      });
    });
    socket.write(text);
  });
}

const rawRejections: readonly (readonly [number, string])[] = [
  [400, "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nmalformed header line\r\n\r\n"],
  [431, `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nx-fill: ${"a".repeat(20_000)}\r\n\r\n`],
  [417, "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: synthetic-unmet\r\n\r\n"]
];

async function assertRawRejections(port: number, headers: Readonly<Record<string, string>>, label: string): Promise<void> {
  for (const [status, text] of rawRejections) {
    const reply = await rawExchange(port, text);
    assert.equal(reply.status, status, `${label} ${status}`);
    assert.equal(reply.headers.get("connection"), "close", `${label} ${status}`);
    for (const [name, value] of Object.entries(headers)) {
      assert.equal(reply.headers.get(name), value, `${label} ${status}: ${name}`);
    }
  }
}

function parseCsp(header: string): Map<string, string[]> {
  return new Map(header.split(";").map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }));
}

function assertStrictDocumentCsp(header: string): void {
  const strictSources = new Set(["'self'", "'none'", "data:"]);
  const csp = parseCsp(header);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("script-src"), ["'self'"]);
  assert.deepEqual(csp.get("style-src"), ["'self'"]);
  assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  assert.deepEqual(csp.get("img-src"), ["'self'", "data:"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'none'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  for (const [name, sources] of csp) {
    for (const source of sources) {
      assert.ok(strictSources.has(source), `${name} ${source}`);
      assert.equal(source.includes("*"), false, `${name} ${source}`);
      if (schemeOnlySource.test(source)) assert.equal(`${name} ${source}`, "img-src data:");
    }
  }
}

async function assertApiHeaders(response: Response, label: string): Promise<void> {
  await response.arrayBuffer();
  for (const [name, value] of Object.entries(apiSecurityHeaders)) {
    assert.equal(response.headers.get(name), value, `${label}: ${name}`);
  }
  if (response.status !== 204 && response.status !== 302) {
    assert.match(response.headers.get("content-type") ?? "", /; charset=utf-8$/, label);
  }
}

function failingAuditStore(error: Error): AuditStore {
  return {
    snapshot: async () => {
      throw error;
    },
    append: async () => {
      throw error;
    },
    close: async () => {}
  };
}

describe("Backoffice security header sets", () => {
  it("are frozen and deny framing, sniffing, caching and powerful features", () => {
    for (const set of [apiSecurityHeaders, documentSecurityHeaders, devDocumentSecurityHeaders]) {
      assert.ok(Object.isFrozen(set));
    }
    for (const directives of [apiCspDirectives, documentCspDirectives, devDocumentCspDirectives]) {
      assert.ok(Object.isFrozen(directives));
      for (const sources of Object.values(directives)) assert.ok(Object.isFrozen(sources));
    }
    assert.deepEqual(apiSecurityHeaders, {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "cross-origin-resource-policy": "same-origin",
      "permissions-policy": permissionsPolicy,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    });
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      assert.ok(permissionsPolicy.split(", ").includes(`${feature}=()`), feature);
    }
  });

  it("keep the build and preview document CSP strict and unframeable", () => {
    assertStrictDocumentCsp(documentSecurityHeaders["content-security-policy"]);
    assert.equal(documentSecurityHeaders["x-frame-options"], "DENY");
    assert.equal(documentSecurityHeaders["x-content-type-options"], "nosniff");
    assert.equal(documentSecurityHeaders["referrer-policy"], "no-referrer");
    assert.equal(documentSecurityHeaders["cross-origin-resource-policy"], "same-origin");
    assert.equal(documentSecurityHeaders["permissions-policy"], permissionsPolicy);
  });

  it("relax only script, style and HMR connect sources in Vite dev, never script evaluation", () => {
    const changed = Object.keys(devDocumentCspDirectives).filter((name) =>
      serializeCsp({ [name]: devDocumentCspDirectives[name] }) !== serializeCsp({ [name]: documentCspDirectives[name] ?? [] })
    );
    assert.deepEqual(changed, ["script-src", "style-src", "connect-src"]);
    assert.deepEqual(devDocumentCspDirectives["script-src"], ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(devDocumentCspDirectives["style-src"], ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(devDocumentCspDirectives["connect-src"], ["'self'", "ws://127.0.0.1:4173", "ws://localhost:4173"]);
    assert.deepEqual(devDocumentCspDirectives["frame-ancestors"], ["'none'"]);
    const keywords = new Set(Object.values(devDocumentCspDirectives).flat().filter((source) => source.startsWith("'")));
    assert.deepEqual([...keywords].sort(), ["'none'", "'self'", "'unsafe-inline'"]);
    assert.equal(devDocumentSecurityHeaders["content-security-policy"].includes("*"), false);
    assert.equal(devDocumentSecurityHeaders["x-frame-options"], "DENY");
  });
});

describe("Backoffice BFF security headers on every route", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const nonces = new Map<string, string>();
  let identityProvider: Server;
  let identityUrl: string;
  let bff: Server;
  let baseUrl: string;
  let oidcBff: Server;
  let oidcUrl: string;

  function config(oidc?: ServerConfig["oidc"]): ServerConfig {
    return {
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: !oidc,
      sessionTtlSeconds: 900,
      audit: { storage: "memory", retentionDays: 30 },
      stepUp: {
        provider: "synthetic-dev",
        challengeTtlSeconds: 300,
        grantTtlSeconds: 60,
        maxAttempts: 3
      },
      signing: { backend: "ephemeral-dev", rotationSeconds: 900, retainedVerificationKeys: 2 },
      observability: { log: "off", metrics: "loopback" },
      oidc
    };
  }

  before(async () => {
    identityProvider = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/jwks") {
        response.end(JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "headers-key" }] }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const code = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("code") ?? "";
      const nonce = nonces.get(code);
      if (!nonce) {
        response.statusCode = 400;
        response.end("{}");
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const header = encode({ alg: "RS256", kid: "headers-key" });
      const claims = encode({
        iss: issuer,
        sub: "operator-77",
        aud: clientId,
        exp: now + 300,
        iat: now,
        nonce,
        email: "operator@example.test",
        groups: ["compliance"]
      });
      const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), pair.privateKey).toString("base64url");
      response.end(JSON.stringify({ id_token: `${header}.${claims}.${signature}` }));
    });
    identityUrl = await listen(identityProvider);
    bff = createBackofficeServer(config());
    baseUrl = await listen(bff);
    oidcBff = createBackofficeServer(config({
      issuer,
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${identityUrl}/token`,
      jwksUri: `${identityUrl}/jwks`,
      clientId,
      clientSecret: "",
      redirectUri: `${origin}/bff/auth/callback`,
      roleClaim: "groups",
      roleMap: { compliance: "compliance-lead" }
    }));
    oidcUrl = await listen(oidcBff);
  });

  after(async () => {
    await close(oidcBff);
    await close(bff);
    await close(identityProvider);
  });

  async function devSession(): Promise<string> {
    const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ role: "compliance-lead" })
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie);
    return cookie.split(";")[0];
  }

  function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body)
    });
  }

  async function approval(cookie: string): Promise<ApprovalRow & { commandDigest: string }> {
    const response = await fetch(`${baseUrl}/bff/api/approvals`, { headers: { cookie } });
    const envelope = await response.json() as { payload: { approvals: (ApprovalRow & { commandDigest: string })[] } };
    const found = envelope.payload.approvals.find((item) => item.id === "APV-843910");
    assert.ok(found);
    return found;
  }

  async function oidcLogin(): Promise<{ login: Response; callback: Response }> {
    const login = await fetch(`${oidcUrl}/bff/auth/login`, { redirect: "manual" });
    const location = login.headers.get("location");
    assert.ok(location);
    const authorize = new URL(location);
    const state = authorize.searchParams.get("state");
    const nonce = authorize.searchParams.get("nonce");
    assert.ok(state && nonce);
    nonces.set(`code-${state}`, nonce);
    const callback = await fetch(`${oidcUrl}/bff/auth/callback?code=code-${state}&state=${state}`, {
      redirect: "manual",
      headers: { cookie: `solidchange_bo_oidc_transaction=${state}` }
    });
    return { login, callback };
  }

  async function challenge(cookie: string): Promise<{ path: string; commandDigest: string; code: string }> {
    const { id, commandDigest } = await approval(cookie);
    const path = `/bff/api/approvals/${id}/step-up/challenges`;
    const response = await postJson(path, { commandDigest }, cookie);
    assert.equal(response.status, 200);
    const envelope = await response.json() as { payload: { challengeId: string; devVerificationCode: string } };
    return {
      path: `${path}/${envelope.payload.challengeId}/verify`,
      commandDigest,
      code: envelope.payload.devVerificationCode
    };
  }

  it("sends the frozen JSON header set on each route's success path", async () => {
    const cookie = await devSession();
    const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { cookie } });
    const successes: Record<string, () => Promise<Response>> = {
      "/bff/healthz": () => fetch(`${baseUrl}/bff/healthz`),
      "/bff/metrics": () => fetch(`${baseUrl}/bff/metrics`),
      "/bff/auth/login": async () => (await oidcLogin()).login,
      "/bff/auth/device": () => get("/bff/auth/device"),
      "/bff/auth/status": () => get("/bff/auth/status"),
      "/bff/auth/callback": async () => (await oidcLogin()).callback,
      "/bff/auth/dev-session": () => postJson("/bff/auth/dev-session", { role: "auditor" }),
      "/bff/auth/logout": async () => postJson("/bff/auth/logout", {}, await devSession()),
      "/bff/api/signing-key": () => get("/bff/api/signing-key"),
      "/bff/api/signing-keys": () => get("/bff/api/signing-keys"),
      "/bff/api/session": () => get("/bff/api/session"),
      "/bff/api/dashboard": () => get("/bff/api/dashboard"),
      "/bff/api/customers": () => get("/bff/api/customers"),
      "/bff/api/checks": () => get("/bff/api/checks"),
      "/bff/api/checks/:checkId": () => get("/bff/api/checks/CHK-771312"),
      "/bff/api/support": () => get("/bff/api/support"),
      "/bff/api/support/:ticketId": () => get("/bff/api/support/SUP-384120"),
      "/bff/api/withdrawals": () => get("/bff/api/withdrawals"),
      "/bff/api/withdrawals/:withdrawalId": () => get("/bff/api/withdrawals/WDR-991804"),
      "/bff/api/subjects/:ref/timeline": () => get("/bff/api/subjects/sim-alina-mironova/timeline"),
      "/bff/api/kyc": () => get("/bff/api/kyc"),
      "/bff/api/aml": () => get("/bff/api/aml"),
      "/bff/api/investigations": () => get("/bff/api/investigations"),
      "/bff/api/fraud-alerts": () => get("/bff/api/fraud-alerts"),
      "/bff/api/approvals": () => get("/bff/api/approvals"),
      "/bff/api/audit": () => get("/bff/api/audit"),
      "/bff/api/audit/export": () => get("/bff/api/audit/export"),
      "/bff/api/reports": () => get("/bff/api/reports"),
      "/bff/api/reports/:reportId": () => get("/bff/api/reports/kyc-queue-daily"),
      "/bff/api/reports/:reportId/export": () => get("/bff/api/reports/kyc-queue-daily/export"),
      "/bff/api/approvals/:approvalId/preview": async () => {
        const { id, commandDigest } = await approval(cookie);
        return postJson(`/bff/api/approvals/${id}/preview`, { commandDigest }, cookie);
      },
      "/bff/api/approvals/:approvalId/step-up/challenges": async () => {
        const { id, commandDigest } = await approval(cookie);
        return postJson(`/bff/api/approvals/${id}/step-up/challenges`, { commandDigest }, cookie);
      },
      "/bff/api/approvals/:approvalId/step-up/challenges/:challengeId/verify": async () => {
        const pending = await challenge(cookie);
        return postJson(pending.path, { commandDigest: pending.commandDigest, code: pending.code }, cookie);
      }
    };
    assert.deepEqual(Object.keys(successes).sort(), [...routeTemplates].sort());
    for (const [route, run] of Object.entries(successes)) {
      const response = await run();
      assert.ok(response.status >= 200 && response.status < 400, `${route} -> ${response.status}`);
      await assertApiHeaders(response, route);
    }
  });

  it("sends the frozen JSON header set on each route's error paths", async () => {
    const statuses = new Set<number>();
    const check = async (response: Response, label: string) => {
      assert.ok(response.status >= 400, `${label} -> ${response.status}`);
      statuses.add(response.status);
      await assertApiHeaders(response, label);
    };
    const cookie = await devSession();
    const concrete = (route: string) => route
      .replace(":reportId", "unknown-report")
      .replace(":approvalId", "APV-999999")
      .replace(":challengeId", "a".repeat(32));
    for (const route of routeTemplates) {
      const path = concrete(route);
      const posted = path.endsWith("/preview") || path.endsWith("/challenges") || path.endsWith("/verify")
        || path === "/bff/auth/dev-session" || path === "/bff/auth/logout";
      await check(await fetch(`${baseUrl}${path}`, posted ? {} : { method: "POST", headers: { cookie } }), `flipped ${path}`);
      if (path.startsWith("/bff/api/") && !path.startsWith("/bff/api/signing-key")) {
        await check(await fetch(`${baseUrl}${path}`, posted
          ? { method: "POST", headers: { "content-type": "application/json", origin }, body: "{}" }
          : {}), `anonymous ${path}`);
      }
      if (posted && path !== "/bff/auth/logout") {
        await check(await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "text/plain", origin, cookie },
          body: "{}"
        }), `media type ${path}`);
        await check(await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin, cookie },
          body: JSON.stringify({ padding: "x".repeat(8_192) })
        }), `oversized ${path}`);
      }
    }
    await check(await fetch(`${baseUrl}/bff/auth/login`), "login without OIDC");
    await check(await fetch(`${baseUrl}/bff/auth/callback?code=x&state=y`), "callback without OIDC");
    await check(await fetch(`${oidcUrl}/bff/auth/callback?code=x&state=y`), "rejected callback");
    await check(await postJson("/bff/auth/dev-session", { role: "root" }), "unsupported role");
    await check(await fetch(`${baseUrl}/bff/metrics`, { headers: { "x-forwarded-for": "198.51.100.7" } }), "forwarded metrics");
    await check(await fetch(`${baseUrl}/bff/api/reports`, { headers: { cookie, "sec-fetch-site": "cross-site" } }), "cross-site report");
    await check(await fetch(`${baseUrl}/bff/unknown`), "unknown route");
    const verified = await challenge(cookie);
    const verification = { commandDigest: verified.commandDigest, code: verified.code };
    assert.equal((await postJson(verified.path, verification, cookie)).status, 200);
    await check(await postJson(verified.path, verification, cookie), "replayed step-up");
    for (const [label, error] of [["unavailable", new AuditStoreError("synthetic")], ["failed", new Error("synthetic")]] as const) {
      const broken = createBackofficeServer(config(), failingAuditStore(error));
      const brokenUrl = await listen(broken);
      try {
        await check(await fetch(`${brokenUrl}/bff/healthz`), `audit ${label}`);
      } finally {
        await close(broken);
      }
    }
    for (const status of [400, 401, 403, 404, 405, 409, 415, 500, 503]) {
      assert.ok(statuses.has(status), String(status));
    }
  });

  it("keeps the frozen JSON header set on Node's own parser and Expect rejections", async () => {
    await assertRawRejections(Number(new URL(baseUrl).port), apiSecurityHeaders, "BFF");
  });
});

describe("Backoffice Vite document security headers", () => {
  it("serves dev HTML and modules with the dev-only header set", async () => {
    const vite = await createViteServer({
      root: backofficeRoot,
      configFile: `${backofficeRoot}vite.config.ts`,
      logLevel: "silent",
      server: { port: await freePort(), strictPort: true },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
    try {
      await vite.listen();
      const { port } = vite.httpServer?.address() as AddressInfo;
      for (const path of ["/", "/src/main.tsx"]) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: "text/html" } });
        await response.arrayBuffer();
        assert.equal(response.status, 200, path);
        for (const [name, value] of Object.entries(devDocumentSecurityHeaders)) {
          assert.equal(response.headers.get(name), value, `${path}: ${name}`);
        }
      }
    } finally {
      await vite.close();
    }
  });

  it("keeps the dev header set on Vite's own 403, 404, 500, preflight and raw rejections", async () => {
    const vite = await createViteServer({
      root: backofficeRoot,
      configFile: `${backofficeRoot}vite.config.ts`,
      logLevel: "silent",
      server: { port: await freePort(), strictPort: true, proxy: { "/bff": { target: `http://127.0.0.1:${await freePort()}` } } },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
    try {
      await vite.listen();
      const { port } = vite.httpServer?.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;
      const responses: [number, Response][] = [
        [403, await fetch(`${base}/@fs/etc/passwd`)],
        [404, await fetch(`${base}/`, { method: "POST" })],
        [204, await fetch(`${base}/`, { method: "OPTIONS", headers: { "access-control-request-method": "POST" } })],
        [500, await fetch(`${base}/bff/health`)]
      ];
      for (const [status, response] of responses) {
        await response.arrayBuffer();
        assert.equal(response.status, status);
        for (const [name, value] of Object.entries(devDocumentSecurityHeaders)) {
          assert.equal(response.headers.get(name), value, `${status}: ${name}`);
        }
      }
      await assertRawRejections(port, devDocumentSecurityHeaders, "Vite dev");
    } finally {
      await vite.close();
    }
  });

  it("keeps the preview CSP strict and serves the built document with it", async () => {
    const configFile = `${backofficeRoot}vite.config.ts`;
    const resolved = await resolveConfig({ root: backofficeRoot, configFile, logLevel: "silent" }, "serve", "production", "production", true);
    assert.deepEqual(resolved.preview.headers, { ...documentSecurityHeaders });
    assertStrictDocumentCsp(String(resolved.preview.headers?.["content-security-policy"]));

    const outDir = mkdtempSync(join(tmpdir(), "backoffice-csp-"));
    try {
      await build({ root: backofficeRoot, configFile, logLevel: "silent", build: { outDir, emptyOutDir: true } });
      const html = readFileSync(join(outDir, "index.html"), "utf8");
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      assert.ok(scripts.length > 0);
      for (const [, attributes, body] of scripts) {
        assert.match(attributes, /\bsrc="\/assets\/[^"]+\.js"/);
        assert.equal(body.trim(), "");
      }
      assert.equal(/<style\b|\sstyle=/.test(html), false);
      const server = await preview({
        root: backofficeRoot,
        configFile,
        logLevel: "silent",
        build: { outDir },
        preview: { port: await freePort(), strictPort: true, open: false }
      });
      try {
        const { port } = server.httpServer.address() as AddressInfo;
        const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
        assert.ok(asset);
        for (const path of ["/", asset]) {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: "text/html" } });
          await response.arrayBuffer();
          assert.equal(response.status, 200, path);
          for (const [name, value] of Object.entries(documentSecurityHeaders)) {
            assert.equal(response.headers.get(name), value, `${path}: ${name}`);
          }
        }
        const base = `http://127.0.0.1:${port}`;
        const fallbacks: [number, Response][] = [
          [404, await fetch(`${base}/`, { method: "POST" })],
          [204, await fetch(`${base}/`, { method: "OPTIONS" })]
        ];
        for (const [status, response] of fallbacks) {
          await response.arrayBuffer();
          assert.equal(response.status, status);
          for (const [name, value] of Object.entries(documentSecurityHeaders)) {
            assert.equal(response.headers.get(name), value, `preview ${status}: ${name}`);
          }
        }
        await assertRawRejections(port, documentSecurityHeaders, "preview");
      } finally {
        await server.close();
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("index.html loads no inline or third-party script so the strict script-src holds", () => {
    const html = readFileSync(`${backofficeRoot}index.html`, "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.deepEqual(scripts.map(([, attributes]) => /\bsrc="([^"]*)"/.exec(attributes)?.[1]), ["/src/main.tsx"]);
    assert.equal(scripts[0][2].trim(), "");
  });
});
