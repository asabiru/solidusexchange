import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { KycVerificationView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type {
  CustomerApiClient,
  CustomerApiKyc,
  CustomerApiKycStatusView
} from "./customer-api-client.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "kyc_upstreammarker000000";
let now = 1_790_000_000_000;

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

interface KycStub {
  client: CustomerApiClient;
  calls: string[];
}

function kycStub(result: CustomerApiKyc | (() => Promise<CustomerApiKyc>)): KycStub {
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
    notifications: async () => ({ status: "unavailable" }),
    kyc: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
        users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: KycStub): Promise<Running> {
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

function upstreamView(overrides: Partial<CustomerApiKycStatusView> = {}): CustomerApiKycStatusView {
  return {
    mode: "test",
    provider: "simulator",
    session_kyc: "unverified",
    status: "rejected",
    application_id: marker,
    submitted_at: "2026-10-01T12:00:00.000Z",
    updated_at: "2026-10-02T12:00:00.000Z",
    reason_codes: ["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"],
    can_submit: true,
    ...overrides
  };
}

describe("GET /bff/kyc/status through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/kyc/status");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for gated and verified sessions without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const gated = await devLogin(running.base, "kyc-gated");
      const gatedView = await (await get(running.base, "/bff/kyc/status", gated)).json() as KycVerificationView;
      assert.equal(gatedView.mode, "test");
      assert.equal(gatedView.provider, "simulator");
      assert.equal(gatedView.state, "not_started");
      assert.equal(gatedView.sessionKyc, "kyc-gated");
      assert.equal(gatedView.canSubmit, true);
      const verified = await devLogin(running.base, "verified");
      const verifiedView = await (await get(running.base, "/bff/kyc/status", verified)).json() as KycVerificationView;
      assert.equal(verifiedView.state, "approved");
      assert.equal(verifiedView.sessionKyc, "verified");
      assert.equal(verifiedView.canSubmit, false);
    } finally {
      await running.close();
    }
  });

  it("consults upstream for a kyc-gated session: the read is never gated", async () => {
    // Unlike /bff/wallet and /bff/notifications, gated sessions are authorized
    // for customer.kyc.read upstream, so they reach the contract surface too.
    const stub = kycStub({ status: "ok", view: upstreamView() });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/kyc/status", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "upstream application ids must not leak");
      assert.equal(text.includes("application_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("reason_codes"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as KycVerificationView;
      assert.deepEqual(Object.keys(view).sort(), ["canSubmit", "mode", "provider", "sessionKyc", "state", "submittedAt"]);
      assert.equal(view.mode, "test");
      assert.equal(view.provider, "simulator");
      assert.equal(view.state, "rejected");
      assert.equal(view.sessionKyc, "kyc-gated");
      assert.equal(view.canSubmit, true);
      assert.equal(view.submittedAt, Date.parse("2026-10-01T12:00:00.000Z"));
      assert.equal(stub.calls.length, 1, "gated sessions must reach upstream");
    } finally {
      await running.close();
    }
  });

  it("adapts the contract view for a verified session and maps upstream session levels", async () => {
    const stub = kycStub({
      status: "ok",
      view: upstreamView({
        session_kyc: "verified",
        status: "approved",
        application_id: "kyc_0123456789abcdef01234567",
        review_deadline: undefined,
        reason_codes: undefined,
        can_submit: false
      })
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/kyc/status", cookie);
      assert.equal(response.status, 200);
      const view = await response.json() as KycVerificationView;
      assert.deepEqual(Object.keys(view).sort(), ["canSubmit", "mode", "provider", "sessionKyc", "state", "submittedAt"]);
      assert.equal(view.state, "approved");
      assert.equal(view.sessionKyc, "verified");
      assert.equal(view.canSubmit, false);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("serves the upstream session level even when it diverges from the local flag", async () => {
    // The upstream is authoritative for the KYC domain: a gated BFF session
    // whose subject upstream marks verified reads the verified pair, and a
    // verified BFF session reads "kyc-gated" while upstream says pending —
    // mirroring how a wallets refusal degrades the surface to its gated form.
    const stub = kycStub({
      status: "ok",
      view: {
        mode: "test",
        provider: "simulator",
        session_kyc: "pending",
        status: "in_review",
        application_id: "kyc_0123456789abcdef01234567",
        submitted_at: "2026-10-01T12:00:00.000Z",
        updated_at: "2026-10-02T12:00:00.000Z",
        review_deadline: "2026-10-01T13:00:00.000Z",
        can_submit: false
      }
    });
    const running = await start(config(), stub);
    try {
      const verified = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/kyc/status", verified)).json() as KycVerificationView;
      assert.deepEqual(Object.keys(view).sort(), [
        "canSubmit", "mode", "provider", "reviewDeadline", "sessionKyc", "state", "submittedAt"
      ]);
      assert.equal(view.sessionKyc, "kyc-gated");
      assert.equal(view.state, "in_review");
      assert.equal(view.reviewDeadline, Date.parse("2026-10-01T13:00:00.000Z"));
      const gated = await devLogin(running.base, "kyc-gated");
      const gatedView = await (await get(running.base, "/bff/kyc/status", gated)).json() as KycVerificationView;
      assert.deepEqual(gatedView, view);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });

  it("degrades to kyc_unavailable on upstream outage for gated and verified sessions without leaking the body", async () => {
    const stub = kycStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      for (const kyc of ["kyc-gated", "verified"]) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/kyc/status", cookie);
        assert.equal(response.status, 503, kyc);
        const text = await response.text();
        assert.equal(text.includes(marker), false);
        assert.equal(text.includes("syn_cust_"), false);
        assert.equal(/kyc_[0-9a-f]{24}/.test(text), false, kyc);
        assert.deepEqual(JSON.parse(text), { error: "kyc_unavailable" });
      }
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiKyc = { status: "unavailable" };
    const stub = kycStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      assert.equal((await get(running.base, "/bff/kyc/status", cookie)).status, 503);
      result = {
        status: "ok",
        view: upstreamView({ status: "not_started", application_id: undefined, submitted_at: undefined, reason_codes: undefined })
      };
      const view = await (await get(running.base, "/bff/kyc/status", cookie)).json() as KycVerificationView;
      assert.deepEqual(Object.keys(view).sort(), ["canSubmit", "mode", "provider", "sessionKyc", "state"]);
      assert.equal(view.state, "not_started");
      assert.equal(view.canSubmit, true);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
