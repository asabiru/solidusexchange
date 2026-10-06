import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { KycVerificationView, QuotePreview, SessionView, WalletView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { type KycService, createKycService } from "./kyc.js";
import { createMiniappServer } from "./server.js";

const origin = "http://127.0.0.1:4183";
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

async function start(serverConfig: ServerConfig, kyc?: KycService): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now, kyc });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body)
  });
}

async function devLogin(base: string, kyc = "kyc-gated"): Promise<string> {
  const response = await post(base, "/bff/auth/dev-session", { kyc });
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getJson<T>(base: string, path: string, cookie: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, path);
  return await response.json() as T;
}

async function status(base: string, cookie: string): Promise<KycVerificationView> {
  return getJson<KycVerificationView>(base, "/bff/kyc/status", cookie);
}

async function advanceUntil(base: string, cookie: string, target: KycVerificationView["state"]): Promise<string[]> {
  const seen: string[] = [];
  for (let step = 0; step < 120; step += 1) {
    now += 10_000;
    const view = await status(base, cookie);
    if (seen.at(-1) !== view.state) seen.push(view.state);
    if (view.state === target) return seen;
  }
  assert.fail(`KYC never reached ${target}; saw ${seen.join(" → ")}`);
}

describe("KYC routes: authentication, CSRF and strict input", () => {
  let running: Running;
  before(async () => {
    running = await start(config());
  });
  after(async () => {
    await running.close();
  });

  it("requires a session for submission and status", async () => {
    assert.equal((await post(running.base, "/bff/kyc/applications", {})).status, 401);
    assert.equal((await fetch(`${running.base}/bff/kyc/status`)).status, 401);
    const forged = { cookie: "smx_session=00000000-0000-4000-8000-000000000000" };
    assert.equal((await post(running.base, "/bff/kyc/applications", {}, forged)).status, 401);
    assert.equal((await fetch(`${running.base}/bff/kyc/status`, { headers: forged })).status, 401);
  });

  it("applies the exact-Origin CSRF check before touching the session", async () => {
    const cookie = await devLogin(running.base);
    for (const bad of ["http://evil.example", "null", "http://127.0.0.1:4183.evil.example"]) {
      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie, origin: bad })).status, 403, bad);
    }
    const missing = await fetch(`${running.base}/bff/kyc/applications`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}"
    });
    assert.equal(missing.status, 403);
    assert.equal((await status(running.base, cookie)).state, "not_started");
  });

  it("accepts only an empty JSON object and never a client-supplied status", async () => {
    const cookie = await devLogin(running.base);
    for (const body of [{ status: "approved" }, { kyc: "verified" }, { applicant_ref: "sim-attacker" }]) {
      assert.equal((await post(running.base, "/bff/kyc/applications", body, { cookie })).status, 400, JSON.stringify(body));
    }
    const plain = await fetch(`${running.base}/bff/kyc/applications`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin, cookie },
      body: "{}"
    });
    assert.equal(plain.status, 415);
    assert.equal((await post(running.base, "/bff/kyc/applications", [], { cookie })).status, 400);
    const ignored = await getJson<KycVerificationView>(running.base, "/bff/kyc/status?state=approved&kyc=verified", cookie);
    assert.equal(ignored.state, "not_started");
    assert.equal(ignored.sessionKyc, "kyc-gated");
  });

  it("exposes no callback, status-write or operator route to customers", async () => {
    const cookie = await devLogin(running.base);
    for (const path of ["/bff/kyc/callbacks", "/bff/kyc/status", "/bff/kyc/approve", "/bff/operator/kyc"]) {
      assert.equal((await post(running.base, path, {}, { cookie })).status, 404, path);
    }
    const put = await fetch(`${running.base}/bff/kyc/applications`, { method: "PUT", headers: { cookie, origin } });
    assert.equal(put.status, 404);
  });

  it("is idempotent for repeated submissions", async () => {
    const cookie = await devLogin(running.base);
    const first = await post(running.base, "/bff/kyc/applications", {}, { cookie });
    assert.equal(first.status, 202);
    const created = await first.json() as KycVerificationView;
    assert.equal(created.state, "submitted");
    assert.equal(created.mode, "test");
    now += 1_000;
    const again = await post(running.base, "/bff/kyc/applications", {}, { cookie });
    assert.equal(again.status, 200);
    const repeated = await again.json() as KycVerificationView;
    assert.equal(repeated.submittedAt, created.submittedAt);
    assert.equal(repeated.state, "submitted");
    const text = JSON.stringify(repeated);
    assert.doesNotMatch(text, /sim-|kyc-sim|applicant|provider_reference/);
  });

  it("refuses a second application from an already verified session", async () => {
    const cookie = await devLogin(running.base, "verified");
    const response = await post(running.base, "/bff/kyc/applications", {}, { cookie });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "kyc_already_verified" });
    assert.equal((await status(running.base, cookie)).state, "approved");
  });
});

