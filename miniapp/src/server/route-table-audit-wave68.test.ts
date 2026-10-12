import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { createMiniappServer, routeTable } from "./server.js";

const origin = "http://127.0.0.1:4183";

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

async function start(serverConfig: ServerConfig): Promise<Running> {
  const server = createMiniappServer(serverConfig);
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

function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
}

const postOnlyPaths = routeTable
  .filter((route) => route.method === "POST")
  .map((route) => route.path)
  .filter((path) => !routeTable.some((route) => route.method === "GET" && route.path === path));

const getPaths = routeTable
  .filter((route) => route.method === "GET" && route.path !== "/bff/metrics")
  .map((route) => route.path);

// Member templates instantiated with a well-formed-looking id each: the id
// never exists, but query rejection must answer before any lookup runs.
const memberGetPaths = getPaths
  .filter((path) => path.includes("/:"))
  .map((path) => path.replace(/\/:[^/]+$/, "/audit-w68"));

const collectionGetPaths = getPaths.filter((path) => !path.includes("/:"));

describe("route-table dispatch audit wave 68", () => {
  it("answers 404, not 401, to unauthenticated GETs on POST-only paths", async () => {
    // The knownGet gate is for GET routes: a POST-only path has no GET
    // handler, so it must answer exactly like a never-registered path —
    // the previous 401 revealed which paths are POST routes.
    const running = await start(config());
    try {
      assert.ok(postOnlyPaths.length > 0);
      for (const path of [...postOnlyPaths, "/bff/never-registered"]) {
        const response = await get(running.base, path);
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: "not_found" }, path);
      }
    } finally {
      await running.close();
    }
  });

  it("keeps answering 404 to authenticated GETs on POST-only paths", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      for (const path of postOnlyPaths) {
        const response = await get(running.base, path, cookie);
        assert.equal(response.status, 404, path);
        assert.deepEqual(await response.json(), { error: "not_found" }, path);
      }
    } finally {
      await running.close();
    }
  });

  it("keeps 401 for unauthenticated GETs on real GET routes", async () => {
    const running = await start(config());
    try {
      for (const path of ["/bff/session", "/bff/wallet", ...memberGetPaths]) {
        const response = await get(running.base, path);
        assert.equal(response.status, 401, path);
        assert.deepEqual(await response.json(), { error: "unauthenticated" }, path);
      }
    } finally {
      await running.close();
    }
  });

  it("rejects undeclared query uniformly across every GET route", async () => {
    // /bff/activity pins ?limit and the two previews declare fixed key
    // sets; every other GET surface must answer an unknown parameter like
    // the member reads do instead of silently ignoring it.
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      for (const path of collectionGetPaths) {
        if (["/bff/activity", "/bff/quotes/preview", "/bff/checks/preview"].includes(path)) continue;
        const response = await get(running.base, `${path}?audit=w68`, cookie);
        assert.equal(response.status, 400, path);
        assert.deepEqual(await response.json(), { error: "invalid_request" }, path);
      }
      for (const path of memberGetPaths) {
        const response = await get(running.base, `${path}?audit=w68`, cookie);
        assert.equal(response.status, 400, path);
        assert.deepEqual(await response.json(), { error: "invalid_request" }, path);
      }
      // /bff/health declares no input either and answers before any session.
      assert.equal((await get(running.base, "/bff/health?audit=w68")).status, 400);
    } finally {
      await running.close();
    }
  });

  it("rejects undeclared keys inside the query-declaring routes", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      for (const path of [
        "/bff/quotes/preview?from=RUB&to=USDT&amount=100&junk=1",
        "/bff/quotes/preview?junk=1&from=RUB&to=USDT&amount=100",
        "/bff/checks/preview?asset=USDT&amount=100&junk=1",
        "/bff/activity?limit=5&junk=1",
        "/bff/activity?limit=0",
        "/bff/activity?junk=1"
      ]) {
        const response = await get(running.base, path, cookie);
        assert.equal(response.status, 400, path);
        assert.deepEqual(await response.json(), { error: "invalid_request" }, path);
      }
    } finally {
      await running.close();
    }
  });

  it("still serves the declared query inputs and query-free routes", async () => {
    const running = await start(config());
    try {
      const cookie = await devLogin(running.base);
      const quote = await get(running.base, "/bff/quotes/preview?from=RUB&to=USDT&amount=100", cookie);
      assert.equal(quote.status, 200);
      const check = await get(running.base, "/bff/checks/preview?asset=USDT&amount=100", cookie);
      assert.equal(check.status, 200);
      const activity = await get(running.base, "/bff/activity?limit=5", cookie);
      assert.equal(activity.status, 200);
      for (const path of ["/bff/session", "/bff/wallet", "/bff/notifications"]) {
        assert.equal((await get(running.base, path, cookie)).status, 200, path);
      }
      assert.equal((await get(running.base, "/bff/health")).status, 200);
    } finally {
      await running.close();
    }
  });
});
