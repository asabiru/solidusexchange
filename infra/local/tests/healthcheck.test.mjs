import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import { isUuidV7 } from "../../../packages/customer-api/src/request-id.mjs";
import { probe, uuidV7 } from "../scripts/healthcheck.mjs";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("request ids satisfy the customer-api UUIDv7 contract", () => {
  for (let index = 0; index < 50; index += 1) {
    assert.equal(isUuidV7(uuidV7()), true);
  }
  assert.match(uuidV7(0x0123456789ab), /^01234567-89ab-7/);
});

test("passes on HTTP 200 and sends a UUIDv7 request id", async () => {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.headers["x-request-id"]);
    response.end("{}");
  });
  const port = await listen(server);
  try {
    await probe(`http://127.0.0.1:${port}/api/v1/meta`);
    assert.equal(isUuidV7(seen[0]), true);
  } finally {
    await close(server);
  }
});

test("fails on non-200 responses, including redirects", async () => {
  for (const status of [204, 302, 400, 503]) {
    const server = http.createServer((_request, response) => {
      response.writeHead(status, { location: "http://127.0.0.1/" });
      response.end();
    });
    const port = await listen(server);
    try {
      await assert.rejects(probe(`http://127.0.0.1:${port}/bff/health`), new RegExp(`status ${status}`));
    } finally {
      await close(server);
    }
  }
});

test("probes TCP listeners and fails when nothing listens", async () => {
  const server = net.createServer((socket) => socket.end());
  const port = await listen(server);
  await probe(`tcp://127.0.0.1:${port}`);
  await close(server);
  await assert.rejects(probe(`tcp://127.0.0.1:${port}`), /tcp healthcheck failed/);
  await assert.rejects(probe(`http://127.0.0.1:${port}/`), /http healthcheck failed/);
});

test("refuses non-loopback, non-http and malformed targets", async () => {
  await assert.rejects(probe("http://localhost:4184/bff/health"), /must be 127\.0\.0\.1/);
  await assert.rejects(probe("http://10.0.0.1:4184/bff/health"), /must be 127\.0\.0\.1/);
  await assert.rejects(probe("https://127.0.0.1:4184/"), /must use http: or tcp:/);
  await assert.rejects(probe("not a url"), /must be a URL/);
});
