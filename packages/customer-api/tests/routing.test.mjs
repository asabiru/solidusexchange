import assert from "node:assert/strict";
import test from "node:test";

import { OPERATIONS } from "../src/contract.mjs";
import {
  assertConforms,
  checkedRequest,
  contract,
  customerHeaders,
  header,
  rawExchange,
  REQUEST_ID,
  startTestServer,
  rawTranscript,
  stopServer
} from "./http-client.mjs";

const SERVED = OPERATIONS.map((operation) => operation.path);
const OPERATOR_HEADERS = [...customerHeaders({ "X-Platform": "operator-web" }), ["X-Device-Id", "4d1c3a52-1f43-4c6b-9b3a-2a1f7e9c0d11"]];
let port;
let server;

test.before(async () => {
  ({ server, port } = await startTestServer());
});

test.after(async () => {
  await stopServer(server);
});

async function expectNotFound(method, path, headers = customerHeaders()) {
  const response = await checkedRequest(port, { method, path, headers });
  if (!path.startsWith("/") && !path.startsWith("http://") && path !== "*") {
    assert.equal(response.status, 400, `${method} ${path}`);
    assert.equal(JSON.parse(response.body).code, "VALIDATION_FAILED");
    return response;
  }
  assert.equal(response.status, 404, `${method} ${path}`);
  if (method !== "HEAD") {
    assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
  }
  return response;
}

test("non-GET methods on served paths return the 404 envelope", async () => {
  for (const path of SERVED) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]) {
      const response = await expectNotFound(method, path);
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
      assert.deepEqual(header(response, "allow"), []);
    }
  }
});

test("unserved operator paths are not served, even with operator headers", async () => {
  for (const path of Object.keys(contract.openapi.paths).filter(
    (item) => item.startsWith("/api/v1/operator/") && !SERVED.includes(item)
  )) {
    await expectNotFound("GET", path, OPERATOR_HEADERS);
    await expectNotFound("GET", path);
  }
});

test("planned but absent namespaces are not served", async () => {
  const planned = contract.openapi["x-solidchange-planned-namespaces"];
  for (const path of [...planned.customer, ...planned.operator]) {
    await expectNotFound("GET", path);
    await expectNotFound("POST", path);
  }
});

test("path variants of served operations never match", async () => {
  const variants = [];
  for (const path of SERVED) {
    const segments = path.split("/");
    const last = segments.at(-1);
    variants.push(
      `${path}/`,
      `${path}//`,
      `/${path}`,
      path.replace("/api/", "//api/"),
      path.toUpperCase(),
      path.replace("api", "API"),
      path.replace(last, last[0].toUpperCase() + last.slice(1)),
      path.replaceAll("/", "%2F"),
      path.replace("/v1/", "/v1%2F"),
      path.replace("/v1/", "/v1%2f"),
      path.replace(last, encodeURIComponent(last).replace(last[0], `%${last.charCodeAt(0).toString(16)}`)),
      path.replace("/v1/", "/v1/./"),
      path.replace("/v1/", "/v2/../v1/"),
      path.replace("/v1/", "/v1/x/../"),
      path.replace("/v1/", "/v1/%2e%2e/v1/"),
      path.replace("/api/v1", "/api/v1/customer/.."),
      `${path}?`,
      `${path}?debug=1`,
      `${path}#fragment`,
      `${path};param`,
      `${path}%00`,
      `${path}%20`,
      `${path}.json`,
      path.replace("/v1/", "/v1\\"),
      `http://127.0.0.1${path}`,
      `/api/v1/meta/../customer/session`,
      `/api/v1/customer/session/../capabilities`
    );
  }
  variants.push("/", "/api", "/api/v1", "/api/v1/", "/api/v1/customer", "/api/v1/customer/", "/api/v0/meta", "/api/v2/meta");
  for (const path of new Set(variants)) {
    if (!SERVED.includes(path)) {
      await expectNotFound("GET", path);
    }
  }
});

test("OPTIONS * and other request-target forms return the envelope", async () => {
  await expectNotFound("OPTIONS", "*");
  await expectNotFound("GET", "*");
});

test("CONNECT returns the 404 envelope instead of tunnelling", async () => {
  for (const target of ["127.0.0.1:443", "example.invalid:80", "/api/v1/meta"]) {
    const response = await rawExchange(port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    assertConforms("GET", "/invalid", response);
    assert.equal(response.status, 404, target);
    assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
  }
});

test("a rejected body is never followed by a second response on the socket", async () => {
  const transcript = await rawTranscript(
    port,
    `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: identity\r\nX-Request-Id: ${REQUEST_ID}\r\n\r\n`
  );
  assert.match(transcript, /^HTTP\/1\.1 400 /);
  assert.match(transcript, /"code":"VALIDATION_FAILED"/);
  assert.equal(transcript.split("HTTP/1.1 ").length - 1, 1);
});

test("malformed request lines and methods return the 400 envelope", async () => {
  const lines = [
    "get /api/v1/meta HTTP/1.1",
    "Get /api/v1/meta HTTP/1.1",
    "GET /api/v1/meta HTTP/9.9",
    "GET /api/v1/me ta HTTP/1.1",
    "GET\t/api/v1/meta HTTP/1.1",
    "BREW /api/v1/meta HTTP/1.1",
    "GET /api/v1/meta\u0001 HTTP/1.1",
    "GET"
  ];
  for (const line of lines) {
    const response = await rawExchange(port, `${line}\r\nHost: 127.0.0.1\r\nX-Request-Id: ${REQUEST_ID}\r\n\r\n`);
    assertConforms("GET", "/invalid", response);
    assert.equal(response.status, 400, line);
    assert.notEqual(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(JSON.parse(response.body).code, "VALIDATION_FAILED");
  }
});

test("malformed header blocks return the 400 envelope", async () => {
  const blocks = [
    `GET /api/v1/meta HTTP/1.1\r\nX-Request-Id: ${REQUEST_ID}\r\n\r\n`,
    `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nBad Header: x\r\n\r\n`,
    `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\n X-Request-Id: ${REQUEST_ID}\r\n\r\n`,
    `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Big: ${"a".repeat(20_000)}\r\n\r\n`,
    `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n`
  ];
  blocks.push(
    `GET /api/v1/meta HTTP/1.1\r\nHost: 127.0.0.1\r\nHost: 127.0.0.2\r\nX-Request-Id: ${REQUEST_ID}\r\n\r\n`,
    `GET /api/v1/customer/session HTTP/1.1\r\n${customerHeaders().map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`
  );
  for (const block of blocks) {
    const response = await rawExchange(port, block);
    assertConforms("GET", "/invalid", response);
    assert.equal(response.status, 400);
  }
});

test("seeded probe: generated request targets match only exact served paths", async () => {
  const pieces = ["api", "API", "v1", "V1", "meta", "customer", "operator", "session", "capabilities", "..", ".", "", "%2F", "%2e", "admin", "~"];
  let seed = 20261005;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  const tried = new Set();
  for (let index = 0; index < 400; index += 1) {
    const length = 1 + (next() % 5);
    const path = `/${Array.from({ length }, () => pieces[next() % pieces.length]).join("/")}`;
    if (tried.has(path)) {
      continue;
    }
    tried.add(path);
    const response = await checkedRequest(port, { path, headers: customerHeaders() });
    assert.equal(response.status, SERVED.includes(path) ? 200 : 404, path);
  }
});
