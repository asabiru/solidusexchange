import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { DocumentsView } from "../shared/api.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { documentIdPattern, documentsView } from "./documents.js";
import { createMiniappServer } from "./server.js";

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

async function start(serverConfig: ServerConfig = config()): Promise<Running> {
  const server = createMiniappServer(serverConfig);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

function get(base: string, path: string, cookie?: string) {
  return fetch(`${base}${path}`, {
    headers: cookie ? { cookie } : {}
  });
}

async function devLogin(base: string, kyc: "verified" | "kyc-gated"): Promise<string> {
  const response = await fetch(`${base}/bff/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ kyc })
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

describe("documents routes", () => {
  it("answers 401 without a session and serves the local fixture to both session states", async () => {
    const running = await start();
    try {
      assert.equal((await get(running.base, "/bff/documents")).status, 401);
      for (const kyc of ["kyc-gated", "verified"] as const) {
        const cookie = await devLogin(running.base, kyc);
        const response = await get(running.base, "/bff/documents", cookie);
        assert.equal(response.status, 200, kyc);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const view = await response.json() as DocumentsView;
        assert.deepEqual(view, documentsView());
        assert.equal(view.mode, "test");
        assert.equal(view.delivery, "disabled");
        for (const document of view.documents) {
          assert.match(document.id, documentIdPattern);
          assert.equal(document.posting, "none");
        }
      }
    } finally {
      await running.close();
    }
  });

  it("rejects undeclared query keys like every other query-free surface", async () => {
    const running = await start();
    try {
      const cookie = await devLogin(running.base, "verified");
      const response = await get(running.base, "/bff/documents?junk=1", cookie);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    } finally {
      await running.close();
    }
  });
});
