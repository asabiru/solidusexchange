import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { type IncomingHttpHeaders, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { startCustomerApi } from "@solidchange/customer-api/dev-server";
import {
  createCustomerApiClient,
  customerApiPlatform,
  customerApiSubject,
  maxCustomerApiResponseBytes
} from "./customer-api-client.js";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const testDeviceId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const operatorCapabilities = [
  "operator.session.read",
  "operator.capabilities.read",
  "operator.admin.read"
];

async function withCustomerApi<T>(key: string, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const { server, address } = await startCustomerApi({
    host: "127.0.0.1",
    port: 0,
    rateLimitPerMinute: 60,
    authMode: "synthetic-dev",
    devTokenKey: key
  });
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function withFakeApi<T>(
  respond: (path: string) => unknown,
  run: (baseUrl: string, seen: IncomingHttpHeaders[]) => Promise<T>
): Promise<T> {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((request, response) => {
    seen.push(request.headers);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(respond(request.url ?? "")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function contractView(subject: string): Record<string, unknown> {
  return {
    mode: "test",
    operator_id: `opr_${"a".repeat(24)}`,
    subject,
    role: "auditor",
    granted_capabilities: [...operatorCapabilities],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-15T00:00:00.000Z"
  };
}

describe("customer API operator client", () => {
  it("maps BFF operator subjects onto the synthetic operator subject space", () => {
    const subject = customerApiSubject("dev:compliance-lead");
    assert.match(subject, /^syn_oper_[0-9a-f]{24}$/);
    assert.equal(customerApiSubject("dev:compliance-lead"), subject);
    assert.notEqual(customerApiSubject("dev:auditor"), subject);
  });

  it("reports not-configured without a base URL or token key", async () => {
    for (const options of [{}, { baseUrl: "http://127.0.0.1:9" }, { devTokenKey: "0".repeat(64) }]) {
      const client = createCustomerApiClient(options);
      assert.equal(client.configured, false);
      assert.deepEqual(
        await client.operatorAdmin("dev:auditor", testDeviceId, Date.now()),
        { status: "not-configured" }
      );
    }
  });

  it("reads the operator admin view from the dev customer API", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      assert.equal(client.configured, true);
      const result = await client.operatorAdmin("dev:compliance-lead", testDeviceId, Date.now());
      assert.equal(result.status, "ok");
      if (result.status !== "ok") return;
      assert.equal(result.view.mode, "test");
      assert.match(result.view.operator_id, /^opr_[0-9a-f]{24}$/);
      assert.equal(result.view.subject, customerApiSubject("dev:compliance-lead"));
      assert.match(result.view.role, /^(compliance-lead|support-l1|aml-investigator|fraud-investigator|auditor)$/);
      assert.deepEqual(result.view.granted_capabilities, operatorCapabilities);
      assert.ok(Date.parse(result.view.updated_at) >= Date.parse(result.view.created_at));
      const wrongKey = createCustomerApiClient({ baseUrl, devTokenKey: randomBytes(32).toString("hex") });
      assert.deepEqual(
        await wrongKey.operatorAdmin("dev:compliance-lead", testDeviceId, Date.now()),
        { status: "unavailable" }
      );
    });
  });

  it("sends exactly the operator request headers including X-Device-Id", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("dev:compliance-lead");
    await withFakeApi(
      () => contractView(subject),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorAdmin("dev:compliance-lead", testDeviceId, Date.now());
        assert.equal(result.status, "ok");
        assert.equal(seen.length, 1);
        const headers = seen[0];
        assert.equal(headers["x-device-id"], testDeviceId);
        assert.equal(headers["x-platform"], customerApiPlatform);
        assert.equal(headers["x-client-version"], "solidchange-backoffice-bff/0.1.0");
        assert.match(String(headers["x-request-id"]), uuidV7);
        assert.match(
          String(headers.authorization),
          new RegExp(`^Bearer sodev1\\.${subject}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
        );
      }
    );
  });

  it("never emits a malformed X-Device-Id", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("dev:auditor");
    await withFakeApi(
      () => contractView(subject),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        for (const deviceId of [
          "not-a-uuid",
          "F47AC10B-58CC-4372-A567-0E02B2C3D479",
          "f47ac10b-58cc-3372-a567-0e02b2c3d479",
          ""
        ]) {
          assert.deepEqual(
            await client.operatorAdmin("dev:auditor", deviceId, Date.now()),
            { status: "unavailable" },
            deviceId
          );
        }
        assert.equal(seen.length, 0);
      }
    );
  });

  it("fails closed on contract drift", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("dev:auditor");
    const good = contractView(subject);
    const drifts: Record<string, unknown>[] = [
      { ...good, extra: true },
      (({ mode: _mode, ...rest }) => rest)(good),
      { ...good, mode: "live" },
      { ...good, operator_id: "opr_zzzzzzzzzzzzzzzzzzzzzzzz" },
      { ...good, operator_id: 42 },
      { ...good, subject: "syn_oper_someoneelse00" },
      { ...good, role: "superadmin" },
      { ...good, role: "auditor", granted_capabilities: ["operator.admin.read", "operator.admin.read"] },
      { ...good, granted_capabilities: Array.from({ length: 33 }, (_, index) => `cap.${index}`) },
      { ...good, granted_capabilities: [""] },
      { ...good, granted_capabilities: [`x${"y".repeat(128)}`] },
      { ...good, granted_capabilities: [42] },
      { ...good, created_at: "2026-09-01" },
      { ...good, created_at: "not-a-date" },
      { ...good, updated_at: "2026-08-01T00:00:00.000Z" }
    ];
    for (const body of drifts) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.operatorAdmin("dev:auditor", testDeviceId, Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
  });

  it("reports every non-200 upstream outcome as unavailable, never denied", async () => {
    const key = randomBytes(32).toString("hex");
    for (const status of [400, 401, 403, 404, 500]) {
      const server = createServer((_request, response) => {
        response.statusCode = status;
        response.end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorAdmin("dev:auditor", testDeviceId, Date.now()),
          { status: "unavailable" },
          String(status)
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    const unreachable = createCustomerApiClient({
      baseUrl: "http://127.0.0.1:9",
      devTokenKey: key,
      timeoutMs: 500
    });
    assert.deepEqual(
      await unreachable.operatorAdmin("dev:auditor", testDeviceId, Date.now()),
      { status: "unavailable" }
    );
  });

  it("fails closed on non-JSON content types and oversized bodies", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("dev:auditor");
    const body = JSON.stringify(contractView(subject));
    const oversized = JSON.stringify({ ...contractView(subject), padding: "x".repeat(maxCustomerApiResponseBytes) });
    assert.ok(Buffer.byteLength(oversized) > maxCustomerApiResponseBytes);
    const cases: [string, string | undefined, string][] = [
      ["control", "application/json; charset=utf-8", body],
      ["text/html", "text/html", body],
      ["missing", undefined, body],
      ["oversized", "application/json", oversized]
    ];
    for (const [label, contentType, payload] of cases) {
      const server = createServer((_request, response) => {
        if (contentType !== undefined) response.setHeader("content-type", contentType);
        response.end(payload);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorAdmin("dev:auditor", testDeviceId, Date.now());
        if (label === "control") {
          assert.equal(result.status, "ok");
        } else {
          assert.deepEqual(result, { status: "unavailable" }, label);
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });
});
