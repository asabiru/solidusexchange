import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type IncomingMessage, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { durationBucketsSeconds } from "./observability.js";
import { createBackofficeServer, routeTemplates } from "./server.js";

const origin = "http://127.0.0.1:4173";
const bearer = "SyntheticOperatorBearer000000000000";
const querySecret = "SyntheticQuerySecret000000";
const providerReference = "prov_ref_synthetic_000000000001";
const syntheticAddress = "TJD46Huff79KfsBbvCHF55qYvA6HDpjpwB";
const clientRequestId = "client-supplied-request-id-000000";
const templates = new Set([...routeTemplates, "unmatched"]);
const logKeys = ["duration_ms", "method", "request_id", "route", "service", "status", "ts"];

function config(observability?: ServerConfig["observability"]): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [origin],
    allowDevLogin: true,
    sessionTtlSeconds: 900,
    audit: { storage: "memory", retentionDays: 30 },
    stepUp: { provider: "synthetic-dev", challengeTtlSeconds: 300, grantTtlSeconds: 60, maxAttempts: 3 },
    signing: { backend: "ephemeral-dev", rotationSeconds: 900, retainedVerificationKeys: 2 },
    observability
  };
}

interface Running {
  base: string;
  port: number;
  lines: string[];
  close: () => Promise<void>;
}

