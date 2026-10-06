import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { type IncomingMessage, request as httpRequest, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { signInitData } from "./init-data.js";
import { createRequestObserver, durationBucketsSeconds } from "./observability.js";
import { createMiniappServer, routeTable } from "./server.js";

const origin = "http://127.0.0.1:4183";
const syntheticToken = "100000001:" + "SyntheticObservabilityToken_000000";
const bearer = "SyntheticBearerObservability0000000000";
const address = "kQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RCIT";
const querySecret = "SyntheticQuerySecret000000";
const clientRequestId = "client-supplied-request-id-000000";
const now = 1_790_000_000_000;
const templates = new Set([...routeTable.map((route) => route.path), "unmatched"]);
const logKeys = ["duration_ms", "method", "request_id", "route", "service", "status", "ts"];

function config(env: Record<string, string> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true", ...env }),
    telegramBotToken: syntheticToken
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
  const server = createMiniappServer(serverConfig, {
    clock: () => now,
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
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
    const outgoing = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

describe("Mini App BFF observability config", () => {
  it("is off by default and accepts only explicit dev values", () => {
    assert.deepEqual(loadServerConfig({}).observability, { log: "off", metrics: "off" });
    assert.deepEqual(
      loadServerConfig({ MINIAPP_LOG: "json", MINIAPP_METRICS: "loopback" }).observability,
      { log: "json", metrics: "loopback" }
    );
    for (const value of ["JSON", "true", "1", "text", "debug"]) {
      assert.throws(() => loadServerConfig({ MINIAPP_LOG: value }), /MINIAPP_LOG/, value);
    }
    for (const value of ["on", "true", "public", "0.0.0.0"]) {
      assert.throws(() => loadServerConfig({ MINIAPP_METRICS: value }), /MINIAPP_METRICS/, value);
    }
  });
});

describe("Mini App BFF observability disabled by default", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("returns 404 for metrics and writes no log lines", async () => {
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await fetch(`${running.base}/bff/metrics`, { method, headers: { origin } });
      assert.equal(response.status, 404, method);
      assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f]{32}$/);
    }
    assert.equal((await fetch(`${running.base}/bff/health`)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(running.lines, []);
  });
});

describe("Mini App BFF observability enabled", () => {
  let running: Running;
  before(async () => {
    running = await start(config({ MINIAPP_LOG: "json", MINIAPP_METRICS: "loopback" }));
  });
  after(async () => {
    await running.close();
  });

  it("generates request ids server-side and ignores client values", async () => {
    const first = await fetch(`${running.base}/bff/health`, { headers: { "x-request-id": clientRequestId } });
    const second = await fetch(`${running.base}/bff/health`, { headers: { "x-request-id": clientRequestId } });
    const ids = [first.headers.get("x-request-id"), second.headers.get("x-request-id")];
    for (const id of ids) assert.match(id ?? "", /^[0-9a-f]{32}$/);
    assert.notEqual(ids[0], ids[1]);
    await logged(running, 2);
    assert.deepEqual(running.lines.map((line) => JSON.parse(line).request_id), ids);
    assert.ok(!running.lines.join("\n").includes(clientRequestId));
  });

  it("never logs or exports tokens, initData, cookies, addresses, query strings or IPs", async () => {
    const start = running.lines.length;
    const initData = signInitData(new Map([
      ["auth_date", String(Math.floor(now / 1_000) - 5)],
      ["user", JSON.stringify({ id: 900_000_123, first_name: "SyntheticObservabilityUser" })]
    ]), syntheticToken);
    const telegram = await fetch(`${running.base}/bff/session/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ initData })
    });
    assert.equal(telegram.status, 201);
    const cookie = (telegram.headers.get("set-cookie") ?? "").split(";")[0];
    const cookieValue = cookie.split("=")[1];
    assert.ok(cookieValue);
    const screening = await fetch(`${running.base}/bff/address-screening?token=${querySecret}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie },
      body: JSON.stringify({ asset: "TON", network: "TON_TESTNET", address })
    });
    const session = await fetch(`${running.base}/bff/session?initData=${encodeURIComponent(initData)}`, {
      headers: { cookie, authorization: `Bearer ${bearer}`, "x-telegram-init-data": initData }
    });
    assert.equal(session.status, 200);
    const unknown = await fetch(`${running.base}/bff/wallet/${address}?address=${address}&token=${querySecret}`, {
      headers: { cookie }
    });
    assert.equal(unknown.status, 404);
    await logged(running, start + 4);

    const lines = running.lines.slice(start);
    const metrics = await scrape(running);
    const sensitive = [
      syntheticToken, bearer, initData, encodeURIComponent(initData), "SyntheticObservabilityUser", "900000123",
      cookieValue, address, querySecret, "token=", "?", "127.0.0.1", "::1", "telegram:"
    ];
    for (const value of sensitive) {
      for (const line of lines) assert.ok(!line.includes(value), `${value} leaked into log: ${line}`);
      assert.ok(!metrics.includes(value), `${value} leaked into metrics`);
    }
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      assert.deepEqual(Object.keys(parsed).sort(), logKeys);
      assert.equal(parsed.service, "miniapp-bff");
      assert.ok(templates.has(String(parsed.route)), String(parsed.route));
    }
    assert.deepEqual(lines.map((line) => JSON.parse(line).route), [
      "/bff/session/telegram",
      "/bff/address-screening",
      "/bff/session",
      "unmatched"
    ]);
    assert.equal(JSON.parse(lines[1]).status, screening.status);
    assert.match(metrics, /^solidchange_miniapp_sessions_active\{service="miniapp-bff"\} 1$/m);
    assert.match(metrics, /^solidchange_miniapp_notification_drafts\{service="miniapp-bff"\} \d+$/m);
    assert.match(metrics, /^solidchange_miniapp_address_screenings\{service="miniapp-bff"\} \d+$/m);
  });

  it("bounds route labels to the frozen route table under random paths", async () => {
    for (let index = 0; index < 60; index += 1) {
      const random = randomBytes(8).toString("hex");
      const paths = [`/bff/${random}`, `/${random}/x?${random}=1`, `/bff/operations/${random}`, `/bff/health/${random}`];
      for (const path of paths) await fetch(`${running.base}${path}`);
    }
    const metrics = await scrape(running);
    for (const label of routeLabels(metrics)) assert.ok(templates.has(label), label);
    assert.ok(routeLabels(metrics).has("unmatched"));
    assert.ok(routeLabels(metrics).has("/bff/operations/:id"));
    const series = metrics.split("\n").filter((line) => line.startsWith("solidchange_http_requests_total{"));
    assert.ok(series.length <= templates.size * 8 * 6, String(series.length));
    assert.ok(!/[0-9a-f]{16}/.test(metrics.replace(/solidchange_[a-z_]+/g, "")));
  });

  it("counts requests and records fixed-bucket durations", async () => {
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await fetch(`${running.base}/bff/kyc/status`)).status, 401);
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (running.lines.filter((line) => JSON.parse(line).route === "/bff/kyc/status").length === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const metrics = await scrape(running);
    const labels = 'service="miniapp-bff",route="/bff/kyc/status",method="GET"';
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
    assert.notEqual(await rawGet(running.port, "/bff/metrics", { host: "metrics.example" }), 200);
    assert.equal((await fetch(`${running.base}/bff/metrics`, { headers: { "sec-fetch-site": "none" } })).status, 200);
  });
});

