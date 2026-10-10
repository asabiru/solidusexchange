import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { ChecksView } from "../shared/api.js";
import { checkReferencePattern, isCheckStatus } from "../shared/checks.js";
import { createCheckBook } from "./checks.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import {
  type CustomerApiCheck,
  type CustomerApiChecks,
  type CustomerApiClient,
  customerApiSubject
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "chk_9e9e9e9e9e9e9e9e9e9e9e9e";
const now = 1_790_000_000_000;
const devSubject = `dev-${createHash("sha256")
  .update("solidchange-miniapp-dev-synthetic|900000001")
  .digest("hex")
  .slice(0, 16)}`;
const upstreamSubject = customerApiSubject(devSubject);
const localBook = createCheckBook({ clock: () => now });

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

interface ChecksStub {
  client: CustomerApiClient;
  calls: string[];
}

function checksStub(
  result: CustomerApiChecks | (() => Promise<CustomerApiChecks>)
): ChecksStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async () => ({ status: "not-configured" }),
    cards: async () => ({ status: "not-configured" }),
    checks: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
        users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: ChecksStub): Promise<Running> {
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

function upstreamCheck(overrides: Partial<CustomerApiCheck> = {}): CustomerApiCheck {
  return {
    check_id: "chk_0123456789abcdef01234567",
    check_type: "personal",
    status: "created",
    sender_ref: upstreamSubject,
    recipient_ref: "syn_peer_0123456789ab",
    amount: "25.000000",
    asset: "USDT",
    fee_amount: "0.075000",
    outstanding_amount: "25.000000",
    created_at: "2026-10-08T09:15:00.000Z",
    expires_at: "2026-10-11T09:15:00.000Z",
    resolved_at: null,
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/checks through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/checks");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = checksStub({
      status: "ok",
      checks: [upstreamCheck({ check_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/checks", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as ChecksView;
      assert.deepEqual(view, localBook.list("kyc-gated"));
      assert.equal(view.mode, "test");
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/checks", cookie)).json() as ChecksView;
      assert.deepEqual(view, localBook.list("verified"));
      assert.equal(view.mode, "test");
      for (const check of view.checks) {
        assert.match(check.reference, checkReferencePattern);
        assert.ok(isCheckStatus(check.status));
        assert.equal(check.mode, "test");
        assert.equal(check.claimRule, "personal");
        assert.equal(check.executable, false);
        assert.equal(check.executionUnavailableReason, "dev_test_version");
        assert.ok(check.expiresAt > check.createdAt);
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract checks view into the app's checks shape", async () => {
    const stub = checksStub({
      status: "ok",
      checks: [
        upstreamCheck({ check_id: marker }),
        upstreamCheck({
          check_id: "chk_fedcba9876543210fedcba98",
          status: "awaiting_recipient_kyc",
          sender_ref: "syn_peer_fedcba987654",
          recipient_ref: upstreamSubject,
          amount: "4.000000000",
          asset: "TON",
          fee_amount: "0.012000000",
          outstanding_amount: "4.000000000"
        }),
        upstreamCheck({
          check_id: "chk_111111111111111111111111",
          status: "claimed",
          outstanding_amount: "0.000000",
          resolved_at: "2026-10-09T10:15:00.000Z"
        }),
        // A sender-side draft never becomes a Mini App check: the
        // awaiting_confirmation entry is dropped from the served list.
        upstreamCheck({
          check_id: "chk_222222222222222222222222",
          status: "awaiting_confirmation",
          outstanding_amount: "0.000000"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/checks", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      for (const leaked of ["check_id", "sender_ref", "recipient_ref", "fee_amount", "outstanding_amount", "created_at", "expires_at", "resolved_at", "chk_222222222222222222222222"]) {
        assert.equal(text.includes(leaked), false, `${leaked} must not leak into the app view`);
      }
      const view = JSON.parse(text) as ChecksView;
      assert.deepEqual(Object.keys(view).sort(), ["checks", "mode"]);
      assert.equal(view.mode, "test");
      assert.equal(view.checks.length, 3);
      for (const check of view.checks) {
        assert.deepEqual(Object.keys(check).sort(), [
          "amount",
          "asset",
          "claimRule",
          "createdAt",
          "direction",
          "executable",
          "executionUnavailableReason",
          "expiresAt",
          "fee",
          "mode",
          "reference",
          "status",
          "timeline",
          "total"
        ]);
        assert.match(check.reference, checkReferencePattern);
        assert.ok(isCheckStatus(check.status));
        assert.equal(check.mode, "test");
        assert.equal(check.claimRule, "personal");
        assert.equal(check.executable, false);
        assert.equal(check.executionUnavailableReason, "dev_test_version");
        assert.equal(check.timeline[0].status, "created");
        assert.equal(check.timeline[0].at, check.createdAt);
        assert.ok(check.expiresAt > check.createdAt);
      }
      const [sent, received, claimed] = view.checks;
      assert.equal(sent.reference, marker);
      assert.equal(sent.direction, "sent");
      assert.equal(sent.status, "created");
      assert.equal(sent.asset, "USDT");
      assert.equal(sent.amount, "25.000000");
      assert.equal(sent.fee, "0.075000");
      assert.equal(sent.total, "25.075000");
      assert.equal(sent.createdAt, Date.parse("2026-10-08T09:15:00.000Z"));
      assert.equal(sent.expiresAt, Date.parse("2026-10-11T09:15:00.000Z"));
      assert.equal(sent.timeline.length, 1);
      assert.equal(received.direction, "received");
      assert.equal(received.status, "awaiting_recipient_kyc");
      assert.equal(received.asset, "TON");
      assert.equal(received.total, "4.012000000");
      assert.equal(claimed.direction, "sent");
      assert.equal(claimed.status, "claimed");
      assert.equal(claimed.timeline.length, 2);
      assert.equal(claimed.timeline[1].status, "claimed");
      assert.equal(claimed.timeline[1].at, Date.parse("2026-10-09T10:15:00.000Z"));
      assert.deepEqual(stub.calls, [devSubject]);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream checks refusal (403) to the gated view", async () => {
    const stub = checksStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/checks", gatedCookie)).json() as ChecksView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/checks", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to checks_unavailable on upstream outage without leaking the body", async () => {
    const stub = checksStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/checks", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("syn_peer_"), false);
      assert.equal(text.includes("chk_"), false);
      assert.deepEqual(JSON.parse(text), { error: "checks_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiChecks = { status: "unavailable" };
    const stub = checksStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/checks", cookie)).status, 503);
      result = {
        status: "ok",
        checks: [upstreamCheck({ check_id: "chk_5ec0de5ec0de5ec0de5ec0de" })]
      };
      const view = await (await get(running.base, "/bff/checks", cookie)).json() as ChecksView;
      assert.equal(view.mode, "test");
      assert.deepEqual(view.checks.map((check) => check.reference), ["chk_5ec0de5ec0de5ec0de5ec0de"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