describe("KYC routes: provider outcomes", () => {
  it("maps a provider outage to a customer-safe 503 and keeps the session gated", async () => {
    const running = await start(config({ kycScenario: "provider_outage" }));
    try {
      const cookie = await devLogin(running.base);
      const response = await post(running.base, "/bff/kyc/applications", {}, { cookie });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "kyc_unavailable" });
      const view = await status(running.base, cookie);
      assert.equal(view.state, "unavailable");
      assert.equal(view.canSubmit, true);
      assert.equal((await getJson<WalletView>(running.base, "/bff/wallet", cookie)).totalRub, "0.00");
    } finally {
      await running.close();
    }
  });

  it("keeps rejected, needs-more-data and timed-out applicants gated", async () => {
    for (const [scenario, target] of [
      ["reject", "rejected"],
      ["needs_more_data", "needs_more_data"],
      ["pending_timeout", "timed_out"]
    ] as const) {
      const running = await start(config({ kycScenario: scenario, kycReviewTimeoutSeconds: 600 }));
      try {
        const cookie = await devLogin(running.base);
        assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 202);
        const seen = await advanceUntil(running.base, cookie, target);
        assert.ok(seen.includes("in_review"), scenario);
        const session = await getJson<SessionView>(running.base, "/bff/session", cookie);
        assert.equal(session.kyc, "kyc-gated", scenario);
        assert.equal((await getJson<WalletView>(running.base, "/bff/wallet", cookie)).totalRub, "0.00", scenario);
        assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 200, scenario);
      } finally {
        await running.close();
      }
    }
  });

  it("keeps the session gated when forged or out-of-order callbacks are delivered", async () => {
    const kyc = createKycService({ seed: "miniapp-kyc-routes", scenario: "approve", reviewTimeoutSeconds: 3_600, clock: () => now });
    const running = await start(config(), kyc);
    try {
      const cookie = await devLogin(running.base);
      assert.equal((await post(running.base, "/bff/kyc/applications", {}, { cookie })).status, 202);
      now += 600_000;
      const [review, approval] = kyc.drainDeliveries();
      assert.deepEqual(kyc.receiveCallback({ headers: {}, body: approval.body }, approval.deliverAt), { verified: false, reason: "missing_header" });
      const forged = Buffer.from(review.body.toString("utf8").replace("\"in_review\"", "\"approved\""), "utf8");
      assert.deepEqual(kyc.receiveCallback({ headers: review.headers, body: forged }, review.deliverAt), { verified: false, reason: "signature_mismatch" });
      assert.deepEqual(kyc.receiveCallback(approval, approval.deliverAt), { verified: true, action: "buffered" });
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "kyc-gated");
      assert.equal((await status(running.base, cookie)).state, "submitted");
      assert.equal((await getJson<WalletView>(running.base, "/bff/wallet", cookie)).totalRub, "0.00");

      assert.deepEqual(kyc.receiveCallback(review, review.deliverAt), { verified: true, action: "applied" });
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "verified");
    } finally {
      await running.close();
    }
  });
});

describe("KYC integration: gated login → submit → simulated review → verified", () => {
  it("opens wallet, operations and quotes only after the signed approval", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      const gatedWallet = await getJson<WalletView>(running.base, "/bff/wallet", cookie);
      assert.equal(gatedWallet.kyc, "kyc-gated");
      assert.equal(gatedWallet.totalRub, "0.00");
      const gatedQuote = await getJson<QuotePreview>(running.base, "/bff/quotes/preview?from=RUB&to=USDT&amount=5000", cookie);
      assert.equal(gatedQuote.kycRequired, true);
      assert.equal(gatedQuote.executable, false);
      assert.deepEqual(await getJson(running.base, "/bff/operations", cookie), { operations: [] });

      const submitted = await post(running.base, "/bff/kyc/applications", {}, { cookie });
      assert.equal(submitted.status, 202);
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "kyc-gated");

      const seen = await advanceUntil(running.base, cookie, "approved");
      assert.deepEqual(seen, ["submitted", "in_review", "approved"]);
      const view = await status(running.base, cookie);
      assert.equal(view.sessionKyc, "verified");
      assert.equal(view.canSubmit, false);

      assert.equal((await getJson<SessionView>(running.base, "/bff/session", cookie)).kyc, "verified");
      const wallet = await getJson<WalletView>(running.base, "/bff/wallet", cookie);
      assert.equal(wallet.kyc, "verified");
      assert.notEqual(wallet.totalRub, "0.00");
      const operations = await getJson<{ operations: unknown[] }>(running.base, "/bff/operations", cookie);
      assert.ok(operations.operations.length > 0);
      const quote = await getJson<QuotePreview>(running.base, "/bff/quotes/preview?from=RUB&to=USDT&amount=5000", cookie);
      assert.equal(quote.kycRequired, false);
      assert.equal(quote.executable, false);

      const relogin = await devLogin(running.base);
      assert.equal((await status(running.base, relogin)).state, "not_started");
      assert.equal((await getJson<SessionView>(running.base, "/bff/session", relogin)).kyc, "kyc-gated");
    } finally {
      await running.close();
    }
  });
});