async function start(serverConfig: ServerConfig): Promise<Running> {
  const lines: string[] = [];
  let tick = 0;
  const server: Server = createBackofficeServer(serverConfig, undefined, undefined, {
    logSink: (line) => lines.push(line),
    timer: () => {
      tick += 30;
      return tick;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    lines,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function logged(running: Running, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && running.lines.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(running.lines.length, count);
}

async function scrape(running: Running): Promise<string> {
  const response = await fetch(`${running.base}/bff/metrics`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.text();
}

function routeLabels(metrics: string): Set<string> {
  return new Set([...metrics.matchAll(/route="([^"]*)"/g)].map((match) => match[1]));
}

function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers }, (response: IncomingMessage) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function withEnv<T>(values: Record<string, string>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("backoffice BFF observability config", () => {
  it("is off by default and accepts only explicit dev values", () => {
    assert.deepEqual(withEnv({}, () => loadServerConfig().observability), { log: "off", metrics: "off" });
    assert.deepEqual(
      withEnv({ BACKOFFICE_LOG: "json", BACKOFFICE_METRICS: "loopback" }, () => loadServerConfig().observability),
      { log: "json", metrics: "loopback" }
    );
    for (const value of ["JSON", "true", "1", "text"]) {
      assert.throws(() => withEnv({ BACKOFFICE_LOG: value }, () => loadServerConfig()), /BACKOFFICE_LOG/, value);
    }
    for (const value of ["on", "true", "public"]) {
      assert.throws(() => withEnv({ BACKOFFICE_METRICS: value }, () => loadServerConfig()), /BACKOFFICE_METRICS/, value);
    }
  });
});

describe("backoffice BFF observability disabled by default", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("returns 404 for metrics and writes no log lines", async () => {
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await fetch(`${running.base}/bff/metrics`, { method });
      assert.equal(response.status, 404, method);
      assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f]{32}$/);
    }
    assert.equal((await fetch(`${running.base}/bff/healthz`)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(running.lines, []);
  });
});

describe("backoffice BFF observability enabled", () => {
  let running: Running;
  before(async () => {
    running = await start(config({ log: "json", metrics: "loopback" }));
  });
  after(async () => {
    await running.close();
  });

  it("generates request ids server-side and ignores client values", async () => {
    const first = await fetch(`${running.base}/bff/healthz`, { headers: { "x-request-id": clientRequestId } });
    const second = await fetch(`${running.base}/bff/healthz`, { headers: { "x-request-id": clientRequestId } });
    const ids = [first.headers.get("x-request-id"), second.headers.get("x-request-id")];
    for (const id of ids) assert.match(id ?? "", /^[0-9a-f]{32}$/);
    assert.notEqual(ids[0], ids[1]);
    await logged(running, 2);
    assert.deepEqual(running.lines.map((line) => JSON.parse(line).request_id), ids);
    assert.ok(!running.lines.join("\n").includes(clientRequestId));
  });

  it("never logs or exports tokens, cookies, references, addresses, query strings or IPs", async () => {
    const start = running.lines.length;
    const login = await fetch(`${running.base}/bff/auth/dev-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        authorization: `Bearer ${bearer}`,
        "x-synthetic-address": syntheticAddress
      },
      body: JSON.stringify({ role: "compliance-lead" })
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const cookieValue = cookie.split("=")[1];
    assert.ok(cookieValue);
    const dashboard = await fetch(`${running.base}/bff/api/dashboard?token=${querySecret}&ref=${providerReference}`, {
      headers: { cookie, authorization: `Bearer ${bearer}` }
    });
    assert.equal(dashboard.status, 200);
    const preview = await fetch(`${running.base}/bff/api/approvals/${providerReference}/preview?address=${syntheticAddress}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ reference: providerReference, address: syntheticAddress })
    });
    const report = await fetch(`${running.base}/bff/api/reports/${syntheticAddress}/export`, { headers: { cookie } });
    const unknown = await fetch(`${running.base}/bff/api/${providerReference}?token=${querySecret}`, { headers: { cookie } });
    assert.equal(unknown.status, 404);
    await logged(running, start + 5);

    const lines = running.lines.slice(start);
    const metrics = await scrape(running);
    for (const value of [bearer, cookieValue, querySecret, providerReference, syntheticAddress, "token=", "?", "127.0.0.1", "::1"]) {
      for (const line of lines) assert.ok(!line.includes(value), `${value} leaked into log: ${line}`);
      assert.ok(!metrics.includes(value), `${value} leaked into metrics`);
    }
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      assert.deepEqual(Object.keys(parsed).sort(), logKeys);
      assert.equal(parsed.service, "backoffice-bff");
      assert.ok(templates.has(String(parsed.route)), String(parsed.route));
    }
    assert.deepEqual(lines.map((line) => JSON.parse(line).route), [
      "/bff/auth/dev-session",
      "/bff/api/dashboard",
      "/bff/api/approvals/:approvalId/preview",
      "/bff/api/reports/:reportId/export",
      "unmatched"
    ]);
    assert.equal(JSON.parse(lines[2]).status, preview.status);
    assert.equal(JSON.parse(lines[3]).status, report.status);
    assert.match(metrics, /^solidchange_backoffice_sessions_active\{service="backoffice-bff"\} 1$/m);
    const audit = metrics.match(/^solidchange_backoffice_audit_events\{service="backoffice-bff"\} (\d+)$/m);
    assert.ok(audit && Number(audit[1]) > 0);
  });

  it("bounds route labels to the frozen route table under random paths", async () => {
    for (let index = 0; index < 60; index += 1) {
      const random = randomBytes(8).toString("hex");
      const paths = [`/bff/${random}`, `/${random}/x?${random}=1`, `/bff/api/reports/${random}`, `/bff/healthz/${random}`];
      for (const path of paths) await fetch(`${running.base}${path}`);
    }
    const metrics = await scrape(running);
    for (const label of routeLabels(metrics)) assert.ok(templates.has(label), label);
    assert.ok(routeLabels(metrics).has("unmatched"));
    assert.ok(routeLabels(metrics).has("/bff/api/reports/:reportId"));
    const series = metrics.split("\n").filter((line) => line.startsWith("solidchange_http_requests_total{"));
    assert.ok(series.length <= templates.size * 8 * 6, String(series.length));
    assert.ok(!/[0-9a-f]{16}/.test(metrics.replace(/solidchange_[a-z_]+/g, "")));
  });

  it("counts requests and records fixed-bucket durations", async () => {
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await fetch(`${running.base}/bff/api/kyc`)).status, 401);
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (running.lines.filter((line) => JSON.parse(line).route === "/bff/api/kyc").length === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const metrics = await scrape(running);
    const labels = 'service="backoffice-bff",route="/bff/api/kyc",method="GET"';
    assert.match(metrics, new RegExp(`^solidchange_http_requests_total\\{${labels},status_class="4xx"\\} 3$`, "m"));
    for (const bound of durationBucketsSeconds) {
      const expected = bound >= 0.03 ? 3 : 0;
      assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${expected}\n`), String(bound));
    }
    assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_bucket{${labels},le="+Inf"} 3\n`));
    assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_sum{${labels}} 0.09\n`));
    assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_count{${labels}} 3\n`));
  });

  it("is GET-only and refuses browser, proxied and non-loopback-host requests", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await fetch(`${running.base}/bff/metrics`, { method });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), "GET");
    }
    const rejected: Record<string, string>[] = [
      { origin },
      { "x-forwarded-for": "203.0.113.7" },
      { forwarded: "for=203.0.113.7" },
      { via: "1.1 vite" },
      { "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "cross-site" }
    ];
    for (const headers of rejected) {
      assert.equal((await fetch(`${running.base}/bff/metrics`, { headers })).status, 404, JSON.stringify(headers));
    }
    assert.equal(await rawGet(running.port, "/bff/metrics", { host: "metrics.example" }), 404);
    assert.equal((await fetch(`${running.base}/bff/metrics`, { headers: { "sec-fetch-site": "none" } })).status, 200);
  });
});

describe("Vite dev proxy keeps metrics off the browser origin", () => {
  it("answers /bff/metrics with 404 without proxying", async () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const vite = await createViteServer({
      root,
      configFile: `${root}vite.config.ts`,
      logLevel: "silent",
      server: { port: 0, strictPort: false }
    });
    try {
      await vite.listen();
      const { port } = vite.httpServer?.address() as AddressInfo;
      for (const path of ["/bff/metrics", "/bff/metrics?format=text", "/bff/metrics/"]) {
        assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 404, path);
      }
    } finally {
      await vite.close();
    }
  });
});
