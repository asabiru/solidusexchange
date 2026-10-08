import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { CheckPreview, CheckView, ChecksView } from "../shared/api.js";
import { checkReferencePattern, checkStatuses } from "../shared/checks.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { createMiniappServer, routeTable } from "./server.js";
import { defaultCheckTtlSeconds } from "./checks.js";

const origin = "http://127.0.0.1:4183";
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

async function start(serverConfig: ServerConfig = config()): Promise<Running> {
  const server = createMiniappServer(serverConfig, { clock: () => now });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function devLogin(base: string, kyc = "verified"): Promise<string> {
  const response = await fetch(`${base}/bff/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ kyc })
  });
  assert.equal(response.status, 201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function getJson<T>(base: string, path: string, cookie: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: response.status, body: await response.json() as T };
}

describe("checks routes: authentication and guards", () => {
  it("requires a session and rejects the device header", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      const paths = ["/bff/checks", "/bff/checks/preview?asset=USDT&amount=1", "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b"];
      for (const path of paths) {
        assert.equal((await fetch(`${running.base}${path}`)).status, 401, path);
        assert.equal((await fetch(`${running.base}${path}`, { headers: { cookie, "x-device-id": "dev-1" } })).status, 400, path);
      }
      assert.equal((await fetch(`${running.base}/bff/checks?x=1`, { headers: { cookie } })).status, 400);
      assert.equal((await fetch(`${running.base}/bff/checks/${"chk_7f3a9c1e5d2b4f8a0e6c1d3b"}?x=1`, { headers: { cookie } })).status, 400);
    } finally {
      await running.close();
    }
  });

  it("declares checks routes as read-only GET endpoints only", () => {
    const checksRoutes = routeTable.filter((route) => route.path.startsWith("/bff/checks"));
    assert.deepEqual(checksRoutes.map((route) => `${route.method} ${route.path}`).sort(), [
      "GET /bff/checks",
      "GET /bff/checks/:id",
      "GET /bff/checks/preview"
    ]);
  });

  it("answers 404 to every state-changing method on check paths", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      for (const path of ["/bff/checks", "/bff/checks/preview", "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b", "/bff/checks/chk_7f3a9c1e5d2b4f8a0e6c1d3b/claim", "/bff/checks/create"]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const response = await fetch(`${running.base}${path}`, {
            method,
            headers: { "content-type": "application/json", origin, cookie },
            body: JSON.stringify({ amount: "1" })
          });
          assert.equal(response.status, 404, `${method} ${path}`);
        }
      }
    } finally {
      await running.close();
    }
  });
});

describe("checks routes: list and detail", () => {
  it("lists deterministic synthetic checks with exact keys", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      const { status, body } = await getJson<ChecksView>(running.base, "/bff/checks", cookie);
      assert.equal(status, 200);
      assert.equal(body.mode, "test");
      assert.equal(body.checks.length, checkStatuses.length);
      for (const check of body.checks) {
        assert.deepEqual(Object.keys(check).sort().filter((key) => key !== "comment"), [
          "amount", "asset", "claimRule", "createdAt", "direction", "executable", "executionUnavailableReason", "expiresAt", "fee", "mode", "reference", "status", "timeline", "total"
        ]);
        assert.match(check.reference, checkReferencePattern);
        assert.equal(check.executable, false);
      }
    } finally {
      await running.close();
    }
  });

  it("serves the check detail by claim reference and hides everything else", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      const list = await getJson<ChecksView>(running.base, "/bff/checks", cookie);
      const [first] = list.body.checks;
      assert.ok(first);
      const detail = await getJson<CheckView>(running.base, `/bff/checks/${first.reference}`, cookie);
      assert.equal(detail.status, 200);
      assert.deepEqual(detail.body, first);
      for (const id of ["", "unknown", first.reference.toUpperCase(), `${first.reference}/x`, "%2e%2e", "chk_000000000000000000000000"]) {
        assert.equal((await getJson<unknown>(running.base, `/bff/checks/${id}`, cookie)).status, 404, id);
      }
    } finally {
      await running.close();
    }
  });

  it("derives the waiting-for-KYC status for an unverified recipient", async () => {
    const running = await start();
    try {
      const verified = await devLogin(running.base, "verified");
      const received = (await getJson<ChecksView>(running.base, "/bff/checks", verified)).body.checks
        .find((check) => check.direction === "received" && check.status === "created");
      assert.ok(received);
      const gated = await devLogin(running.base, "kyc-gated");
      const detail = await getJson<CheckView>(running.base, `/bff/checks/${received.reference}`, gated);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.status, "awaiting_recipient_kyc");
      assert.equal(detail.body.executable, false);
    } finally {
      await running.close();
    }
  });
});

describe("checks routes: preview", () => {
  it("returns a non-executable preview card with exact decimals and the 72h expiry", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      const { status, body } = await getJson<CheckPreview>(running.base, "/bff/checks/preview?asset=USDT&amount=25", cookie);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body).sort(), [
        "amount", "asset", "claimRule", "executable", "executionUnavailableReason", "expiresAt", "fee", "feeAsset", "feeBps", "id", "insufficientBalance", "issuedAt", "kycRequired", "mode", "serverTime", "total", "ttlSeconds"
      ]);
      assert.match(body.id, /^CHK-[0-9A-F]{12}$/);
      assert.equal(body.amount, "25.000000");
      assert.equal(body.fee, "0.075000");
      assert.equal(body.total, "25.075000");
      assert.equal(body.expiresAt, now + defaultCheckTtlSeconds * 1_000);
      assert.equal(body.executable, false);
      assert.equal(body.executionUnavailableReason, "dev_test_version");
      assert.equal(body.kycRequired, false);
      assert.equal(body.insufficientBalance, false);
    } finally {
      await running.close();
    }
  });

  it("validates asset and amount and marks kyc-gated sessions", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base);
      for (const [path, code] of [
        ["/bff/checks/preview", "invalid_asset"],
        ["/bff/checks/preview?asset=BTC&amount=1", "invalid_asset"],
        ["/bff/checks/preview?asset=USDT&amount=1e3", "invalid_amount"],
        ["/bff/checks/preview?asset=USDT&amount=0", "invalid_amount"],
        ["/bff/checks/preview?asset=USDT", "invalid_amount"]
      ] as const) {
        const { status, body } = await getJson<{ error: string }>(running.base, path, cookie);
        assert.equal(status, 400, path);
        assert.deepEqual(body, { error: code });
      }
      const gated = await devLogin(running.base, "kyc-gated");
      const preview = await getJson<CheckPreview>(running.base, "/bff/checks/preview?asset=USDT&amount=25", gated);
      assert.equal(preview.body.kycRequired, true);
      assert.equal(preview.body.insufficientBalance, true);
    } finally {
      await running.close();
    }
  });
});
