import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type IncomingHttpHeaders, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { startCustomerApi } from "@solidchange/customer-api/dev-server";
import { loadServerConfig } from "./config.js";
import {
  createCustomerApiClient,
  customerApiPlatform,
  customerApiSubject,
  maxCustomerApiResponseBytes
} from "./customer-api-client.js";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function withCustomerApi<T>(key: string, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const { server, address } = await startCustomerApi({
    host: "127.0.0.1",
    port: 0,
    rateLimitPerMinute: 60,
    authMode: "synthetic-dev",
    devTokenKey: key
  });
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withFakeApi<T>(
  respond: (path: string) => unknown,
  run: (baseUrl: string, seen: IncomingHttpHeaders[]) => Promise<T>
): Promise<T> {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    seen.push(request.headers);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(respond(request.url ?? "")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("customer API client", () => {
  it("maps BFF subjects onto the synthetic customer subject space", () => {
    const subject = customerApiSubject("tg-0123456789abcdef");
    assert.match(subject, /^syn_cust_[0-9a-f]{24}$/);
    assert.equal(customerApiSubject("tg-0123456789abcdef"), subject);
    assert.notEqual(customerApiSubject("tg-fedcba9876543210"), subject);
  });

  it("reads session and capabilities from the dev customer API without X-Device-Id", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      assert.equal(client.configured, true);
      assert.deepEqual(await client.access("tg-0123456789abcdef", Date.now()), {
        status: "connected",
        granted: ["customer.session.read", "customer.capabilities.read", "customer.kyc.read"],
        commandsEnabled: false
      });
      const wrongKey = createCustomerApiClient({ baseUrl, devTokenKey: randomBytes(32).toString("hex") });
      assert.deepEqual(await wrongKey.access("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
    });
  });

  it("sends exactly the customer request headers", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    await withFakeApi(
      (path) => path === "/api/v1/customer/session"
        ? { subject, actor_type: "customer", scopes: ["customer.session.read"], expires_at: "2026-10-06T00:00:00Z" }
        : { capabilities: ["customer.session.read"], commands_enabled: false },
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.equal((await client.access("tg-0123456789abcdef", Date.now())).status, "connected");
        assert.equal(seen.length, 2);
        for (const headers of seen) {
          assert.equal(headers["x-device-id"], undefined);
          assert.equal(headers["x-platform"], customerApiPlatform);
          assert.match(String(headers["x-request-id"]), uuidV7);
          assert.match(String(headers.authorization), new RegExp(`^Bearer scdev1\\.${subject}\\.[0-9]{10}\\.[0-9a-f]{64}$`));
        }
        assert.notEqual(seen[0]["x-request-id"], seen[1]["x-request-id"]);
      }
    );
  });

  it("fails closed on unexpected responses", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const session = { subject, actor_type: "customer", scopes: [], expires_at: "2026-10-06T00:00:00Z" };
    for (const [sessionBody, capabilitiesBody] of [
      [{ ...session, subject: "syn_cust_someoneelse00" }, { capabilities: [], commands_enabled: false }],
      [{ ...session, actor_type: "operator" }, { capabilities: [], commands_enabled: false }],
      [{ ...session, extra: true }, { capabilities: [], commands_enabled: false }],
      [session, { capabilities: ["customer.withdrawals.create"], commands_enabled: true }],
      [session, { capabilities: [42], commands_enabled: false }],
      [session, { capabilities: ["operator.payouts.approve"], commands_enabled: false }]
    ]) {
      await withFakeApi(
        (path) => path === "/api/v1/customer/session" ? sessionBody : capabilitiesBody,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(await client.access("tg-0123456789abcdef", Date.now()), { status: "unavailable" }, JSON.stringify([sessionBody, capabilitiesBody]));
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.access("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("fails closed on non-JSON content types and oversized bodies", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const session = JSON.stringify({ subject, actor_type: "customer", scopes: [], expires_at: "2026-10-06T00:00:00Z" });
    const capabilities = (count: number) => JSON.stringify({
      capabilities: Array.from({ length: count }, () => "customer.session.read"),
      commands_enabled: false
    });
    const cases: [string, string | undefined, number][] = [
      ["control", "application/json; charset=utf-8", 1],
      ["text/html", "text/html", 1],
      ["text/plain", "text/plain; charset=utf-8", 1],
      ["missing", undefined, 1],
      ["oversized", "application/json", 5_000]
    ];
    for (const [label, contentType, count] of cases) {
      const server = createServer((request, response) => {
        const text = request.url?.endsWith("/session") ? session : capabilities(count);
        if (contentType !== undefined) response.setHeader("content-type", contentType);
        if (count > 1) {
          // Chunked, without content-length: the client must cap the stream itself.
          response.write(text.slice(0, 1_000));
          response.end(text.slice(1_000));
          return;
        }
        response.end(text);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.access("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, label === "control" ? "connected" : "unavailable", label);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    assert.ok(capabilities(5_000).length > maxCustomerApiResponseBytes);
  });

  it("rejects malformed content-length and encodings and cancels the body on every failure", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const session = JSON.stringify({ subject, actor_type: "customer", scopes: [], expires_at: "2026-10-06T00:00:00Z" });
    const capabilities = JSON.stringify({ capabilities: [], commands_enabled: false });
    const encoder = new TextEncoder();
    const invalidUtf8 = Buffer.from(session.replace("2026", "\u00ff026"), "latin1");
    const cases: [string, number, Record<string, string>, Uint8Array[] | "endless" | "error"][] = [
      ["control", 200, { "content-length": String(session.length) }, [encoder.encode(session)]],
      ["negative length", 200, { "content-length": "-1" }, [encoder.encode(session)]],
      ["NaN length", 200, { "content-length": "abc" }, [encoder.encode(session)]],
      ["exponent length", 200, { "content-length": "1e2" }, [encoder.encode(session)]],
      ["signed length", 200, { "content-length": "+120" }, [encoder.encode(session)]],
      ["duplicate length", 200, { "content-length": "120, 120" }, [encoder.encode(session)]],
      ["huge length", 200, { "content-length": "99999999999999999999" }, [encoder.encode(session)]],
      ["declared oversize", 200, { "content-length": String(maxCustomerApiResponseBytes + 1) }, [encoder.encode(session)]],
      ["error status", 500, {}, [encoder.encode(session)]],
      ["wrong type", 200, { "content-type": "text/html" }, [encoder.encode(session)]],
      ["endless chunks", 200, {}, "endless"],
      ["invalid utf-8", 200, {}, [invalidUtf8]],
      ["stream error", 200, {}, "error"]
    ];
    const originalFetch = globalThis.fetch;
    try {
      for (const [label, status, headers, body] of cases) {
        let cancelled = false;
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (body === "endless") controller.enqueue(new Uint8Array(1_024));
            else if (body === "error") controller.error(new Error("synthetic upstream reset"));
            else if (body.length > 0) controller.enqueue(body.shift() as Uint8Array);
            else controller.close();
          },
          cancel() {
            cancelled = true;
          }
        });
        globalThis.fetch = (async (input: string | URL | Request) => {
          const path = new URL(String(input)).pathname;
          if (path.endsWith("/capabilities")) {
            return new Response(capabilities, { headers: { "content-type": "application/json" } });
          }
          return new Response(stream, { status, headers: { "content-type": "application/json", ...headers } });
        }) as typeof fetch;
        const client = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key });
        const result = await client.access("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, label === "control" ? "connected" : "unavailable", label);
        const consumed = label === "control" || label === "invalid utf-8" || label === "stream error";
        assert.equal(cancelled, !consumed, `${label}: cancelled=${cancelled}`);
        if (label === "endless chunks") assert.ok(pulls * 1_024 <= maxCustomerApiResponseBytes + 2_048, label);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aborts a stalled body at the timeout and releases the upstream connection", async () => {
    const key = randomBytes(32).toString("hex");
    let released!: () => void;
    const closed = new Promise<void>((resolve) => {
      released = resolve;
    });
    const server = createServer((_request, response) => {
      response.once("close", () => released());
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"subject":');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const client = createCustomerApiClient({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        devTokenKey: key,
        timeoutMs: 300
      });
      const started = Date.now();
      assert.deepEqual(await client.access("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 250 && elapsed < 5_000, `elapsed ${elapsed} ms`);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("upstream response was never released")), 2_000);
        })
      ]).finally(() => clearTimeout(timer));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reads wallets with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const wallets = [
      { wallet_id: "syn_wal_rub00001", asset: "RUB", available: "84200.00", hold: "0.00" },
      { wallet_id: "syn_wal_usdt0001", asset: "USDT", available: "482.180000", hold: "25.000000" },
      { wallet_id: "syn_wal_ton00001", asset: "TON", available: "18.250000000", hold: "1.500000000" }
    ];
    await withFakeApi(
      () => ({ wallets }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.wallets("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.wallets, wallets);
        assert.equal(seen.length, 1);
        const headers = seen[0];
        assert.equal(headers["x-device-id"], undefined);
        assert.equal(headers["x-platform"], customerApiPlatform);
        assert.equal(headers["x-client-version"], "solidchange-miniapp-bff/0.1.0");
        assert.match(String(headers["x-request-id"]), uuidV7);
        assert.match(String(headers.authorization), new RegExp(`^Bearer scdev1\\.${subject}\\.[0-9]{10}\\.[0-9a-f]{64}$`));
        assert.equal(headers.accept, "application/json");
      }
    );
  });

  it("maps an upstream wallets refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const wallets = JSON.stringify({ wallets: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", wallets }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.wallets("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed wallets bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = { wallet_id: "syn_wal_rub00001", asset: "RUB", available: "84200.00", hold: "0.00" };
    for (const body of [
      { wallets: "oops" },
      { wallets: [{ ...entry, extra: true }] },
      { wallets: [{ ...entry, wallet_id: 42 }] },
      { wallets: [{ ...entry, asset: "BTC" }] },
      { wallets: [{ ...entry, asset: "TON", available: "1.0000000000" }] },
      { wallets: [{ ...entry, hold: "-1.00" }] },
      { wallets: [{ ...entry, available: "abc" }] },
      { wallets: [{ wallet_id: entry.wallet_id, asset: entry.asset, available: entry.available }] },
      { wallets: [], extra: true },
      ["wallets"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.wallets("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.wallets("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.wallets.read is refused with 403.
      assert.deepEqual(await client.wallets("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.wallets("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("is not configured by default and only accepts a loopback origin with a dev key", async () => {
    const client = createCustomerApiClient({});
    assert.equal(client.configured, false);
    assert.deepEqual(await client.access("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
    const key = "a".repeat(64);
    assert.equal(loadServerConfig({}).customerApiUrl, undefined);
    assert.equal(loadServerConfig({ MINIAPP_CUSTOMER_API_URL: "http://127.0.0.1:4185", MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key }).customerApiUrl, "http://127.0.0.1:4185");
    for (const env of [
      { MINIAPP_CUSTOMER_API_URL: "http://127.0.0.1:4185" },
      { MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key },
      { MINIAPP_CUSTOMER_API_URL: "https://api.example.com", MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key },
      { MINIAPP_CUSTOMER_API_URL: "http://10.0.0.5:4185", MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key },
      { MINIAPP_CUSTOMER_API_URL: "http://127.0.0.1:4185/api", MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key },
      { MINIAPP_CUSTOMER_API_URL: "http://127.0.0.1:4185", MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: "A".repeat(64) }
    ]) {
      assert.throws(() => loadServerConfig(env), /MINIAPP_CUSTOMER_API/, JSON.stringify(env));
    }
  });
});
