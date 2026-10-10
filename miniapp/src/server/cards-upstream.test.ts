import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { CardsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import type { CustomerApiCard, CustomerApiCards, CustomerApiClient } from "./customer-api-client.js";
import { cardIdPattern, cardTokenReferencePattern, cardsView } from "./cards.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
const marker = "crd_9e9e9e9e9e9e9e9e9e9e9e9e";
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

interface CardsStub {
  client: CustomerApiClient;
  calls: string[];
}

function cardsStub(
  result: CustomerApiCards | (() => Promise<CustomerApiCards>)
): CardsStub {
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
    cards: async (subject) => {
      calls.push(subject);
      return typeof result === "function" ? result() : result;
    },
    notifications: async () => ({ status: "not-configured" }),
    kyc: async () => ({ status: "not-configured" }),
    profile: async () => ({ status: "not-configured" }),
    support: async () => ({ status: "not-configured" })
  };
  return { client, calls };
}

async function start(serverConfig: ServerConfig, stub?: CardsStub): Promise<Running> {
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

function upstreamCard(overrides: Partial<CustomerApiCard> = {}): CustomerApiCard {
  return {
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
    posting: "none",
    ...overrides
  };
}

describe("GET /bff/cards through the customer-api seam", () => {
  it("requires a session", async () => {
    const running = await start(config());
    try {
      const response = await get(running.base, "/bff/cards");
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthenticated" });
    } finally {
      await running.close();
    }
  });

  it("serves the local gated view for a kyc-gated session without consulting upstream", async () => {
    const stub = cardsStub({
      status: "ok",
      cards: [upstreamCard({ card_id: marker })]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "kyc-gated");
      const response = await get(running.base, "/bff/cards", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes(marker), false, "gated sessions must not see upstream data");
      const view = JSON.parse(text) as CardsView;
      assert.deepEqual(view, cardsView("kyc-gated"));
      assert.equal(view.kyc, "kyc-gated");
      assert.equal(view.cards.length, 0);
      assert.equal(stub.calls.length, 0, "gated sessions must not reach upstream");
    } finally {
      await running.close();
    }
  });

  it("serves the local synthetic view for a verified session without a configured customer-api", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base, "verified");
      const view = await (await get(running.base, "/bff/cards", cookie)).json() as CardsView;
      assert.deepEqual(view, cardsView("verified"));
      assert.equal(view.kyc, "verified");
      assert.equal(view.mode, "test");
      for (const card of view.cards) {
        assert.match(card.id, cardIdPattern);
        assert.match(card.last4, /^[0-9]{4}$/);
        assert.match(card.tokenReference, cardTokenReferencePattern);
        assert.equal(card.asset, "RUB");
        assert.equal(card.posting, "none");
        assert.ok(card.expiresAt > card.createdAt);
        if (card.status === "pending_activation") assert.equal(card.updatedAt, card.createdAt);
        else if (card.status === "expired") assert.equal(card.updatedAt, card.expiresAt);
        else assert.ok(card.updatedAt > card.createdAt);
      }
    } finally {
      await running.close();
    }
  });

  it("adapts the contract cards view into the app's cards shape", async () => {
    const stub = cardsStub({
      status: "ok",
      cards: [
        upstreamCard({ card_id: marker }),
        upstreamCard({
          card_id: "crd_fedcba9876543210fedcba98",
          brand: "visa",
          kind: "virtual",
          status: "pending_activation",
          last4: "7716",
          token_reference: "tok_fedcba9876543210fedcba98",
          monthly_limit: "100000.00",
          created_at: "2026-10-08T09:15:00.000Z",
          expires_at: "2029-10-08T09:15:00.000Z",
          updated_at: "2026-10-08T09:15:00.000Z"
        })
      ]
    });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/cards", cookie);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text.includes("card_id"), false, "upstream key names must not leak");
      assert.equal(text.includes("token_reference"), false, "upstream key names must not leak");
      assert.equal(text.includes("monthly_limit"), false, "upstream key names must not leak");
      assert.equal(text.includes("created_at"), false, "upstream key names must not leak");
      assert.equal(text.includes("expires_at"), false, "upstream key names must not leak");
      assert.equal(text.includes("updated_at"), false, "upstream key names must not leak");
      const view = JSON.parse(text) as CardsView;
      assert.deepEqual(Object.keys(view).sort(), ["cards", "kyc", "mode"]);
      assert.equal(view.mode, "test");
      assert.equal(view.kyc, "verified");
      assert.equal(view.cards.length, 2);
      for (const card of view.cards) {
        assert.deepEqual(Object.keys(card).sort(), [
          "asset",
          "brand",
          "createdAt",
          "expiresAt",
          "id",
          "kind",
          "last4",
          "monthlyLimit",
          "posting",
          "status",
          "tokenReference",
          "updatedAt"
        ]);
        assert.match(card.id, cardIdPattern);
        assert.match(card.last4, /^[0-9]{4}$/);
        assert.match(card.tokenReference, cardTokenReferencePattern);
        assert.equal(card.asset, "RUB");
        assert.equal(card.posting, "none");
      }
      const [first, second] = view.cards;
      assert.equal(first.id, marker);
      assert.equal(first.brand, "mir");
      assert.equal(first.kind, "physical");
      assert.equal(first.status, "active");
      assert.equal(first.last4, "4832");
      assert.equal(first.tokenReference, "tok_0123456789abcdef01234567");
      assert.equal(first.monthlyLimit, "250000.00");
      assert.equal(first.createdAt, Date.parse("2026-09-12T10:00:00.000Z"));
      assert.equal(first.expiresAt, Date.parse("2029-09-12T00:00:00.000Z"));
      assert.equal(first.updatedAt, Date.parse("2026-09-12T10:05:00.000Z"));
      assert.equal(second.id, "crd_fedcba9876543210fedcba98");
      assert.equal(second.status, "pending_activation");
      assert.equal(second.updatedAt, second.createdAt);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("maps an upstream cards refusal (403) to the gated view", async () => {
    const stub = cardsStub({ status: "denied" });
    const running = await start(config(), stub);
    try {
      const gatedCookie = await devLogin(running.base, "kyc-gated");
      const gated = await (await get(running.base, "/bff/cards", gatedCookie)).json() as CardsView;
      const verifiedCookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/cards", verifiedCookie);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), gated);
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("degrades to cards_unavailable on upstream outage without leaking the body", async () => {
    const stub = cardsStub({ status: "unavailable" });
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/cards", cookie);
      assert.equal(response.status, 503);
      const text = await response.text();
      assert.equal(text.includes(marker), false);
      assert.equal(text.includes("syn_cust_"), false);
      assert.equal(text.includes("crd_"), false);
      assert.equal(text.includes("tok_"), false);
      assert.deepEqual(JSON.parse(text), { error: "cards_unavailable" });
      assert.equal(stub.calls.length, 1);
    } finally {
      await running.close();
    }
  });

  it("recovers to the contract view once upstream answers correctly again", async () => {
    let result: CustomerApiCards = { status: "unavailable" };
    const stub = cardsStub(async () => result);
    const running = await start(config(), stub);
    try {
      const cookie = await devLogin(running.base, "verified");
      assert.equal((await get(running.base, "/bff/cards", cookie)).status, 503);
      result = {
        status: "ok",
        cards: [upstreamCard({ card_id: "crd_5ec0de5ec0de5ec0de5ec0de" })]
      };
      const view = await (await get(running.base, "/bff/cards", cookie)).json() as CardsView;
      assert.equal(view.kyc, "verified");
      assert.deepEqual(view.cards.map((card) => card.id), ["crd_5ec0de5ec0de5ec0de5ec0de"]);
      assert.equal(stub.calls.length, 2);
    } finally {
      await running.close();
    }
  });
});
