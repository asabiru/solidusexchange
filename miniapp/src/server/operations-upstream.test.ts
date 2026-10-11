import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { OperationDetail, OperationSummary } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  type CustomerApiClient,
  type CustomerApiOperation,
  type CustomerApiOperationItem,
  type CustomerApiOperations,
  customerApiSubject
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "ope_9e9e9e9e9e9e9e9e9e9e9e9e";
const now = 1_790_000_000_000;
const devSubject = `dev-${createHash("sha256")
  .update("solidchange-miniapp-dev-synthetic|900000001")
  .digest("hex")
  .slice(0, 16)}`;
const upstreamSubject = customerApiSubject(devSubject);

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    ...loadServerConfig({ MINIAPP_ALLOW_DEV_LOGIN: "true" }),
    ...overrides
  };
}

interface Running {
  base: string;
  close: () => Promise<void>;
}

interface OperationsStub {
  client: CustomerApiClient;
  listCalls: string[];
  detailCalls: string[];
}

function operationsStub(
  list: CustomerApiOperations | (() => Promise<CustomerApiOperations>),
  detail: CustomerApiOperation | ((id: string) => Promise<CustomerApiOperation>) = { status: "not-found" }
): OperationsStub {
  const listCalls: string[] = [];
  const detailCalls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    trades: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async () => ({ status: "not-configured" }),
    depositAddresses: async () => ({ status: "not-configured" }),
    addressScreenings: async () => ({ status: "not-configured" }),
    addressScreening: async () => ({ status: "not-configured" }),
    activity: async () => ({ status: "not-configured" }),
    operations: async (subject) => {
      listCalls.push(subject);
      return typeof list === "function" ? list() : list;
    },
    operation: async (subject, id) => {
      detailCalls.push(`${subject}|${id}`);
      return typeof detail === "function" ? detail(id) : detail;
    },
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
    users: async () => ({ status: "not-configured" })
  };
  return { client, listCalls, detailCalls };
}

async function start(serverConfig: ServerConfig, stub?: OperationsStub): Promise<Running> {
  const server = createMiniappServer(serverConfig, {
    clock: () => now,
    ...(stub ? { customerApi: stub.client } : {})
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body)
  });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return cookieOf(response);
}

async function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
}

