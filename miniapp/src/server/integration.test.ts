import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { startCustomerApi } from "@solidchange/customer-api/dev-server";
import type { ProfileView, QuotePreview } from "../shared/api.js";
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
      granted: ["customer.session.read", "customer.capabilities.read", "customer.kyc.read"],
      commandsEnabled: false
    });
    assert.equal(profile.limits.decision, "D-014");
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
    for (const path of ["/bff/quotes/accept", "/bff/quotes/execute", "/bff/exchange", "/bff/orders", "/bff/withdrawals", "/bff/deposits", "/bff/payments"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin, cookie },
        body: JSON.stringify({})
      });
      assert.equal(response.status, 404, path);
    }
  });
});
