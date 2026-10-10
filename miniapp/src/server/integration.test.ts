import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { startCustomerApi } from "@solidchange/customer-api/dev-server";
import type { DeviceSessionsView, ProfileView, QuotePreview, SupportRequestsView } from "../shared/api.js";
import { loadServerConfig } from "./config.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";

describe("end-to-end dev flow: login → customer API → provider quote", () => {
  let customerApi: Server;
  let bff: Server;
  let base: string;

  before(async () => {
    const key = randomBytes(32).toString("hex");
    const started = await startCustomerApi({ host: "127.0.0.1", port: 0, rateLimitPerMinute: 60, authMode: "synthetic-dev", devTokenKey: key });
    customerApi = started.server;
    const config = loadServerConfig({
      MINIAPP_ALLOW_DEV_LOGIN: "true",
      MINIAPP_QUOTE_SOURCE: "provider-simulator",
      MINIAPP_CUSTOMER_API_URL: `http://127.0.0.1:${started.address.port}`,
      MINIAPP_CUSTOMER_API_DEV_TOKEN_KEY: key
    });
    bff = createMiniappServer(config);
    await new Promise<void>((resolve) => bff.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(bff.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => bff.close(() => resolve()));
    await new Promise<void>((resolve) => customerApi.close(() => resolve()));
  });

  async function login(kyc: string): Promise<string> {
    const response = await fetch(`${base}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ kyc })
    });
    assert.equal(response.status, 201);
    return (response.headers.get("set-cookie") ?? "").split(";")[0];
  }

  it("shows read-only customer API access in the profile", async () => {
    const cookie = await login("verified");
    const profile = await (await fetch(`${base}/bff/profile`, { headers: { cookie } })).json() as ProfileView;
    assert.deepEqual(profile.apiAccess, {
      status: "connected",
      granted: ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read", "customer.auth.read", "customer.users.read"],
      commandsEnabled: false
    });
    // The identity fields come from the customer-api synthetic profile
    // directory (customer.profile.read is never gated upstream).
    assert.match(profile.displayName, /^Customer [0-9a-f]{8}$/);
    assert.match(profile.customerRef, /^SC-DEV-[0-9A-Z]{5}$/);
    assert.equal(profile.limits.decision, "D-014");
  });

  it("serves the support request list through the customer-api contract", async () => {
    // customer.support.read is granted at every session status upstream, so a
    // kyc-gated session reaches the contract surface too: the adapted view
    // carries tck_* ticket ids and millisecond timestamps.
    const cookie = await login("kyc-gated");
    const response = await fetch(`${base}/bff/support/requests`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const view = await response.json() as SupportRequestsView;
    assert.deepEqual(Object.keys(view).sort(), ["delivery", "mode", "requests"]);
    assert.equal(view.mode, "test");
    assert.equal(view.delivery, "disabled");
    assert.ok(view.requests.length >= 1);
    for (const request of view.requests) {
      assert.match(request.id, /^tck_[0-9a-f]{24}$/);
      assert.equal(request.mode, "test");
      assert.equal(request.delivery, "disabled");
      assert.equal(request.status, request.timeline.at(-1)?.status);
    }
  });

  it("serves the device session list through the customer-api contract", async () => {
    // customer.auth.read is granted at every session status upstream, so a
    // kyc-gated session reaches the contract surface too: the adapted view
    // carries sess_* handles and only live (active) sign-ins.
    const cookie = await login("kyc-gated");
    const response = await fetch(`${base}/bff/sessions`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const view = await response.json() as DeviceSessionsView;
    assert.deepEqual(Object.keys(view).sort(), ["mode", "sessions"]);
    assert.equal(view.mode, "test");
    assert.ok(view.sessions.length >= 1);
    assert.equal(view.sessions.filter((entry) => entry.current).length, 1);
    for (const entry of view.sessions) {
      assert.match(entry.handle, /^sess_[0-9a-f]{24}$/);
      assert.match(entry.client, /^(telegram|dev-login)$/);
      assert.ok(entry.lastSeenAt >= entry.createdAt);
    }
  });

  it("previews a signed provider-simulator quote and keeps it non-executable", async () => {
    const cookie = await login("kyc-gated");
    const response = await fetch(`${base}/bff/quotes/preview?from=RUB&to=USDT&amount=25000`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const quote = await response.json() as QuotePreview;
    assert.match(quote.id, /^quote_[0-9a-f]{32}$/);
    assert.equal(quote.kycRequired, true);
    assert.equal(quote.executable, false);
    assert.ok(quote.expiresAt > quote.serverTime);
    const invalid = await fetch(`${base}/bff/quotes/preview?from=RUB&to=USDT&amount=1e3`, { headers: { cookie } });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "invalid_amount" });
  });

  it("exposes no quote acceptance or money-moving route", async () => {
    const cookie = await login("verified");
    for (const path of ["/bff/quotes/accept", "/bff/quotes/execute", "/bff/exchange", "/bff/orders", "/bff/exchange-orders", "/bff/withdrawals", "/bff/deposits", "/bff/quotes", "/bff/payments", "/bff/cards"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie },
        body: JSON.stringify({})
      });
      assert.equal(response.status, 404, path);
    }
  });
});
