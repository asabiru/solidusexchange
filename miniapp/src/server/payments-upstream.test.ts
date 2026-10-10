import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { PaymentsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiClient, CustomerApiPayment, CustomerApiPayments } from "./customer-api-client.js";
import {
  paymentIdPattern,
  paymentProviderReferencePattern,
  paymentRailObservedStatuses,
  paymentsView
} from "./payments.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "pay_9e9e9e9e9e9e9e9e9e9e9e9e";
const now = 1_790_000_000_000;

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

interface PaymentsStub {
  client: CustomerApiClient;
  calls: string[];
}

function paymentsStub(
  result: CustomerApiPayments | (() => Promise<CustomerApiPayments>)
): PaymentsStub {
  const calls: string[] = [];
  const client: CustomerApiClient = {
    configured: true,
    access: async () => ({ status: "unavailable" }),
    wallets: async () => ({ status: "unavailable" }),
    deposits: async () => ({ status: "not-configured" }),
    withdrawals: async () => ({ status: "not-configured" }),
    quotes: async () => ({ status: "not-configured" }),
    exchangeOrders: async () => ({ status: "not-configured" }),
    payments: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    cards: async () => ({ status: "not-configured" }),
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" }),
    authSessions: async () => ({ status: "not-configured" }),
        users: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: PaymentsStub): Promise<Running> {
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

function upstreamPayment(overrides: Partial<CustomerApiPayment> = {}): CustomerApiPayment {
  return {
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
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/payments through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/payments");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = paymentsStub({
      status: "ok",
      payments: [upstreamPayment({ payment_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/payments", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as PaymentsView;
      assert.deepEqual(view, paymentsView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.payments.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/payments", cookie)).json() as PaymentsView;
      assert.deepEqual(view, paymentsView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const payment of view.payments) {
        assert.match(payment.id, paymentIdPattern);
        assert.equal(payment.asset, "RUB");
        assert.equal(payment.method, "sbp");
        assert.equal(payment.posting, "none");
        if (paymentRailObservedStatuses.includes(payment.status)) {
          assert.match(payment.providerReference ?? "", paymentProviderReferencePattern);
        } else {
          assert.equal(payment.providerReference, null);
        }
        if (payment.status === "created") assert.equal(payment.updatedAt, payment.createdAt);
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract payments view into the app's payments shape", async () => {
    const stub = paymentsStub({
      status: "ok",
      payments: [
        upstreamPayment({ payment_id: marker }),
        upstreamPayment({
          payment_id: "pay_fedcba9876543210fedcba98",
          status: "created",
          amount: "800.00",
          fee_amount: "2.00",
          total_amount: "802.00",
          recipient_reference: "recipient_ref_f6e5d4c3",
          provider_reference: null,
          created_at: "2026-10-08T09:15:00.000Z",
          updated_at: "2026-10-08T09:15:00.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/payments", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("payment_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("fee_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("total_amount"), false, "upstream key names must not leak");
      assert.equal(text.includes("recipient_reference"), false, "upstream key names must not leak");
      assert.equal(text.includes("provider_reference"), false, "upstream key names must not leak");
      assert.equal(text.includes("created_at"), false, "upstream key names must not leak");
      assert.equal(text.includes("updated_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as PaymentsView;
      assert.deepEqual(Object.keys(view).sort(), ["kyc", "mode", "payments"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.payments.length, 2);
      for (const payment of view.payments) {
        assert.deepEqual(Object.keys(payment).sort(), [
          "amount",
          "asset",
          "createdAt",
          "fee",
          "id",
          "method",
          "posting",
          "providerReference",
          "recipientReference",
          "status",
          "total",
          "updatedAt"
        ]);
        assert.match(payment.id, paymentIdPattern);
        assert.equal(payment.asset, "RUB");
        assert.equal(payment.method, "sbp");
        assert.equal(payment.posting, "none");
      }
      const [first, second] = view.payments;
      assert.equal(first.id, marker);
      assert.equal(first.status, "completed");
      assert.equal(first.amount, "1500.00");
      assert.equal(first.fee, "7.50");
      assert.equal(first.total, "1507.50");
      assert.equal(first.recipientReference, "recipient_ref_a1b2c3d4");
      assert.equal(first.providerReference, "SIMBANK0123456789ABCDEF");
      assert.equal(first.createdAt, Date.parse("2026-10-05T11:20:00.000Z"));
      assert.equal(first.updatedAt, Date.parse("2026-10-05T11:24:00.000Z"));
      assert.equal(second.id, "pay_fedcba9876543210fedcba98");
      assert.equal(second.status, "created");
      assert.equal(second.providerReference, null);
      assert.equal(second.updatedAt, second.createdAt);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream payments refusal (403) to the gated view", async () => {
    const stub = paymentsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/payments", gatedCookie)).json() as PaymentsView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/payments", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to payments_unavailable on upstream outage without leaking the body", async () => {
    const stub = paymentsStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/payments", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("pay_"), false);
      assert.deepEqual(JSON.parse(text), { error: "payments_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiPayments = { status: "unavailable" };
    const stub = paymentsStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/payments", cookie)).status, 503);
      result = {
        status: "ok",
        payments: [upstreamPayment({ payment_id: "pay_5ec0de5ec0de5ec0de5ec0de" })]
      };
      const view = await (await get(running.base, "/bff/payments", cookie)).json() as PaymentsView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.payments.map((payment) => payment.id), ["pay_5ec0de5ec0de5ec0de5ec0de"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
