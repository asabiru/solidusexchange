import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { build, createServer as createViteServer, preview, resolveConfig } from "vite";
import type { CustomerApiAccess } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import {
  apiCspDirectives,
  apiSecurityHeaders,
  devDocumentCspDirectives,
  devDocumentSecurityHeaders,
  documentCspDirectives,
  documentSecurityHeaders,
  serializeCsp,
  telegramFrameAncestors
} from "./security-headers.js";
import { createMiniappServer, routeTable, sessionCookie } from "./server.js";

const miniappRoot = fileURLToPath(new URL("../../", import.meta.url));
const syntheticToken = "100000001:" + "SyntheticDevTokenForTestsOnly_0000";
const origin = "http://127.0.0.1:4183";
const now = 1_790_000_000_000;

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

interface Running {
  port: number;
  close: () => Promise<void>;
}

function send(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers = options.body === undefined
      ? options.headers
      : { "content-length": String(Buffer.byteLength(options.body)), ...options.headers };
    const request = httpRequest({ host: "127.0.0.1", port, method, path, headers, agent: false }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.on("error", reject);
    request.end(options.body);
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

function postJson(port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return send(port, "POST", path, {
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body)
  });
}

function cookieOf(reply: Reply): string {
  const [cookie] = reply.headers["set-cookie"] ?? [];
  assert.ok(cookie?.startsWith(`${sessionCookie}=`));
  return cookie.split(";")[0];
}

function assertApiHeaders(reply: Reply, label: string): void {
  for (const [name, value] of Object.entries(apiSecurityHeaders)) {
    assert.equal(reply.headers[name], value, `${label}: ${name}`);
  }
  assert.match(reply.headers["content-type"] ?? "", /; charset=utf-8$/, label);
}

function parseCsp(header: string): Map<string, string[]> {
  return new Map(header.split(";").map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }));
}

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function tonTestnetAddress(fill: number): string {
  const bytes = Buffer.alloc(36);
  bytes[0] = 0x91;
  for (let index = 2; index < 34; index += 1) bytes[index] = (fill * 13 + index * 3) & 0xff;
  bytes.writeUInt16BE(crc16(bytes.subarray(0, 34)), 34);
  return bytes.toString("base64url");
}

const schemeOnlySource = /^[a-z][a-z0-9+.-]*:$/;

function assertStrictDocumentCsp(header: string): void {
  const csp = parseCsp(header);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("script-src"), ["'self'"]);
  assert.deepEqual(csp.get("style-src"), ["'self'"]);
  assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  assert.deepEqual(csp.get("img-src"), ["'self'", "data:"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'none'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["https://web.telegram.org", "https://*.telegram.org"]);
  for (const [name, sources] of csp) {
    for (const source of sources) {
      assert.notEqual(source, "'unsafe-eval'", name);
      assert.notEqual(source, "'unsafe-inline'", name);
      assert.notEqual(source, "*", name);
      if (schemeOnlySource.test(source)) assert.equal(`${name} ${source}`, "img-src data:");
      if (source.includes("*")) assert.equal(`${name} ${source}`, "frame-ancestors https://*.telegram.org");
    }
  }
}

