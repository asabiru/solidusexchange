import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSIONS_POLICY, SECURITY_HEADERS } from "../src/app.mjs";
import { OPERATIONS } from "../src/contract.mjs";
import { METRICS_CONTENT_TYPE, METRICS_PATH } from "../src/observability.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { customerHeaders, header, NOW_MS, rawExchange, REQUEST_ID, request, startTestServer, stopServer } from "./http-client.mjs";

const JSON_TYPE = "application/json; charset=utf-8";

function assertSecurityHeaders(response, label, contentType = JSON_TYPE) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(header(response, name), value, `${label}: ${name}`);
  }
  assert.equal(header(response, "content-type"), contentType, label);
}

function operationHeaders(operation, overrides = {}) {
  return operation.authenticated ? customerHeaders(overrides) : customerHeaders({
    Authorization: null,
    "X-Client-Version": null,
    "X-Platform": null,
    ...overrides
  });
}

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("the security header set is frozen and denies framing, sniffing, caching and powerful features", () => {
  assert.equal(Object.isFrozen(SECURITY_HEADERS), true);
  assert.deepEqual(SECURITY_HEADERS, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": PERMISSIONS_POLICY,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
  for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
    assert.ok(PERMISSIONS_POLICY.split(", ").includes(`${feature}=()`), feature);
  }
  const csp = SECURITY_HEADERS["content-security-policy"];
  assert.deepEqual([...new Set(csp.match(/'[^']*'/g))], ["'none'"]);
  assert.equal(/(^|\s)\*/.test(csp), false);
});

test("every operation sends the security headers on success and on its error paths", async () => {
  await withServer({ observability: { log: "off", metrics: "loopback" } }, async (port) => {
    for (const operation of OPERATIONS) {
      const { method, path } = operation;
      const ok = await request(port, { method, path, headers: operationHeaders(operation) });
      assert.equal(ok.status, 200, path);
      assertSecurityHeaders(ok, `${method} ${path} 200`);

      const invalid = await request(port, { method, path, headers: operationHeaders(operation, { "X-Request-Id": null }) });
      assert.equal(invalid.status, 400, path);
      assertSecurityHeaders(invalid, `${method} ${path} 400`);

      const unsupported = await request(port, { method: "POST", path, headers: operationHeaders(operation) });
      assert.equal(unsupported.status, 404, path);
      assertSecurityHeaders(unsupported, `POST ${path} 404`);

      if (operation.authenticated) {
        const anonymous = await request(port, { method, path, headers: customerHeaders({ Authorization: null }) });
        assert.equal(anonymous.status, 401, path);
        assertSecurityHeaders(anonymous, `${method} ${path} 401`);
      }
    }

    const unknown = await request(port, { path: "/api/v1/unknown", headers: [["X-Request-Id", REQUEST_ID]] });
    assert.equal(unknown.status, 404);
    assertSecurityHeaders(unknown, "unknown 404");

    const metrics = await request(port, { path: METRICS_PATH });
    assert.equal(metrics.status, 200);
    assertSecurityHeaders(metrics, "metrics 200", METRICS_CONTENT_TYPE);

    const metricsPost = await request(port, { method: "POST", path: METRICS_PATH });
    assert.equal(metricsPost.status, 405);
    assertSecurityHeaders(metricsPost, "metrics 405");

    const forwarded = await request(port, { path: METRICS_PATH, headers: [["X-Forwarded-For", "198.51.100.7"]] });
    assert.equal(forwarded.status, 404);
    assertSecurityHeaders(forwarded, "metrics 404");
  });
});

test("rate-limited and failed requests keep the security headers", async () => {
  const session = OPERATIONS.find((operation) => operation.authenticated);
  assert.ok(session);
  await withServer({ rateLimiter: createFixedWindowRateLimiter({ limit: 1, clock: () => NOW_MS }) }, async (port) => {
    const first = await request(port, { path: session.path, headers: customerHeaders() });
    assert.equal(first.status, 200);
    const limited = await request(port, { path: session.path, headers: customerHeaders() });
    assert.equal(limited.status, 429);
    assertSecurityHeaders(limited, "429");
  });
  const verifier = {
    verify: async () => {
      throw new Error("synthetic verifier failure");
    }
  };
  await withServer({ verifier }, async (port) => {
    const failed = await request(port, { path: session.path, headers: customerHeaders() });
    assert.equal(failed.status, 500);
    assertSecurityHeaders(failed, "500");
  });
});

test("raw socket rejections keep the security headers", async () => {
  await withServer({}, async (port) => {
    const transcripts = {
      malformed: "get /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
      connect: "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
      oversized: `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Padding: ${"a".repeat(20_000)}\r\n\r\n`,
      duplicateHost: "GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nHost: 127.0.0.1\r\n\r\n"
    };
    for (const [label, text] of Object.entries(transcripts)) {
      const response = await rawExchange(port, text);
      assert.ok(response.status === 400 || response.status === 404, `${label} -> ${response.status}`);
      assertSecurityHeaders(response, label);
    }
  });
});

test("unmet Expect headers are rejected with the security headers instead of a bare 417", async () => {
  await withServer({}, async (port) => {
    const [operation] = OPERATIONS;
    const response = await rawExchange(port, `GET ${operation.path} HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: synthetic-unmet\r\n\r\n`);
    assert.equal(response.status, 417);
    assertSecurityHeaders(response, "417");
    assert.equal(header(response, "connection"), "close");
  });
});
