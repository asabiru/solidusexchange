import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, it } from "node:test";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { createKycService } from "./kyc.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const subject = "tg-0123456789abcdef";

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }),
    ...overrides
  };
}

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

async function start(serverConfig: ServerConfig): Promise<{ port: number; base: string }> {
  const server = createMiniappServer(serverConfig);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return { port: address.port, base: `http://127.0.0.1:${address.port}` };
}

async function devSession(base: string): Promise<string> {
  const response = await fetch(`${base}/bff/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: "{}"
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

interface RawResponse {
  status: number;
  body: string;
}

function rawRequest(port: number, requestText: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(requestText));
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const separator = text.indexOf("\r\n\r\n");
      const head = separator === -1 ? text : text.slice(0, separator);
      resolve({
        status: Number(head.split(" ")[1]),
        body: separator === -1 ? "" : text.slice(separator + 4)
      });
    });
    socket.on("error", reject);
  });
}

function getWithHost(port: number, host: string, path = "/bff/health"): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body)
  });
}

describe("miniapp BFF core hardening", () => {
  it("answers 400, not 500, to request targets that do not parse as URLs", async () => {
    const { port } = await start(config());
    for (const target of ["http://[bad", "http://a:99999/bff/health", "http://%/bff/health"]) {
      const response = await rawRequest(
        port,
        `GET ${target} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: close\r\n\r\n`
      );
      assert.equal(response.status, 400, target);
      assert.match(response.body, /"error":"invalid_request"/, target);
    }
    const absoluteForm = await rawRequest(
      port,
      `GET http://127.0.0.1:${port}/bff/health HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: close\r\n\r\n`
    );
    assert.equal(absoluteForm.status, 200);
  });

  it("rejects Host headers that only start like a loopback literal", async () => {
    const { port } = await start(config());
    for (const host of ["[::1]garbage", "127.0.0.1:80:90", "127.0.0.1:", "localhost::80"]) {
      const response = await getWithHost(port, host);
      assert.equal(response.status, 421, host);
    }
    for (const host of ["[::1]", "[::1]:8080", "127.0.0.1", `127.0.0.1:${port}`, "localhost", `localhost:${port}`]) {
      const response = await getWithHost(port, host);
      assert.equal(response.status, 200, host);
    }
  });

  it("keeps the metrics gate closed for a Host that does not parse wholly", async () => {
    const { port } = await start(loadServerConfig({ MINIAPP_METRICS: "loopback" }));
    // The server-level host gate rejects the malformed value before metrics
    // routing; on the old lax parser it passed both gates and served metrics.
    const response = await getWithHost(port, "[::1]garbage", "/bff/metrics");
    assert.equal(response.status, 421);
  });

  it("rejects X-Device-Id on every customer route, not a drifting subset", async () => {
    const { base } = await start(config());
    const cookie = await devSession(base);
    const device = { cookie, "x-device-id": "dev-0123456789abcdef" };
    for (const path of [
      "/bff/health",
      "/bff/session",
      "/bff/wallet",
      "/bff/operations",
      "/bff/operations/op-0001",
      "/bff/profile",
      "/bff/kyc/status",
      "/bff/quotes/preview?from=RUB&to=USDT&amount=100"
    ]) {
      const response = await fetch(`${base}${path}`, { headers: device });
      assert.equal(response.status, 400, path);
      assert.equal((await response.json()).error, "invalid_request", path);
    }
    for (const path of ["/bff/kyc/applications", "/bff/auth/logout"]) {
      const response = await post(base, path, {}, device);
      assert.equal(response.status, 400, path);
    }
    // The same requests stay usable without the operator header.
    assert.equal((await fetch(`${base}/bff/session`, { headers: { cookie } })).status, 200);
    assert.equal((await post(base, "/bff/kyc/applications", {}, { cookie })).status, 409);
  });

  it("rejects a cross-site fetch context on audit-appending routes", async () => {
    const { base } = await start(config());
    const cookie = await devSession(base);
    const preview = `${base}/bff/quotes/preview?from=RUB&to=USDT&amount=100`;

    for (const site of ["cross-site", "same-site"]) {
      const response = await fetch(preview, { headers: { cookie, "sec-fetch-site": site } });
      assert.equal(response.status, 403, site);
      assert.equal((await response.json()).error, "fetch_site_rejected", site);
    }
    // A POST carries an exact Origin but a contradictory fetch context still fails.
    const supportPost = await post(
      base,
      "/bff/support/requests",
      { category: "question", topic: "quote", message: "Is the quote preview synthetic?" },
      { cookie, "sec-fetch-site": "cross-site" }
    );
    assert.equal(supportPost.status, 403);

    for (const site of [undefined, "same-origin", "none"]) {
      const headers: Record<string, string> = { cookie };
      if (site) headers["sec-fetch-site"] = site;
      const response = await fetch(preview, { headers });
      assert.equal(response.status, 200, site ?? "absent");
    }
  });

  it("prunes provider-reference indexes when a KYC application resets", async () => {
    const kyc = createKycService({
      seed: "miniapp-bff-core-test",
      scenario: "approve",
      reviewTimeoutSeconds: 3_600,
      clock: () => 1_790_000_000_000
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.deepEqual(await kyc.submit(subject), { created: true });
      kyc.reset(subject);
    }
    assert.deepEqual(await kyc.submit(subject), { created: true });
    assert.deepEqual(kyc.indexSizes(), { applicants: 1, subjects: 1 });
  });
});