describe("request observer histogram", () => {
  function exchange(observer: ReturnType<typeof createRequestObserver>, method: string, url: string, status: number) {
    const response = Object.assign(new EventEmitter(), {
      statusCode: status,
      setHeader: () => undefined
    });
    observer.observe({ method, url } as unknown as IncomingMessage, response as unknown as ServerResponse);
    response.emit("finish");
    response.emit("close");
  }

  it("places each duration in cumulative buckets and labels unknown methods OTHER", async () => {
    const durations = [0, 4, 0, 30, 0, 3_000, 0, 9_000];
    const lines: string[] = [];
    const observer = createRequestObserver({
      service: "test",
      routes: ["/a/:id"],
      config: { log: "json", metrics: "loopback" },
      sink: (line) => lines.push(line),
      timer: () => durations.shift() ?? 0,
      wallClock: () => now
    });
    exchange(observer, "GET", "/a/1", 200);
    exchange(observer, "GET", "/a/2?x=y", 200);
    exchange(observer, "GET", "/a/3", 503);
    exchange(observer, "BREW", "/a/4/b", 418);
    const metrics = await observer.renderMetrics([{ name: "test_gauge", help: "Test.", value: () => 7 }]);
    const labels = 'service="test",route="/a/:id",method="GET"';
    const expected: Record<string, number> = {
      "0.005": 1, "0.01": 1, "0.025": 1, "0.05": 2, "0.1": 2, "0.25": 2, "0.5": 2, "1": 2, "2.5": 2, "5": 3
    };
    for (const bound of durationBucketsSeconds) {
      assert.ok(metrics.includes(`_bucket{${labels},le="${bound}"} ${expected[String(bound)]}\n`), String(bound));
    }
    assert.ok(metrics.includes(`_sum{${labels}} 3.034\n`));
    assert.ok(metrics.includes(`_count{${labels}} 3\n`));
    assert.ok(metrics.includes(`solidchange_http_requests_total{${labels},status_class="2xx"} 2\n`));
    assert.ok(metrics.includes(`solidchange_http_requests_total{${labels},status_class="5xx"} 1\n`));
    assert.ok(metrics.includes('solidchange_http_requests_total{service="test",route="unmatched",method="OTHER",status_class="4xx"} 1\n'));
    assert.ok(metrics.includes('test_gauge{service="test"} 7\n'));
    assert.equal(lines.length, 4);
    assert.deepEqual(JSON.parse(lines[0]), {
      ts: new Date(now).toISOString(),
      service: "test",
      method: "GET",
      route: "/a/:id",
      status: 200,
      duration_ms: 4,
      request_id: JSON.parse(lines[0]).request_id
    });
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