describe("Mini App security header sets", () => {
  it("are frozen and deny framing, sniffing, caching and powerful features for JSON", () => {
    for (const set of [apiSecurityHeaders, documentSecurityHeaders, devDocumentSecurityHeaders]) {
      assert.ok(Object.isFrozen(set));
    }
    for (const directives of [apiCspDirectives, documentCspDirectives, devDocumentCspDirectives]) {
      assert.ok(Object.isFrozen(directives));
      for (const sources of Object.values(directives)) assert.ok(Object.isFrozen(sources));
    }
    assert.ok(Object.isFrozen(telegramFrameAncestors));
    assert.equal(apiSecurityHeaders["content-security-policy"], "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    assert.equal(apiSecurityHeaders["x-frame-options"], "DENY");
    assert.equal(apiSecurityHeaders["cache-control"], "no-store");
    assert.equal(apiSecurityHeaders["referrer-policy"], "no-referrer");
    assert.equal(apiSecurityHeaders["cross-origin-resource-policy"], "same-origin");
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      assert.ok(apiSecurityHeaders["permissions-policy"].split(", ").includes(`${feature}=()`), feature);
    }
  });

  it("let only Telegram frame the HTML document, never via X-Frame-Options", () => {
    assertStrictDocumentCsp(documentSecurityHeaders["content-security-policy"]);
    assert.equal(documentSecurityHeaders["x-frame-options"], undefined);
    assert.equal(documentSecurityHeaders["permissions-policy"], apiSecurityHeaders["permissions-policy"]);
    assert.equal(documentSecurityHeaders["x-content-type-options"], "nosniff");
  });

  it("relax only script, style and HMR connect sources in Vite dev, never unsafe-eval", () => {
    const changed = Object.keys(devDocumentCspDirectives).filter((name) =>
      serializeCsp({ [name]: devDocumentCspDirectives[name] }) !== serializeCsp({ [name]: documentCspDirectives[name] ?? [] })
    );
    assert.deepEqual(changed, ["script-src", "style-src", "connect-src"]);
    assert.deepEqual(devDocumentCspDirectives["script-src"], ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(devDocumentCspDirectives["style-src"], ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(devDocumentCspDirectives["connect-src"], ["'self'", "ws://127.0.0.1:4183", "ws://localhost:4183"]);
    assert.equal(devDocumentSecurityHeaders["content-security-policy"].includes("'unsafe-eval'"), false);
    assert.equal(devDocumentSecurityHeaders["content-security-policy"].includes("*.telegram.org"), true);
  });
});

describe("Mini App BFF security headers on every route", () => {
  let running: Running;
  let unconfigured: Running;
  let customerApiFails = false;

  async function start(serverConfig: ServerConfig): Promise<Running> {
    const access: CustomerApiAccess = { status: "not-configured" };
    const server = createMiniappServer(serverConfig, {
      clock: () => now,
      customerApi: {
        configured: false,
        access: async () => {
          if (customerApiFails) throw new Error("synthetic customer-api failure");
          return access;
        }
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      port: (server.address() as AddressInfo).port,
      close: () => new Promise<void>((resolve) => server.close(() => resolve()))
    };
  }

  before(async () => {
    const base = loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true", MINIAPP_METRICS: "loopback" });
    running = await start({ ...base, telegramBotToken: syntheticToken });
    unconfigured = await start(base);
  });

  after(async () => {
    await running.close();
    await unconfigured.close();
  });

  async function devLogin(kyc: string): Promise<string> {
    const reply = await postJson(running.port, "/bff/auth/dev-session", { kyc });
    assert.equal(reply.status, 201);
    return cookieOf(reply);
  }

  function telegramInitData(): string {
    return signInitData(new Map([
      ["auth_date", String(Math.floor(now / 1_000) - 5)],
      ["user", JSON.stringify({ id: 77, first_name: "Synthetic" })]
    ]), syntheticToken);
  }

  it("sends the frozen JSON header set on each route's success path", async () => {
    const { port } = running;
    const verified = await devLogin("verified");
    const gated = await devLogin("kyc-gated");
    const get = (path: string, cookie = verified) => send(port, "GET", path, { headers: { cookie } });
    const screening = { asset: "TON", network: "TON_TESTNET", address: tonTestnetAddress(1) };
    const successes: Record<string, () => Promise<Reply>> = {
      "GET /bff/health": () => send(port, "GET", "/bff/health"),
      "GET /bff/session": () => get("/bff/session"),
      "POST /bff/session/telegram": () => postJson(port, "/bff/session/telegram", { initData: telegramInitData() }),
      "POST /bff/auth/dev-session": () => postJson(port, "/bff/auth/dev-session", { kyc: "verified" }),
      "POST /bff/auth/logout": async () => postJson(port, "/bff/auth/logout", {}, { cookie: await devLogin("verified") }),
      "GET /bff/wallet": () => get("/bff/wallet"),
      "GET /bff/operations": () => get("/bff/operations"),
      "GET /bff/operations/:id": async () => {
        const list = JSON.parse((await get("/bff/operations")).body) as { operations: { id: string }[] };
        return get(`/bff/operations/${list.operations[0].id}`);
      },
      "GET /bff/profile": () => get("/bff/profile"),
      "GET /bff/quotes/preview": () => get("/bff/quotes/preview?from=RUB&to=USDT&amount=1000"),
      "POST /bff/kyc/applications": () => postJson(port, "/bff/kyc/applications", {}, { cookie: gated }),
      "POST /bff/address-screening": () => postJson(port, "/bff/address-screening", screening, { cookie: verified }),
      "GET /bff/address-screening/:id": async () => {
        const created = JSON.parse((await postJson(port, "/bff/address-screening", screening, { cookie: verified })).body) as { id: string };
        return get(`/bff/address-screening/${created.id}`);
      },
      "GET /bff/kyc/status": () => get("/bff/kyc/status"),
      "GET /bff/notifications": () => get("/bff/notifications"),
      "GET /bff/activity": () => get("/bff/activity"),
      "POST /bff/notifications/read": async () => {
        const inbox = JSON.parse((await get("/bff/notifications")).body) as { notifications: { id: string }[] };
        return postJson(port, "/bff/notifications/read", { ids: inbox.notifications[0].id }, { cookie: verified });
      },
      "GET /bff/metrics": () => send(port, "GET", "/bff/metrics")
    };
    assert.deepEqual(Object.keys(successes).sort(), routeTable.map((route) => `${route.method} ${route.path}`).sort());
    for (const [route, run] of Object.entries(successes)) {
      const reply = await run();
      assert.ok(reply.status >= 200 && reply.status < 300, `${route} -> ${reply.status} ${reply.body}`);
      assertApiHeaders(reply, route);
    }
  });

  it("sends the frozen JSON header set on each route's error paths", async () => {
    const { port } = running;
    const statuses = new Set<number>();
    const check = (reply: Reply, label: string) => {
      assert.ok(reply.status >= 400, `${label} -> ${reply.status}`);
      statuses.add(reply.status);
      assertApiHeaders(reply, label);
    };
    for (const route of routeTable) {
      const path = route.path.replace(":id", "unknown");
      check(await send(port, route.method, path, { headers: { host: "bff.example.test" } }), `${route.method} ${path} host`);
      const flipped = route.method === "GET" ? "POST" : "GET";
      check(await send(port, flipped, path), `${flipped} ${path}`);
      if (route.path !== "/bff/health" && route.path !== "/bff/metrics") {
        check(await send(port, route.method, path, { headers: { "content-type": "application/json" }, body: "{}" }), `${route.method} ${path} anonymous`);
      }
    }
    const verified = await devLogin("verified");
    check(await send(port, "PUT", "/bff/session"), "PUT");
    check(await postJson(port, "/bff/kyc/applications", {}, { cookie: verified }), "kyc already verified");
    check(await send(port, "POST", "/bff/notifications/read", {
      headers: { "content-type": "text/plain", origin, cookie: verified },
      body: "{}"
    }), "unsupported media type");
    check(await postJson(port, "/bff/auth/dev-session", { kyc: "x".repeat(8_192) }), "oversized body");
    check(await send(port, "GET", "/bff/metrics", { headers: { "x-forwarded-for": "198.51.100.7" } }), "forwarded metrics");
    check(await postJson(unconfigured.port, "/bff/session/telegram", { initData: "a=1" }), "telegram not configured");
    customerApiFails = true;
    try {
      check(await send(port, "GET", "/bff/profile", { headers: { cookie: verified } }), "internal error");
    } finally {
      customerApiFails = false;
    }
    const limited = await devLogin("verified");
    let last: Reply | undefined;
    for (let fill = 0; fill < 25 && last?.status !== 429; fill += 1) {
      const address = tonTestnetAddress(fill + 10);
      last = await postJson(port, "/bff/address-screening", { asset: "TON", network: "TON_TESTNET", address }, { cookie: limited });
    }
    assert.ok(last);
    check(last, "screening rate limit");
    for (const status of [400, 401, 403, 404, 405, 409, 415, 421, 429, 500, 503]) {
      assert.ok(statuses.has(status), String(status));
    }
  });
});

describe("Mini App Vite document security headers", () => {
  it("serves dev HTML and modules with the dev-only header set", async () => {
    const vite = await createViteServer({
      root: miniappRoot,
      configFile: `${miniappRoot}vite.config.ts`,
      logLevel: "silent",
      server: { port: await freePort(), strictPort: true },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
    try {
      await vite.listen();
      const { port } = vite.httpServer?.address() as AddressInfo;
      for (const path of ["/", "/src/main.tsx"]) {
        const reply = await send(port, "GET", path, { headers: { accept: "text/html" } });
        assert.equal(reply.status, 200, path);
        for (const [name, value] of Object.entries(devDocumentSecurityHeaders)) {
          assert.equal(reply.headers[name], value, `${path}: ${name}`);
        }
      }
    } finally {
      await vite.close();
    }
  });

  it("keeps the preview CSP strict and serves the built document with it", async () => {
    const configFile = `${miniappRoot}vite.config.ts`;
    const resolved = await resolveConfig({ root: miniappRoot, configFile, logLevel: "silent" }, "serve", "production", "production", true);
    assert.deepEqual(resolved.preview.headers, { ...documentSecurityHeaders });
    assertStrictDocumentCsp(String(resolved.preview.headers?.["content-security-policy"]));

    const outDir = join(tmpdir(), `miniapp-csp-${process.pid}`);
    try {
      await build({ root: miniappRoot, configFile, logLevel: "silent", build: { outDir, emptyOutDir: true } });
      const html = readFileSync(join(outDir, "index.html"), "utf8");
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      assert.ok(scripts.length > 0);
      for (const [, attributes, body] of scripts) {
        assert.match(attributes, /\bsrc="\/assets\/[^"]+\.js"/);
        assert.equal(body.trim(), "");
      }
      assert.equal(/<style\b|\sstyle=/.test(html), false);
      const server = await preview({
        root: miniappRoot,
        configFile,
        logLevel: "silent",
        build: { outDir },
        preview: { port: 0, strictPort: false, open: false }
      });
      try {
        const { port } = server.httpServer.address() as AddressInfo;
        const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
        assert.ok(asset);
        for (const path of ["/", asset]) {
          const reply = await send(port, "GET", path, { headers: { accept: "text/html" } });
          assert.equal(reply.status, 200, path);
          for (const [name, value] of Object.entries(documentSecurityHeaders)) {
            assert.equal(reply.headers[name], value, `${path}: ${name}`);
          }
          assert.equal(reply.headers["x-frame-options"], undefined, path);
        }
      } finally {
        await server.close();
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("index.html loads no inline or third-party script so the strict script-src holds", () => {
    const html = readFileSync(`${miniappRoot}index.html`, "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.deepEqual(scripts.map(([, attributes]) => attributes.trim()), ['type="module" src="/src/main.tsx"']);
    assert.equal(scripts[0][2].trim(), "");
    assert.equal(html.includes("telegram.org"), false);
  });
});
