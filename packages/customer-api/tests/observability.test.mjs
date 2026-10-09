import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";

import { loadConfig } from "../src/config.mjs";
import { createRequestObserver, DURATION_BUCKETS_SECONDS } from "../src/observability.mjs";
import { startCustomerApi } from "../src/server.mjs";
import {
  customerHeaders,
  header,
  rawTranscript,
  REQUEST_ID,
  request,
  startTestServer,
  stopServer,
  SUBJECT,
  TEST_KEY,
  token
} from "./http-client.mjs";

const ROUTES = new Set(["/api/v1/meta", "/api/v1/customer/session", "/api/v1/customer/capabilities", "/api/v1/customer/wallets", "/api/v1/customer/notifications", "/metrics", "unmatched"]);
const LOG_KEYS = ["duration_ms", "method", "request_id", "route", "service", "status", "ts"];
const QUERY_SECRET = "SyntheticQuerySecret000000";
const ADDRESS = "kQBrcnmAh46VnKOqsbi_xs3U2-Lp8Pf-BQwTGiEoLzY9RCIT";

async function startObserved(observability = { log: "json", metrics: "loopback" }) {
  const lines = [];
  let tick = 0;
  const running = await startTestServer({
    observability,
    logSink: (line) => lines.push(line),
    timer: () => {
      tick += 30;
      return tick;
    }
  });
  return { ...running, lines };
}