function upstreamItem(overrides: Partial<CustomerApiOperationItem> = {}): CustomerApiOperationItem {
  return {
    operation_id: marker,
    reference: "SCX-90001",
    kind: "exchange",
    status: "open",
    title: "Exchange USDT → RUB",
    channel: "miniapp",
    legs: [
      { asset: "USDT", amount: "10.000000", direction: "out" },
      { asset: "RUB", amount: "950.00", direction: "in" }
    ],
    fee_amount: "0.050000",
    fee_asset: "USDT",
    exchange: { base_asset: "USDT", quote_asset: "RUB", rate: "95.000000" },
    note: "Synthetic exchange operation",
    timeline: [
      { title: "Draft", detail: "Operation created", at: "2026-10-08T09:15:00.000Z", state: "done" },
      { title: "Review", detail: "Awaiting confirmation", at: "2026-10-08T09:16:00.000Z", state: "current" },
      { title: "Settled", detail: "Legs settle", at: null, state: "pending" }
    ],
    created_at: "2026-10-08T09:15:00.000Z",
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/operations through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/operations");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("keeps the local view for a kyc-gated session without consulting upstream", async () => {
    const stub = operationsStub({ status: "ok", operations: [upstreamItem()] });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/operations", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      assert.deepEqual(JSON.parse(text), { operations: [] });
      assert.equal(stub.listCalls.length, 0, "gated sessions must not reach upstream");
      const detail = await get(running.base, `/bff/operations/${marker}`, cookie);
      assert.equal(detail.status, 404);
      assert.equal(stub.detailCalls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("keeps the local view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/operations", cookie);
      assert.equal(response.status, 200);
      const view = JSON.parse(await response.text()) as { operations: OperationSummary[] };
      assert.ok(view.operations.length >= 1);
      for (const item of view.operations) {
        assert.equal(/^ope_[0-9a-f]{24}$/u.test(item.id), false, "local ids keep their own family");
        assert.deepEqual(Object.keys(item).sort(), ["channel", "createdAt", "id", "kind", "legs", "reference", "status", "title"]);
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract operations view into the app's summary shape", async () => {
    const stub = operationsStub({
      status: "ok",
      operations: [
        upstreamItem(),
        upstreamItem({
          operation_id: "ope_fedcba9876543210fedcba98",
          reference: "SCX-90002",
          kind: "withdrawal",
          status: "unsigned_intent_ready",
          legs: [{ asset: "TON", amount: "4.000000000", direction: "out" }],
          fee_amount: "0.000000000",
          fee_asset: "TON",
          exchange: null,
          created_at: "2026-10-09T09:15:00.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/operations", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["operation_id", "created_at", "posting", "fee_amount", "fee_asset", "base_asset", "quote_asset", upstreamSubject]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as { operations: OperationSummary[] };
      assert.equal(view.operations.length, 2);
      const [first, second] = view.operations;
      assert.equal(first.id, marker);
      assert.equal(first.reference, "SCX-90001");
      assert.equal(first.kind, "exchange");
      assert.equal(first.status, "in-review", "in-flight lifecycle states collapse to in-review");
      assert.equal(first.createdAt, "2026-10-08T09:15:00.000Z");
      assert.equal(first.legs.length, 2);
      assert.deepEqual(first.legs[0], { asset: "USDT", amount: "10.000000", direction: "out" });
      assert.equal(second.kind, "withdrawal");
      assert.equal(second.status, "needs-action", "customer-action states collapse to needs-action");
      assert.equal(second.legs.length, 1);
      assert.deepEqual(stub.listCalls, [devSubject]);
    } finally {
      await running.close();
    }
  });

  it("degrades in place on a denied upstream read", async () => {
    const stub = operationsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/operations", cookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { operations: [] });
      assert.equal(stub.listCalls.length, 1, "verified sessions still consult upstream");
    } finally {
      await running.close();
    }
  });

  it("fails closed as operations_unavailable on every other non-ok outcome", async () => {
    for (const result of [{ status: "unavailable" }, { status: "not-configured" }] as const) {
      const stub = operationsStub(result);
      const running = await start(config(), stub);
      try {
        const cookie = await devLogin(running.base, "verified");
        const response = await get(running.base, "/bff/operations", cookie);
        assert.equal(response.status, 503);
        const text = await response.text();
        assert.equal(text.includes(marker), false);
        assert.equal(text.includes("ope_"), false);
        assert.deepEqual(JSON.parse(text), { error: "operations_unavailable" });
      } finally {
        await running.close();
      }
    }
  });
});

describe("GET /bff/operations/:id through the customer-api seam", () => {
  it("adapts one contract operation into the app's detail shape", async () => {
    const stub = operationsStub({ status: "unavailable" }, { status: "ok", operation: upstreamItem() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, `/bff/operations/${marker}`, cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["operation_id", "created_at", "posting", "fee_amount", "base_asset", upstreamSubject]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as OperationDetail;
      assert.equal(view.id, marker);
      assert.equal(view.status, "in-review");
      assert.deepEqual(view.fee, { asset: "USDT", amount: "0.050000" });
      assert.deepEqual(view.rate, { base: "USDT", quote: "RUB", value: "95.000000" });
      assert.equal(view.note, "Synthetic exchange operation");
      assert.equal(view.timeline.length, 3);
      assert.equal(view.timeline[1].at, "2026-10-08T09:16:00.000Z");
      assert.equal(view.timeline[2].at, undefined, "a null upstream timestamp drops the optional field");
      assert.equal(stub.detailCalls.length, 1);
      assert.deepEqual(stub.detailCalls, [`${devSubject}|${marker}`]);
    } finally {
      await running.close();
    }
  });

  it("keeps the local 404 on an upstream not-found or a malformed id", async () => {
    const stub = operationsStub({ status: "unavailable" }, { status: "not-found" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      for (const path of [`/bff/operations/${marker}`, "/bff/operations/not-an-id"]) {
        const response = await get(running.base, path, cookie);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "not_found" });
      }
      // The client itself short-circuits a malformed id, so only the
      // well-formed miss reaches the stubbed upstream.
      assert.equal(stub.detailCalls.length >= 1, true);
    } finally {
      await running.close();
    }
  });

  it("degrades to the gated local 404 on a denied read and 503s on other non-ok", async () => {
    const stub = operationsStub({ status: "unavailable" }, { status: "denied" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, `/bff/operations/${marker}`, cookie);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
    } finally {
      await running.close();
    }
    const unavailable = operationsStub({ status: "unavailable" }, { status: "unavailable" });
    const second = await start(config(), unavailable);
    try {
      const cookie = await devLogin(second.base, "verified");
      const response = await get(second.base, `/bff/operations/${marker}`, cookie);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "operations_unavailable" });
    } finally {
      await second.close();
    }
  });
});
