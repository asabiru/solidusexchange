import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, api } from "./api.js";

function stubFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

describe("miniapp BFF fetch-layer audit", () => {
  it("serves a well-formed JSON view", async () => {
    const restore = stubFetch(() => jsonResponse({ wallets: [] }));
    try {
      const view = await api.wallet();
      assert.deepEqual(view, { wallets: [] });
    } finally {
      restore();
    }
  });

  it("rejects a body whose declared length exceeds the bound", async () => {
    const restore = stubFetch(() =>
      new Response(`{"pad":"${"x".repeat(300_000)}"}`, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "300001" }
      })
    );
    try {
      await assert.rejects(() => api.wallet(), /too large/i);
    } finally {
      restore();
    }
  });

  it("rejects a streamed body that crosses the bound mid-read", async () => {
    const restore = stubFetch(() =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const chunk = new TextEncoder().encode(`{"pad":"${"x".repeat(200_000)}`);
            controller.enqueue(chunk);
            controller.enqueue(chunk);
            controller.enqueue(new TextEncoder().encode('"}'));
            controller.close();
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    try {
      await assert.rejects(() => api.wallet(), /too large/i);
    } finally {
      restore();
    }
  });

  it("rejects a non-JSON content type even on 200", async () => {
    const restore = stubFetch(() => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }));
    try {
      await assert.rejects(() => api.wallet(), /json/i);
    } finally {
      restore();
    }
  });

  it("rejects a malformed JSON body on 200 instead of silently substituting {}", async () => {
    const restore = stubFetch(() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await assert.rejects(() => api.wallet());
    } finally {
      restore();
    }
  });

  it("rejects payloads nested deeper than the canonical bound", async () => {
    let nested: unknown = { leaf: true };
    for (let index = 0; index < 20; index += 1) nested = { wrap: nested };
    const restore = stubFetch(() => jsonResponse(nested));
    try {
      await assert.rejects(() => api.wallet(), /canonical/i);
    } finally {
      restore();
    }
  });

  it("surfaces typed error fields and falls back to request_failed otherwise", async () => {
    let restore = stubFetch(() => jsonResponse({ error: "denied", reason: "kyc" }, { status: 403 }));
    try {
      await assert.rejects(
        () => api.wallet(),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, 403);
          assert.equal(error.code, "denied");
          assert.equal(error.reason, "kyc");
          return true;
        }
      );
    } finally {
      restore();
    }
    restore = stubFetch(() => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }));
    try {
      await assert.rejects(
        () => api.wallet(),
        (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, 502);
          assert.equal(error.code, "request_failed");
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  it("encodes member-read ids and never leaks raw path segments", async () => {
    const seen: string[] = [];
    const restore = stubFetch((path) => {
      seen.push(path);
      return jsonResponse({ ok: true });
    });
    try {
      await api.operation("a/b/../../etc");
      assert.equal(seen[0], "/bff/operations/a%2Fb%2F..%2F..%2Fetc");
    } finally {
      restore();
    }
  });
});