async function logged(lines, count) {
  for (let attempt = 0; attempt < 200 && lines.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(lines.length, count);
}

async function scrape(port) {
  const response = await request(port, { path: "/metrics" });
  assert.equal(response.status, 200);
  assert.equal(header(response, "content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert.equal(header(response, "cache-control"), "no-store");
  return response.body;
}

function routeLabels(metrics) {
  return new Set([...metrics.matchAll(/route="([^"]*)"/gu)].map((match) => match[1]));
}

test("observability config is off by default and strictly validated", () => {
  const config = loadConfig({});
  assert.equal(config.log, "off");
  assert.equal(config.metrics, "off");
  const enabled = loadConfig({ CUSTOMER_API_LOG: "json", CUSTOMER_API_METRICS: "loopback" });
  assert.equal(enabled.log, "json");
  assert.equal(enabled.metrics, "loopback");
  for (const value of ["", "JSON", "true", "1", " json"]) {
    assert.throws(() => loadConfig({ CUSTOMER_API_LOG: value }), /CUSTOMER_API_LOG/u, JSON.stringify(value));
  }
  for (const value of ["", "on", "true", "public"]) {
    assert.throws(() => loadConfig({ CUSTOMER_API_METRICS: value }), /CUSTOMER_API_METRICS/u, JSON.stringify(value));
  }
});

test("metrics are disabled by default and logging stays silent", async () => {
  const lines = [];
  const { server, port } = await startTestServer({ logSink: (line) => lines.push(line) });
  try {
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await request(port, { method, path: "/metrics" });
      assert.equal(response.status, 404, method);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
    }
    assert.equal((await request(port, { path: "/api/v1/meta", headers: [["X-Request-Id", REQUEST_ID]] })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(lines, []);
  } finally {
    await stopServer(server);
  }
});

test("log request ids are server-generated and never the client value", async () => {
  const { server, port, lines } = await startObserved();
  try {
    const first = await request(port, { path: "/api/v1/meta", headers: [["X-Request-Id", REQUEST_ID]] });
    const second = await request(port, { path: "/api/v1/meta", headers: [["X-Request-Id", REQUEST_ID]] });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    await logged(lines, 2);
    const ids = lines.map((line) => JSON.parse(line).request_id);
    for (const id of ids) {
      assert.match(id, /^[0-9a-f]{32}$/u);
    }
    assert.notEqual(ids[0], ids[1]);
    assert.ok(!lines.join("\n").includes(REQUEST_ID));
  } finally {
    await stopServer(server);
  }
});

test("tokens, subjects, addresses, query strings and IPs never reach logs or metrics", async () => {
  const { server, port, lines } = await startObserved();
  try {
    const bearer = token();
    const session = await request(port, { path: "/api/v1/customer/session", headers: customerHeaders() });
    assert.equal(session.status, 200);
    assert.equal(JSON.parse(session.body).subject, SUBJECT);
    await request(port, {
      path: `/api/v1/customer/capabilities?token=${QUERY_SECRET}&address=${ADDRESS}`,
      headers: customerHeaders()
    });
    await request(port, { path: `/api/v1/customer/${ADDRESS}`, headers: customerHeaders() });
    await request(port, { path: "/api/v1/customer/session", headers: customerHeaders({ Authorization: `Bearer ${TEST_KEY}` }) });
    await logged(lines, 4);
    const metrics = await scrape(port);
    for (const value of [bearer, TEST_KEY, SUBJECT, REQUEST_ID, ADDRESS, QUERY_SECRET, "token=", "?", "127.0.0.1", "::1"]) {
      for (const line of lines) {
        assert.ok(!line.includes(value), `${value} leaked into log: ${line}`);
      }
      assert.ok(!metrics.includes(value), `${value} leaked into metrics`);
    }
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.deepEqual(Object.keys(parsed).sort(), LOG_KEYS);
      assert.equal(parsed.service, "customer-api");
    }
    assert.deepEqual(
      lines.slice(0, 4).map((line) => [JSON.parse(line).route, JSON.parse(line).status]),
      [["/api/v1/customer/session", 200], ["unmatched", 404], ["unmatched", 404], ["/api/v1/customer/session", 401]]
    );
  } finally {
    await stopServer(server);
  }
});

test("route labels stay bounded under random paths", async () => {
  const { server, port } = await startObserved();
  try {
    for (let index = 0; index < 60; index += 1) {
      const random = randomBytes(8).toString("hex");
      for (const path of [`/api/v1/${random}`, `/${random}?${random}=1`, `/metrics/${random}`, `/api/v1/meta/${random}`]) {
        await request(port, { path, headers: [["X-Request-Id", REQUEST_ID]] });
      }
    }
    await rawTranscript(port, "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    const metrics = await scrape(port);
    for (const label of routeLabels(metrics)) {
      assert.ok(ROUTES.has(label), label);
    }
    assert.ok(routeLabels(metrics).has("unmatched"));
    assert.ok(!/[0-9a-f]{16}/u.test(metrics.replace(/solidchange_[a-z_]+/gu, "")));
    assert.match(metrics, /route="unmatched",method="OTHER",status_class="4xx"\} 1$/mu);
  } finally {
    await stopServer(server);
  }
});

test("counter and fixed-bucket histogram are exact", async () => {
  const { server, port, lines } = await startObserved();
  try {
    for (let index = 0; index < 3; index += 1) {
      assert.equal((await request(port, { path: "/api/v1/meta", headers: [["X-Request-Id", REQUEST_ID]] })).status, 200);
    }
    assert.equal((await request(port, { path: "/api/v1/meta" })).status, 400);
    await logged(lines, 4);
    const metrics = await scrape(port);
    const labels = 'service="customer-api",route="/api/v1/meta",method="GET"';
    assert.ok(metrics.includes(`solidchange_http_requests_total{${labels},status_class="2xx"} 3\n`));
    assert.ok(metrics.includes(`solidchange_http_requests_total{${labels},status_class="4xx"} 1\n`));
    for (const bound of DURATION_BUCKETS_SECONDS) {
      const expected = bound >= 0.03 ? 4 : 0;
      assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${expected}\n`), String(bound));
    }
    assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_bucket{${labels},le="+Inf"} 4\n`));
    assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_sum{${labels}} 0.12\n`));
    assert.ok(metrics.includes(`solidchange_http_request_duration_seconds_count{${labels}} 4\n`));
  } finally {
    await stopServer(server);
  }
});

test("metrics are GET-only and refuse browser or proxied requests", async () => {
  const { server, port } = await startObserved();
  try {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      const response = await request(port, { method, path: "/metrics" });
      assert.equal(response.status, 405, method);
      assert.equal(header(response, "allow"), "GET");
    }
    const rejected = [
      [["Origin", "http://127.0.0.1:4183"]],
      [["X-Forwarded-For", "203.0.113.7"]],
      [["Forwarded", "for=203.0.113.7"]],
      [["X-Real-IP", "203.0.113.7"]],
      [["Via", "1.1 proxy"]],
      [["Sec-Fetch-Site", "cross-site"]],
      [["Host", "127.0.0.1"]]
    ];
    for (const headers of rejected) {
      const response = await request(port, { path: "/metrics", headers });
      assert.ok(response.status === 404 || response.status === 400, JSON.stringify(headers));
    }
    const lines = ["GET /metrics HTTP/1.1", "Host: metrics.example", "Connection: close", "", ""];
    assert.match(await rawTranscript(port, lines.join("\r\n")), /^HTTP\/1\.1 404 /u);
  } finally {
    await stopServer(server);
  }
});

test("metrics answer only the exact request target", async () => {
  const { server, port } = await startObserved();
  try {
    for (const path of ["/./metrics", "/%6detrics", "/x/../metrics", "//metrics", "/metrics/", "/metrics?format=text"]) {
      assert.equal((await request(port, { path })).status, 404, path);
    }
    assert.equal((await request(port, { path: "/metrics" })).status, 200);
  } finally {
    await stopServer(server);
  }
});

test("a response closed before finish is recorded with status 0, not its 200 default", async () => {
  const lines = [];
  const observer = createRequestObserver({
    service: "test",
    routes: ["/a"],
    config: { log: "json", metrics: "loopback" },
    sink: (line) => lines.push(line),
    timer: () => 0,
    wallClock: () => 0
  });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: () => undefined });
  observer.observe({ method: "GET", url: "/a" }, response);
  response.emit("close");
  response.emit("finish");
  const metrics = await observer.renderMetrics([]);
  assert.ok(metrics.includes('solidchange_http_requests_total{service="test",route="/a",method="GET",status_class="other"} 1\n'));
  assert.equal(metrics.includes('status_class="2xx"'), false);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).status, 0);
});

test("startCustomerApi wires the configured flags", async () => {
  const lines = [];
  const config = loadConfig({ CUSTOMER_API_PORT: "0", CUSTOMER_API_LOG: "json", CUSTOMER_API_METRICS: "loopback" });
  const { server, address } = await startCustomerApi(config, { logSink: (line) => lines.push(line) });
  try {
    assert.equal((await request(address.port, { path: "/metrics" })).status, 200);
    await logged(lines, 1);
    assert.equal(JSON.parse(lines[0]).route, "/metrics");
  } finally {
    await stopServer(server);
  }
});
