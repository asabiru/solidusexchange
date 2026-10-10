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
const isoTimestamp = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

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
        granted: ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read", "customer.auth.read", "customer.users.read"],
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

  it("reads deposits with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const deposits = [
      {
        deposit_id: "dep_0123456789abcdef01234567",
        asset: "RUB",
        method: "sbp",
        status: "payment_received",
        expected_amount: "25000.00",
        received_total: "25000.00",
        reversed_total: "0.00",
        payment_reference: "SIMSBP0123456789AB",
        created_at: "2026-10-04T12:10:00.000Z",
        updated_at: "2026-10-04T12:14:00.000Z",
        posting: "none"
      },
      {
        deposit_id: "dep_fedcba9876543210fedcba98",
        asset: "RUB",
        method: "sbp",
        status: "awaiting_payment",
        expected_amount: "10000.00",
        received_total: "0.00",
        reversed_total: "0.00",
        payment_reference: "SIMSBPFEDCBA987654",
        created_at: "2026-10-06T09:30:00.000Z",
        updated_at: "2026-10-06T09:30:00.000Z",
        posting: "none"
      }
    ];
    await withFakeApi(
      () => ({ mode: "test", deposits }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.deposits("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.deposits, deposits);
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

  it("maps an upstream deposits refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const deposits = JSON.stringify({ mode: "test", deposits: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", deposits }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.deposits("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed deposits bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      deposit_id: "dep_0123456789abcdef01234567",
      asset: "RUB",
      method: "sbp",
      status: "payment_received",
      expected_amount: "25000.00",
      received_total: "25000.00",
      reversed_total: "0.00",
      payment_reference: "SIMSBP0123456789AB",
      created_at: "2026-10-04T12:10:00.000Z",
      updated_at: "2026-10-04T12:14:00.000Z",
      posting: "none"
    };
    for (const body of [
      { mode: "test", deposits: "oops" },
      { mode: "test", deposits: [{ ...entry, extra: true }] },
      { mode: "test", deposits: [{ ...entry, deposit_id: "dep_bad" }] },
      { mode: "test", deposits: [{ ...entry, asset: "BTC" }] },
      { mode: "test", deposits: [{ ...entry, asset: "USDT", expected_amount: "1.0000000" }] },
      { mode: "test", deposits: [{ ...entry, method: "card" }] },
      { mode: "test", deposits: [{ ...entry, status: "settled" }] },
      { mode: "test", deposits: [{ ...entry, expected_amount: "-1.00" }] },
      { mode: "test", deposits: [{ ...entry, payment_reference: "SBP0123456789AB" }] },
      { mode: "test", deposits: [{ ...entry, created_at: "not-a-date" }] },
      { mode: "test", deposits: [{ ...entry, posting: "queued" }] },
      { mode: "test", deposits: [], extra: true },
      { deposits: [entry] },
      { mode: "live", deposits: [entry] },
      ["deposits"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.deposits("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.deposits("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api deposits KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.deposits.read is refused with 403.
      assert.deepEqual(await client.deposits("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.deposits("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads withdrawals with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const withdrawals = [
      {
        withdrawal_id: "wdr_0123456789abcdef01234567",
        asset: "USDT",
        network: "TRON_TESTNET",
        status: "confirmed",
        amount: "25.000000",
        fee_amount: "0.125000",
        destination_reference: "destination_ref_0123456789abcd",
        legs: [
          { leg_id: "wdl_0123456789abcdef01234567", asset: "USDT", amount: "25.000000", direction: "out" },
          { leg_id: "wdl_fedcba9876543210fedcba98", asset: "USDT", amount: "0.125000", direction: "out" }
        ],
        created_at: "2026-10-02T14:05:00.000Z",
        updated_at: "2026-10-02T14:20:00.000Z",
        expires_at: "2026-10-02T14:10:00.000Z",
        posting: "none"
      },
      {
        withdrawal_id: "wdr_fedcba9876543210fedcba98",
        asset: "TON",
        network: "TON_TESTNET",
        status: "pending_maker_approval",
        amount: "2.000000000",
        fee_amount: "0.010000000",
        destination_reference: "destination_ref_fedcba9876543210",
        legs: [
          { leg_id: "wdl_111111111111111111111111", asset: "TON", amount: "2.000000000", direction: "out" },
          { leg_id: "wdl_222222222222222222222222", asset: "TON", amount: "0.010000000", direction: "out" }
        ],
        created_at: "2026-10-06T09:30:00.000Z",
        updated_at: "2026-10-06T09:30:00.000Z",
        expires_at: "2026-10-06T09:35:00.000Z",
        posting: "none"
      }
    ];
    await withFakeApi(
      () => ({ mode: "test", withdrawals }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.withdrawals("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.withdrawals, withdrawals);
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

  it("maps an upstream withdrawals refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const withdrawals = JSON.stringify({ mode: "test", withdrawals: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", withdrawals }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.withdrawals("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed withdrawals bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      withdrawal_id: "wdr_0123456789abcdef01234567",
      asset: "USDT",
      network: "TRON_TESTNET",
      status: "confirmed",
      amount: "25.000000",
      fee_amount: "0.125000",
      destination_reference: "destination_ref_0123456789abcd",
      legs: [
        { leg_id: "wdl_0123456789abcdef01234567", asset: "USDT", amount: "25.000000", direction: "out" },
        { leg_id: "wdl_fedcba9876543210fedcba98", asset: "USDT", amount: "0.125000", direction: "out" }
      ],
      created_at: "2026-10-02T14:05:00.000Z",
      updated_at: "2026-10-02T14:20:00.000Z",
      expires_at: "2026-10-02T14:10:00.000Z",
      posting: "none"
    };
    for (const body of [
      { mode: "test", withdrawals: "oops" },
      { mode: "test", withdrawals: [{ ...entry, extra: true }] },
      { mode: "test", withdrawals: [{ ...entry, withdrawal_id: "wdr_bad" }] },
      { mode: "test", withdrawals: [{ ...entry, asset: "RUB" }] },
      { mode: "test", withdrawals: [{ ...entry, network: "TON_MAINNET" }] },
      { mode: "test", withdrawals: [{ ...entry, asset: "TON", network: "TRON_TESTNET" }] },
      { mode: "test", withdrawals: [{ ...entry, amount: "25.0000000" }] },
      { mode: "test", withdrawals: [{ ...entry, status: "signing" }] },
      { mode: "test", withdrawals: [{ ...entry, amount: "-1.000000" }] },
      { mode: "test", withdrawals: [{ ...entry, destination_reference: "dest_0123456789" }] },
      { mode: "test", withdrawals: [{ ...entry, legs: entry.legs.slice(0, 1) }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [...entry.legs, entry.legs[0]] }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [{ ...entry.legs[0], leg_id: "bad" }, entry.legs[1]] }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [{ ...entry.legs[0], asset: "TON" }, entry.legs[1]] }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [{ ...entry.legs[0], amount: "1.000000" }, entry.legs[1]] }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [{ ...entry.legs[0], direction: "in" }, entry.legs[1]] }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [{ ...entry.legs[0], extra: true }, entry.legs[1]] }] },
      { mode: "test", withdrawals: [{ ...entry, legs: [entry.legs[1], entry.legs[0]] }] },
      { mode: "test", withdrawals: [{ ...entry, created_at: "not-a-date" }] },
      { mode: "test", withdrawals: [{ ...entry, expires_at: "2026-10-02" }] },
      { mode: "test", withdrawals: [{ ...entry, posting: "queued" }] },
      { mode: "test", withdrawals: [], extra: true },
      { withdrawals: [entry] },
      { mode: "live", withdrawals: [entry] },
      ["withdrawals"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.withdrawals("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.withdrawals("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api withdrawals KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.withdrawals.read is refused with 403.
      assert.deepEqual(await client.withdrawals("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.withdrawals("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads quotes with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const quotes = [
      {
        quote_id: "qte_0123456789abcdef01234567",
        pair: "USDT/RUB",
        base_asset: "USDT",
        quote_asset: "RUB",
        side: "sell",
        base_amount: "25.000000",
        mid_price: "90.00000000",
        price: "89.77500000",
        spread_bps: 50,
        fee_bps: 30,
        quote_amount: "2244.37",
        fee_amount: "6.74",
        total_quote_amount: "2237.63",
        rounding: "down",
        price_observed_at: "2026-10-02T14:04:57.000Z",
        issued_at: "2026-10-02T14:05:00.000Z",
        expires_at: "2026-10-02T14:05:30.000Z",
        ttl_seconds: 30,
        status: "indicative",
        execution: "not_supported",
        posting: "none"
      }
    ];
    await withFakeApi(
      (request) => ({ mode: "test", quotes }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.quotes("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.quotes, quotes);
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

  it("maps an upstream quotes refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const quotes = JSON.stringify({ mode: "test", quotes: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", quotes }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.quotes("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed quotes bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      quote_id: "qte_0123456789abcdef01234567",
      pair: "USDT/RUB",
      base_asset: "USDT",
      quote_asset: "RUB",
      side: "sell",
      base_amount: "25.000000",
      mid_price: "90.00000000",
      price: "89.77500000",
      spread_bps: 50,
      fee_bps: 30,
      quote_amount: "2244.37",
      fee_amount: "6.74",
      total_quote_amount: "2237.63",
      rounding: "down",
      price_observed_at: "2026-10-02T14:04:57.000Z",
      issued_at: "2026-10-02T14:05:00.000Z",
      expires_at: "2026-10-02T14:05:30.000Z",
      ttl_seconds: 30,
      status: "indicative",
      execution: "not_supported",
      posting: "none"
    };
    for (const body of [
      { mode: "test", quotes: "oops" },
      { mode: "test", quotes: [{ ...entry, extra: true }] },
      { mode: "test", quotes: [{ ...entry, quote_id: "qte_bad" }] },
      { mode: "test", quotes: [{ ...entry, pair: "USDT/EUR" }] },
      { mode: "test", quotes: [{ ...entry, base_asset: "TON" }] },
      { mode: "test", quotes: [{ ...entry, quote_asset: "USDT" }] },
      { mode: "test", quotes: [{ ...entry, side: "hold" }] },
      { mode: "test", quotes: [{ ...entry, side: "buy" }] },
      { mode: "test", quotes: [{ ...entry, rounding: "up" }] },
      { mode: "test", quotes: [{ ...entry, base_amount: "25.0000000" }] },
      { mode: "test", quotes: [{ ...entry, price: "89.775000000" }] },
      { mode: "test", quotes: [{ ...entry, quote_amount: "-2244.37" }] },
      { mode: "test", quotes: [{ ...entry, total_quote_amount: "2237.630" }] },
      { mode: "test", quotes: [{ ...entry, spread_bps: 50.5 }] },
      { mode: "test", quotes: [{ ...entry, fee_bps: 1001 }] },
      { mode: "test", quotes: [{ ...entry, ttl_seconds: 0 }] },
      { mode: "test", quotes: [{ ...entry, ttl_seconds: 301 }] },
      { mode: "test", quotes: [{ ...entry, price: "89.77499999" }] },
      { mode: "test", quotes: [{ ...entry, fee_amount: "6.73" }] },
      { mode: "test", quotes: [{ ...entry, total_quote_amount: "2237.64" }] },
      { mode: "test", quotes: [{ ...entry, price_observed_at: "not-a-date" }] },
      { mode: "test", quotes: [{ ...entry, expires_at: "2026-10-02" }] },
      { mode: "test", quotes: [{ ...entry, expires_at: "2026-10-02T14:05:31.000Z" }] },
      { mode: "test", quotes: [{ ...entry, price_observed_at: "2026-10-02T14:05:01.000Z" }] },
      { mode: "test", quotes: [{ ...entry, status: "executed" }] },
      { mode: "test", quotes: [{ ...entry, execution: "supported" }] },
      { mode: "test", quotes: [{ ...entry, posting: "queued" }] },
      { mode: "test", quotes: [], extra: true },
      { quotes: [entry] },
      { mode: "live", quotes: [entry] },
      ["quotes"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.quotes("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.quotes("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api quotes KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.quotes.read is refused with 403.
      assert.deepEqual(await client.quotes("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.quotes("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads exchange orders with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const orders = [
      {
        order_id: "ord_0123456789abcdef01234567",
        pair: "USDT/RUB",
        base_asset: "USDT",
        quote_asset: "RUB",
        side: "sell",
        order_type: "limit",
        base_amount: "25.000000",
        price: "89.77500000",
        quote_amount: "2244.37",
        fee_bps: 30,
        fee_amount: "6.74",
        total_quote_amount: "2237.63",
        status: "open",
        created_at: "2026-10-02T14:05:00.000Z",
        updated_at: "2026-10-02T14:05:00.000Z",
        execution: "not_supported",
        posting: "none"
      }
    ];
    await withFakeApi(
      (request) => ({ mode: "test", orders }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.exchangeOrders("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.orders, orders);
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

  it("maps an upstream exchange-orders refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const orders = JSON.stringify({ mode: "test", orders: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", orders }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.exchangeOrders("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed exchange-orders bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      order_id: "ord_0123456789abcdef01234567",
      pair: "USDT/RUB",
      base_asset: "USDT",
      quote_asset: "RUB",
      side: "sell",
      order_type: "limit",
      base_amount: "25.000000",
      price: "89.77500000",
      quote_amount: "2244.37",
      fee_bps: 30,
      fee_amount: "6.74",
      total_quote_amount: "2237.63",
      status: "open",
      created_at: "2026-10-02T14:05:00.000Z",
      updated_at: "2026-10-02T14:05:00.000Z",
      execution: "not_supported",
      posting: "none"
    };
    for (const body of [
      { mode: "test", orders: "oops" },
      { mode: "test", orders: [{ ...entry, extra: true }] },
      { mode: "test", orders: [{ ...entry, order_id: "ord_bad" }] },
      { mode: "test", orders: [{ ...entry, pair: "USDT/EUR" }] },
      { mode: "test", orders: [{ ...entry, base_asset: "TON" }] },
      { mode: "test", orders: [{ ...entry, quote_asset: "USDT" }] },
      { mode: "test", orders: [{ ...entry, side: "hold" }] },
      { mode: "test", orders: [{ ...entry, order_type: "stop" }] },
      { mode: "test", orders: [{ ...entry, base_amount: "25.0000000" }] },
      { mode: "test", orders: [{ ...entry, price: "89.775000000" }] },
      { mode: "test", orders: [{ ...entry, quote_amount: "-2244.37" }] },
      { mode: "test", orders: [{ ...entry, total_quote_amount: "2237.630" }] },
      { mode: "test", orders: [{ ...entry, fee_bps: 30.5 }] },
      { mode: "test", orders: [{ ...entry, fee_bps: 1001 }] },
      { mode: "test", orders: [{ ...entry, quote_amount: "2244.38" }] },
      { mode: "test", orders: [{ ...entry, fee_amount: "6.73" }] },
      { mode: "test", orders: [{ ...entry, total_quote_amount: "2237.64" }] },
      { mode: "test", orders: [{ ...entry, created_at: "not-a-date" }] },
      { mode: "test", orders: [{ ...entry, updated_at: "2026-10-02" }] },
      { mode: "test", orders: [{ ...entry, updated_at: "2026-10-02T14:04:00.000Z" }] },
      { mode: "test", orders: [{ ...entry, status: "open", updated_at: "2026-10-02T14:06:00.000Z" }] },
      { mode: "test", orders: [{ ...entry, status: "executed" }] },
      { mode: "test", orders: [{ ...entry, status: "filled" }] },
      { mode: "test", orders: [{ ...entry, execution: "supported" }] },
      { mode: "test", orders: [{ ...entry, posting: "queued" }] },
      { mode: "test", orders: [], extra: true },
      { orders: [entry] },
      { mode: "live", orders: [entry] },
      ["orders"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.exchangeOrders("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.exchangeOrders("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api exchange-orders KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.exchange-orders.read is refused with 403.
      assert.deepEqual(await client.exchangeOrders("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.exchangeOrders("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads payments with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const payments = [
      {
        payment_id: "pay_0123456789abcdef01234567",
        asset: "RUB",
        method: "sbp",
        status: "completed",
        amount: "1500.00",
        fee_amount: "7.50",
        total_amount: "1507.50",
        recipient_reference: "recipient_ref_a1b2c3d4",
        provider_reference: "SIMBANK0123456789ABCDEF",
        created_at: "2026-10-05T11:20:00.000Z",
        updated_at: "2026-10-05T11:24:00.000Z",
        posting: "none"
      }
    ];
    await withFakeApi(
      () => ({ mode: "test", payments }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.payments("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.payments, payments);
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

  it("maps an upstream payments refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const payments = JSON.stringify({ mode: "test", payments: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", payments }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.payments("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed payments bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      payment_id: "pay_0123456789abcdef01234567",
      asset: "RUB",
      method: "sbp",
      status: "completed",
      amount: "1500.00",
      fee_amount: "7.50",
      total_amount: "1507.50",
      recipient_reference: "recipient_ref_a1b2c3d4",
      provider_reference: "SIMBANK0123456789ABCDEF",
      created_at: "2026-10-05T11:20:00.000Z",
      updated_at: "2026-10-05T11:24:00.000Z",
      posting: "none"
    };
    for (const body of [
      { mode: "test", payments: "oops" },
      { mode: "test", payments: [{ ...entry, extra: true }] },
      { mode: "test", payments: [{ ...entry, payment_id: "pay_bad" }] },
      { mode: "test", payments: [{ ...entry, asset: "USDT" }] },
      { mode: "test", payments: [{ ...entry, method: "card" }] },
      { mode: "test", payments: [{ ...entry, status: "settled" }] },
      { mode: "test", payments: [{ ...entry, amount: "1500.0" }] },
      { mode: "test", payments: [{ ...entry, amount: "-1500.00" }] },
      { mode: "test", payments: [{ ...entry, amount: "0.00" }] },
      { mode: "test", payments: [{ ...entry, fee_amount: "0.00" }] },
      { mode: "test", payments: [{ ...entry, total_amount: "1507.51" }] },
      { mode: "test", payments: [{ ...entry, total_amount: "1507.500" }] },
      { mode: "test", payments: [{ ...entry, recipient_reference: "ref_a1b2c3d4" }] },
      { mode: "test", payments: [{ ...entry, provider_reference: "SIMBANKXYZ" }] },
      { mode: "test", payments: [{ ...entry, provider_reference: null }] },
      { mode: "test", payments: [{ ...entry, status: "created" }] },
      { mode: "test", payments: [{ ...entry, status: "created", provider_reference: null }] },
      { mode: "test", payments: [{ ...entry, status: "cancelled", provider_reference: "SIMBANK0123456789ABCDEF" }] },
      { mode: "test", payments: [{ ...entry, created_at: "not-a-date" }] },
      { mode: "test", payments: [{ ...entry, updated_at: "2026-10-05" }] },
      { mode: "test", payments: [{ ...entry, updated_at: "2026-10-05T11:10:00.000Z" }] },
      { mode: "test", payments: [{ ...entry, posting: "queued" }] },
      { mode: "test", payments: [], extra: true },
      { payments: [entry] },
      { mode: "live", payments: [entry] },
      ["payments"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.payments("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.payments("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api payments KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.payments.read is refused with 403.
      assert.deepEqual(await client.payments("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.payments("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads cards with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const cards = [
      {
        card_id: "crd_0123456789abcdef01234567",
        brand: "mir",
        kind: "physical",
        status: "active",
        last4: "4832",
        token_reference: "tok_0123456789abcdef01234567",
        asset: "RUB",
        monthly_limit: "250000.00",
        created_at: "2026-09-12T10:00:00.000Z",
        expires_at: "2029-09-12T00:00:00.000Z",
        updated_at: "2026-09-12T10:05:00.000Z",
        posting: "none"
      }
    ];
    await withFakeApi(
      () => ({ mode: "test", cards }),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.cards("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result.cards, cards);
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

  it("maps an upstream cards refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const cards = JSON.stringify({ mode: "test", cards: [] });
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER", cards }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.cards("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed cards bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      card_id: "crd_0123456789abcdef01234567",
      brand: "mir",
      kind: "physical",
      status: "active",
      last4: "4832",
      token_reference: "tok_0123456789abcdef01234567",
      asset: "RUB",
      monthly_limit: "250000.00",
      created_at: "2026-09-12T10:00:00.000Z",
      expires_at: "2029-09-12T00:00:00.000Z",
      updated_at: "2026-09-12T10:05:00.000Z",
      posting: "none"
    };
    for (const body of [
      { mode: "test", cards: "oops" },
      { mode: "test", cards: [{ ...entry, extra: true }] },
      // Any field that could smuggle a full PAN must fail closed: the exact
      // key set is the only PAN boundary the contract exposes.
      { mode: "test", cards: [{ ...entry, pan: "2202200243214832" }] },
      { mode: "test", cards: [{ ...entry, card_number: "2202200243214832" }] },
      { mode: "test", cards: [{ ...entry, card_id: "crd_bad" }] },
      { mode: "test", cards: [{ ...entry, brand: "amex" }] },
      { mode: "test", cards: [{ ...entry, kind: "sticker" }] },
      { mode: "test", cards: [{ ...entry, status: "activated" }] },
      { mode: "test", cards: [{ ...entry, last4: "483" }] },
      { mode: "test", cards: [{ ...entry, last4: "48320" }] },
      { mode: "test", cards: [{ ...entry, last4: "48x2" }] },
      { mode: "test", cards: [{ ...entry, last4: "2202200243214832" }] },
      { mode: "test", cards: [{ ...entry, token_reference: "tok_bad" }] },
      { mode: "test", cards: [{ ...entry, asset: "USDT" }] },
      { mode: "test", cards: [{ ...entry, monthly_limit: "250000.0" }] },
      { mode: "test", cards: [{ ...entry, monthly_limit: "-250000.00" }] },
      { mode: "test", cards: [{ ...entry, monthly_limit: "0.00" }] },
      { mode: "test", cards: [{ ...entry, created_at: "not-a-date" }] },
      { mode: "test", cards: [{ ...entry, expires_at: "2026-09-12T09:00:00.000Z" }] },
      { mode: "test", cards: [{ ...entry, updated_at: "2026-09-12T09:00:00.000Z" }] },
      { mode: "test", cards: [{ ...entry, status: "pending_activation" }] },
      { mode: "test", cards: [{ ...entry, status: "expired" }] },
      { mode: "test", cards: [{ ...entry, posting: "queued" }] },
      { mode: "test", cards: [], extra: true },
      { cards: [entry] },
      { mode: "live", cards: [entry] },
      ["cards"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.cards("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.cards("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api cards KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.cards.read is refused with 403.
      assert.deepEqual(await client.cards("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.cards("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads notifications with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const feed = {
      mode: "test",
      delivery: "disabled",
      unread: 1,
      notifications: [
        {
          notification_id: "ntf_0123456789abcdef01234567",
          created_at: "2026-10-01T12:00:00.000Z",
          channel: "telegram-draft",
          template: "kyc_approved",
          locale: "ru",
          text: "Тестовый режим. Проверка личности пройдена.",
          mode: "test",
          delivered: false,
          read: false
        },
        {
          notification_id: "ntf_fedcba9876543210fedcba98",
          created_at: "2026-09-30T12:00:00.000Z",
          channel: "telegram-draft",
          template: "session_login",
          locale: "ru",
          text: "Тестовый режим. Выполнен вход в SOLID.",
          mode: "test",
          delivered: false,
          read: true
        }
      ]
    };
    await withFakeApi(
      () => feed,
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.notifications("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result, { status: "ok", unread: feed.unread, notifications: feed.notifications });
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

  it("maps an upstream notifications refusal to denied and every other failure to unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    const statuses: [number, "denied" | "unavailable"][] = [[403, "denied"], [401, "unavailable"], [429, "unavailable"], [500, "unavailable"]];
    for (const [status, expected] of statuses) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER" }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.notifications("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, expected, String(status));
        assert.deepEqual(result, { status: expected });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed notifications bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const entry = {
      notification_id: "ntf_0123456789abcdef01234567",
      created_at: "2026-10-01T12:00:00.000Z",
      channel: "telegram-draft",
      template: "session_login",
      locale: "ru",
      text: "Тестовый режим. Выполнен вход в SOLID.",
      mode: "test",
      delivered: false,
      read: false
    };
    const view = { mode: "test", delivery: "disabled", unread: 1, notifications: [entry] };
    for (const body of [
      { notifications: [] },
      { ...view, extra: true },
      { ...view, mode: "live" },
      { ...view, delivery: "enabled" },
      { ...view, unread: -1 },
      { ...view, unread: 1.5 },
      { ...view, unread: "1" },
      { ...view, notifications: "oops" },
      { ...view, notifications: [{ ...entry, extra: true }] },
      { ...view, notifications: [{ ...entry, notification_id: "syn_cust_0123456789abcdef" }] },
      { ...view, notifications: [{ ...entry, notification_id: 42 }] },
      { ...view, notifications: [{ ...entry, created_at: "tomorrow" }] },
      { ...view, notifications: [{ ...entry, created_at: "2026-10-01T12:00:00Z" }] },
      { ...view, notifications: [{ ...entry, created_at: "2026-13-40T12:00:00.000Z" }] },
      { ...view, notifications: [{ ...entry, channel: "telegram" }] },
      { ...view, notifications: [{ ...entry, template: "made_up" }] },
      { ...view, notifications: [{ ...entry, locale: "en" }] },
      { ...view, notifications: [{ ...entry, text: "" }] },
      { ...view, notifications: [{ ...entry, text: "x".repeat(129) }] },
      { ...view, notifications: [{ ...entry, mode: "live" }] },
      { ...view, notifications: [{ ...entry, delivered: true }] },
      { ...view, notifications: [{ ...entry, read: "yes" }] },
      { ...view, notifications: [{ notification_id: entry.notification_id }] },
      { ...view, notifications: [] , unread: 0, extra: true },
      ["notifications"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.notifications("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.notifications("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("surfaces the dev customer-api notifications KYC gate as denied and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The dev customer-api's synthetic KYC directory marks every subject
      // unverified, so customer.notifications.read is refused with 403.
      assert.deepEqual(await client.notifications("tg-0123456789abcdef", Date.now()), { status: "denied" });
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.notifications("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads the kyc status with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const view = {
      mode: "test",
      provider: "simulator",
      session_kyc: "unverified",
      status: "rejected",
      application_id: "kyc_0123456789abcdef01234567",
      submitted_at: "2026-10-01T12:00:00.000Z",
      updated_at: "2026-10-02T12:00:00.000Z",
      reason_codes: ["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"],
      can_submit: true
    };
    await withFakeApi(
      () => view,
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.kyc("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result, { status: "ok", view });
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

  it("maps every kyc read failure to unavailable, including an upstream 403", async () => {
    const key = randomBytes(32).toString("hex");
    // customer.kyc.read is granted at every upstream session status, so even a
    // 403 is contract drift, not a real capability denial: there is no denied
    // arm and every non-200 outcome fails closed to "unavailable".
    for (const status of [403, 401, 429, 500]) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER" }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.kyc("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "unavailable", String(status));
        assert.deepEqual(result, { status: "unavailable" });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed kyc bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const view = {
      mode: "test",
      provider: "simulator",
      session_kyc: "unverified",
      status: "rejected",
      application_id: "kyc_0123456789abcdef01234567",
      submitted_at: "2026-10-01T12:00:00.000Z",
      updated_at: "2026-10-02T12:00:00.000Z",
      reason_codes: ["SIM_DOCUMENT_UNREADABLE"],
      can_submit: true
    };
    for (const body of [
      { ...view, extra: true },
      { ...view, mode: "live" },
      { ...view, provider: "live" },
      { ...view, session_kyc: "kyc-gated" },
      { ...view, session_kyc: 42 },
      { ...view, status: "needs_review" },
      { ...view, status: 42 },
      { ...view, updated_at: "tomorrow" },
      { ...view, updated_at: "2026-10-02T12:00:00Z" },
      { ...view, updated_at: "2026-13-40T12:00:00.000Z" },
      { ...view, can_submit: "yes" },
      { mode: "test", provider: "simulator", session_kyc: "unverified", status: "not_started", updated_at: "2026-10-02T12:00:00.000Z" },
      { ...view, application_id: "syn_cust_0123456789abcdef" },
      { ...view, application_id: 42 },
      { ...view, submitted_at: "last week" },
      { mode: "test", provider: "simulator", session_kyc: "unverified", status: "rejected", updated_at: "2026-10-02T12:00:00.000Z", can_submit: true, submitted_at: "2026-10-01T12:00:00.000Z" },
      { mode: "test", provider: "simulator", session_kyc: "unverified", status: "rejected", updated_at: "2026-10-02T12:00:00.000Z", can_submit: true, application_id: "kyc_0123456789abcdef01234567" },
      { ...view, review_deadline: "soon" },
      { ...view, reason_codes: [] },
      { ...view, reason_codes: ["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH", "SIM_DOCUMENT_UNREADABLE"] },
      { ...view, reason_codes: ["SIM_DOCUMENT_UNREADABLE", "SIM_DOCUMENT_UNREADABLE"] },
      { ...view, reason_codes: ["REAL_CODE"] },
      { ...view, reason_codes: "SIM_DOCUMENT_UNREADABLE" },
      { ...view, requested_items: [] },
      { ...view, requested_items: ["proof_of_address", "selfie_retake", "proof_of_address"] },
      { ...view, requested_items: ["proof_of_address", "proof_of_address"] },
      { ...view, requested_items: ["passport"] },
      ["kyc"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.kyc("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.kyc("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("reads the kyc status from the dev customer-api without a KYC gate and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // customer.kyc.read is granted at every session status: the dev
      // customer-api's synthetic KYC directory marks every subject unverified
      // yet still answers 200 with the deterministic unverified-bucket view.
      const first = await client.kyc("tg-0123456789abcdef", Date.now());
      assert.equal(first.status, "ok");
      if (first.status !== "ok") return;
      assert.equal(first.view.mode, "test");
      assert.equal(first.view.provider, "simulator");
      assert.equal(first.view.session_kyc, "unverified");
      assert.match(first.view.status, /^(not_started|rejected|needs_more_data|timed_out|unavailable)$/);
      assert.match(first.view.updated_at, isoTimestamp);
      assert.equal(typeof first.view.can_submit, "boolean");
      assert.deepEqual(await client.kyc("tg-0123456789abcdef", Date.now()), first);
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.kyc("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads the profile with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const view = {
      mode: "test",
      customer_ref: "SC-DEV-PRF01",
      display_name: "Customer 0123abcd",
      locale: "ru",
      registered_at: "2026-09-01T12:00:00.000Z"
    };
    await withFakeApi(
      () => view,
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.profile("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result, { status: "ok", view });
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

  it("maps every profile read failure to unavailable, including an upstream 403", async () => {
    const key = randomBytes(32).toString("hex");
    // customer.profile.read is granted at every upstream session status, so
    // even a 403 is contract drift, not a real capability denial: there is no
    // denied arm and every non-200 outcome fails closed to "unavailable".
    for (const status of [403, 401, 429, 500]) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER" }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.profile("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "unavailable", String(status));
        assert.deepEqual(result, { status: "unavailable" });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed profile bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const view = {
      mode: "test",
      customer_ref: "SC-DEV-PRF01",
      display_name: "Customer 0123abcd",
      locale: "ru",
      registered_at: "2026-09-01T12:00:00.000Z"
    };
    for (const body of [
      { ...view, extra: true },
      { ...view, mode: "live" },
      { ...view, customer_ref: "SC-PROD-PRF01" },
      { ...view, customer_ref: "SC-DEV-prf01" },
      { ...view, customer_ref: "SC-DEV-PRF011" },
      { ...view, customer_ref: 42 },
      { ...view, display_name: "" },
      { ...view, display_name: "Тестовый клиент" },
      { ...view, display_name: "Customer 0123ABCD" },
      { ...view, display_name: "Customer 0123abc" },
      { ...view, display_name: 42 },
      { ...view, locale: "de" },
      { ...view, locale: "RU" },
      { ...view, locale: 42 },
      { ...view, registered_at: "tomorrow" },
      { ...view, registered_at: "2026-09-01T12:00:00Z" },
      { ...view, registered_at: "2026-13-40T12:00:00.000Z" },
      { ...view, registered_at: 42 },
      { mode: "test", customer_ref: "SC-DEV-PRF01", display_name: "Customer 0123abcd", locale: "ru" },
      ["profile"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.profile("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.profile("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("reads the profile from the dev customer-api without a KYC gate and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // customer.profile.read is granted at every session status: the dev
      // customer-api answers 200 with the deterministic synthetic identity
      // view even though its KYC directory marks every subject unverified.
      const first = await client.profile("tg-0123456789abcdef", Date.now());
      assert.equal(first.status, "ok");
      if (first.status !== "ok") return;
      assert.equal(first.view.mode, "test");
      assert.match(first.view.customer_ref, /^SC-DEV-[0-9A-Z]{5}$/);
      assert.match(first.view.display_name, /^Customer [0-9a-f]{8}$/);
      assert.match(first.view.locale, /^(en|ky|ru)$/);
      assert.match(first.view.registered_at, isoTimestamp);
      assert.deepEqual(await client.profile("tg-0123456789abcdef", Date.now()), first);
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.profile("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
  });

  it("reads the support tickets with the canonical headers through the contract seam", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("tg-0123456789abcdef");
    const view = {
      mode: "test",
      delivery: "disabled",
      tickets: [
        {
          ticket_id: "tck_0123456789abcdef01234567",
          category: "complaint",
          topic: "Тестовый режим. Жалоба на обслуживание.",
          message: "Тестовый режим. Синтетическая жалоба, её никто не получит.",
          status: "in_review",
          timeline: [
            { status: "received", at: "2026-10-01T12:00:00.000Z" },
            { status: "in_review", at: "2026-10-01T13:00:00.000Z" }
          ],
          complaint_acknowledged: true,
          created_at: "2026-10-01T12:00:00.000Z",
          expires_at: "2026-10-02T12:00:00.000Z"
        }
      ]
    };
    await withFakeApi(
      () => view,
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.support("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "ok");
        if (result.status !== "ok") return;
        assert.deepEqual(result, { status: "ok", view });
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

  it("maps every support read failure to unavailable, including an upstream 403", async () => {
    const key = randomBytes(32).toString("hex");
    // customer.support.read is granted at every upstream session status, so
    // even a 403 is contract drift, not a real capability denial: there is no
    // denied arm and every non-200 outcome fails closed to "unavailable".
    for (const status of [403, 401, 429, 500]) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "application/json");
        response.statusCode = status;
        response.end(JSON.stringify({ code: "SYNTHETIC_UPSTREAM_MARKER" }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const client = createCustomerApiClient({
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          devTokenKey: key
        });
        const result = await client.support("tg-0123456789abcdef", Date.now());
        assert.equal(result.status, "unavailable", String(status));
        assert.deepEqual(result, { status: "unavailable" });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on malformed support bodies without leaking upstream fields", async () => {
    const key = randomBytes(32).toString("hex");
    const ticket = {
      ticket_id: "tck_0123456789abcdef01234567",
      category: "complaint",
      topic: "Тестовый режим. Жалоба на обслуживание.",
      message: "Тестовый режим. Синтетическая жалоба, её никто не получит.",
      status: "in_review",
      timeline: [
        { status: "received", at: "2026-10-01T12:00:00.000Z" },
        { status: "in_review", at: "2026-10-01T13:00:00.000Z" }
      ],
      complaint_acknowledged: true,
      created_at: "2026-10-01T12:00:00.000Z",
      expires_at: "2026-10-02T12:00:00.000Z"
    };
    const view = { mode: "test", delivery: "disabled", tickets: [ticket] };
    for (const body of [
      { ...view, extra: true },
      { ...view, mode: "live" },
      { ...view, delivery: "telegram" },
      { ...view, tickets: {} },
      { mode: "test", delivery: "disabled" },
      { ...view, tickets: [{ ...ticket, extra: true }] },
      { ...view, tickets: [{ ...ticket, ticket_id: "sup_0123456789abcdef01234567" }] },
      { ...view, tickets: [{ ...ticket, ticket_id: "tck_0123456789ABCDEF01234567" }] },
      { ...view, tickets: [{ ...ticket, ticket_id: 42 }] },
      { ...view, tickets: [{ ...ticket, category: "refund" }] },
      { ...view, tickets: [{ ...ticket, category: 42 }] },
      { ...view, tickets: [{ ...ticket, topic: "" }] },
      { ...view, tickets: [{ ...ticket, topic: "a".repeat(121) }] },
      { ...view, tickets: [{ ...ticket, topic: 42 }] },
      { ...view, tickets: [{ ...ticket, message: "" }] },
      { ...view, tickets: [{ ...ticket, message: "a".repeat(1_001) }] },
      { ...view, tickets: [{ ...ticket, status: "escalated" }] },
      { ...view, tickets: [{ ...ticket, status: "received" }] },
      { ...view, tickets: [{ ...ticket, timeline: [] }] },
      { ...view, tickets: [{ ...ticket, timeline: {} }] },
      { ...view, tickets: [{ ...ticket, timeline: [{ status: "in_review", at: "2026-10-01T13:00:00.000Z", note: "x" }] }] },
      { ...view, tickets: [{ ...ticket, timeline: [{ status: "escalated", at: "2026-10-01T13:00:00.000Z" }] }] },
      { ...view, tickets: [{ ...ticket, timeline: [{ status: "in_review", at: "soon" }] }] },
      { ...view, tickets: [{ ...ticket, complaint_acknowledged: "yes" }] },
      { ...view, tickets: [{ ...ticket, created_at: "last week" }] },
      { ...view, tickets: [{ ...ticket, created_at: "2026-10-01T12:00:00Z" }] },
      { ...view, tickets: [{ ...ticket, expires_at: "2026-13-40T12:00:00.000Z" }] },
      ["support"],
      42
    ]) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.support("tg-0123456789abcdef", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
    const unreachable = createCustomerApiClient({ baseUrl: "http://127.0.0.1:9", devTokenKey: key, timeoutMs: 500 });
    assert.deepEqual(await unreachable.support("tg-0123456789abcdef", Date.now()), { status: "unavailable" });
  });

  it("reads the support tickets from the dev customer-api without a KYC gate and not-configured when unset", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // customer.support.read is granted at every session status: the dev
      // customer-api answers 200 with the deterministic synthetic ticket list
      // even though its KYC directory marks every subject unverified.
      const first = await client.support("tg-0123456789abcdef", Date.now());
      assert.equal(first.status, "ok");
      if (first.status !== "ok") return;
      assert.equal(first.view.mode, "test");
      assert.equal(first.view.delivery, "disabled");
      assert.ok(first.view.tickets.length >= 1);
      for (const ticket of first.view.tickets) {
        assert.match(ticket.ticket_id, /^tck_[0-9a-f]{24}$/);
        assert.match(ticket.category, /^(question|operation_problem|complaint|data_request)$/);
        assert.match(ticket.status, /^(received|in_review|answered|closed)$/);
        assert.equal(ticket.timeline.at(-1)?.status, ticket.status);
        assert.equal(typeof ticket.complaint_acknowledged, "boolean");
        assert.match(ticket.created_at, isoTimestamp);
        assert.match(ticket.expires_at, isoTimestamp);
      }
      assert.deepEqual(await client.support("tg-0123456789abcdef", Date.now()), first);
    });
    const unconfigured = createCustomerApiClient({});
    assert.deepEqual(await unconfigured.support("tg-0123456789abcdef", Date.now()), { status: "not-configured" });
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
