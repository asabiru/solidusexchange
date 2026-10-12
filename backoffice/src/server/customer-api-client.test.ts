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
  "operator.admin.read",
  "operator.subjects.read",
  "operator.queue.read"
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

function subjectsView(): { mode: string; subjects: Record<string, unknown>[] } {
  return {
    mode: "test",
    subjects: [{
      subject_id: "syn_cust_00112233445566778899aabb",
      display_name: "Alina Mironova",
      kyc_status: "verified",
      flags: 2,
      registered_at: "2026-09-05T00:00:00.000Z",
      last_active_at: "2026-09-25T00:00:00.000Z",
      posting: "none"
    }]
  };
}

function subjectDetailView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject_id: "syn_cust_00112233445566778899aabb",
    display_name: "Alina Mironova",
    kyc_status: "verified",
    flags: 2,
    registered_at: "2026-09-05T00:00:00.000Z",
    last_active_at: "2026-09-25T00:00:00.000Z",
    posting: "none",
    account_status: "active",
    contact_hash: `cth_${"c".repeat(32)}`,
    sessions: 3,
    devices: [`dev_${"d".repeat(16)}`],
    limits: { max_sessions: 8, max_devices: 4 },
    recent_activity: [
      {
        activity_id: `opact_${"e".repeat(24)}`,
        kind: "kyc_transition",
        occurred_at: "2026-09-20T10:00:00.000Z",
        summary: "approved",
        money: null
      },
      {
        activity_id: `act_${"f".repeat(24)}`,
        kind: "withdrawal",
        occurred_at: "2026-09-19T10:00:00.000Z",
        summary: "confirmed",
        money: { amount: "0.500000", asset: "USDT" }
      }
    ],
    kyc: {
      status: "approved",
      level: "enhanced",
      session_id: `kys_${"a".repeat(24)}`,
      history: [
        {
          session_id: `kys_${"a".repeat(24)}`,
          state: "approved",
          submitted_at: "2026-09-15T10:00:00.000Z",
          decided_at: "2026-09-20T10:00:00.000Z",
          rejection_reason: null
        },
        {
          session_id: `kys_${"b".repeat(24)}`,
          state: "rejected",
          submitted_at: "2026-09-10T08:00:00.000Z",
          decided_at: "2026-09-12T09:00:00.000Z",
          rejection_reason: "SIM_DATA_MISMATCH"
        }
      ]
    },
    ...overrides
  };
}

function subjectView(overrides: Record<string, unknown> = {}): { mode: string; subject: Record<string, unknown> } {
  return { mode: "test", subject: subjectDetailView(overrides) };
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

  it("reports not-configured for the subjects read without a base URL or token key", async () => {
    for (const options of [{}, { baseUrl: "http://127.0.0.1:9" }, { devTokenKey: "0".repeat(64) }]) {
      const client = createCustomerApiClient(options);
      assert.equal(client.configured, false);
      assert.deepEqual(
        await client.operatorSubjects("dev:auditor", testDeviceId, Date.now()),
        { status: "not-configured" }
      );
    }
  });

  it("reads the operator subjects view from the dev customer API", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      const result = await client.operatorSubjects("dev:compliance-lead", testDeviceId, Date.now());
      assert.equal(result.status, "ok");
      if (result.status !== "ok") return;
      assert.equal(result.view.mode, "test");
      assert.ok(result.view.subjects.length >= 1);
      const seen = new Set<string>();
      for (const row of result.view.subjects) {
        assert.match(row.subject_id, /^syn_cust_[a-z0-9]{8,32}$/);
        assert.equal(seen.has(row.subject_id), false);
        seen.add(row.subject_id);
        assert.match(row.display_name, /^[A-Z][a-z]{1,31} [A-Z][a-z]{1,31}$/);
        assert.match(row.kyc_status, /^(unverified|pending|verified)$/);
        assert.ok(Number.isInteger(row.flags) && row.flags >= 0);
        assert.ok(Date.parse(row.last_active_at) >= Date.parse(row.registered_at));
        assert.equal(row.posting, "none");
      }
      const wrongKey = createCustomerApiClient({ baseUrl, devTokenKey: randomBytes(32).toString("hex") });
      assert.deepEqual(
        await wrongKey.operatorSubjects("dev:compliance-lead", testDeviceId, Date.now()),
        { status: "unavailable" }
      );
    });
  });

  it("sends the same operator request headers on the subjects read", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("dev:auditor");
    await withFakeApi(
      () => subjectsView(),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorSubjects("dev:auditor", testDeviceId, Date.now());
        assert.equal(result.status, "ok");
        assert.equal(seen.length, 1);
        const headers = seen[0];
        assert.equal(headers["x-device-id"], testDeviceId);
        assert.equal(headers["x-platform"], customerApiPlatform);
        assert.match(String(headers["x-request-id"]), uuidV7);
        assert.match(
          String(headers.authorization),
          new RegExp(`^Bearer sodev1\\.${subject}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
        );
      }
    );
  });

  it("never emits a malformed X-Device-Id on the subjects read", async () => {
    const key = randomBytes(32).toString("hex");
    await withFakeApi(
      () => subjectsView(),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        for (const deviceId of ["not-a-uuid", "", "F47AC10B-58CC-4372-A567-0E02B2C3D479"]) {
          assert.deepEqual(
            await client.operatorSubjects("dev:auditor", deviceId, Date.now()),
            { status: "unavailable" },
            deviceId
          );
        }
        assert.equal(seen.length, 0);
      }
    );
  });

  it("fails closed on subjects contract drift", async () => {
    const key = randomBytes(32).toString("hex");
    const good = subjectsView();
    const row = (overrides: Record<string, unknown> = {}) => ({ ...subjectsView().subjects[0], ...overrides });
    const drifts: Record<string, unknown>[] = [
      { ...good, extra: true },
      { subjects: good.subjects },
      { ...good, mode: "live" },
      { ...good, subjects: [] },
      { ...good, subjects: [...good.subjects, ...Array.from({ length: 64 }, (_v, i) => row({ subject_id: `syn_cust_extra${String(i).padStart(18, "0")}` }))] },
      { ...good, subjects: [row(), row()] },
      { ...good, subjects: [row({ subject_id: "syn_oper_00000001" })] },
      { ...good, subjects: [row({ display_name: "alina mironova" })] },
      { ...good, subjects: [row({ kyc_status: "approved" })] },
      { ...good, subjects: [row({ flags: -1 })] },
      { ...good, subjects: [row({ flags: 1.5 })] },
      { ...good, subjects: [row({ registered_at: "2026-09-01" })] },
      { ...good, subjects: [row({ registered_at: "2026-09-10T00:00:00.000Z", last_active_at: "2026-09-05T00:00:00.000Z" })] },
      { ...good, subjects: [row({ posting: "pending" })] },
      { ...good, subjects: [{ ...row(), wallet_address: "0xabc" }] },
      { ...good, subjects: [null] }
    ];
    for (const body of drifts) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.operatorSubjects("dev:auditor", testDeviceId, Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
  });

  it("reports every non-200 upstream outcome on the subjects read as unavailable", async () => {
    const key = randomBytes(32).toString("hex");
    for (const status of [400, 401, 403, 500]) {
      const server = createServer((_request, response) => {
        response.statusCode = status;
        response.end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorSubjects("dev:auditor", testDeviceId, Date.now()),
          { status: "unavailable" },
          String(status)
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on subjects responses that are non-JSON or oversized", async () => {
    const key = randomBytes(32).toString("hex");
    const oversized = JSON.stringify({ mode: "test", subjects: [subjectsView().subjects[0]], padding: "x".repeat(maxCustomerApiResponseBytes) });
    assert.ok(Buffer.byteLength(oversized) > maxCustomerApiResponseBytes);
    for (const [label, contentType, payload] of [
      ["text/html", "text/html", JSON.stringify(subjectsView())],
      ["oversized", "application/json", oversized]
    ] as [string, string, string][]) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", contentType);
        response.end(payload);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorSubjects("dev:auditor", testDeviceId, Date.now()),
          { status: "unavailable" },
          label
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
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

  it("reports not-configured for the subject detail read without a base URL or token key", async () => {
    for (const options of [{}, { baseUrl: "http://127.0.0.1:9" }, { devTokenKey: "0".repeat(64) }]) {
      const client = createCustomerApiClient(options);
      assert.equal(client.configured, false);
      assert.deepEqual(
        await client.operatorSubject("dev:auditor", testDeviceId, "syn_cust_00112233445566778899aabb", Date.now()),
        { status: "not-configured" }
      );
    }
  });

  it("reads the operator subject detail from the dev customer API", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // A real roster id comes from the sibling list read — the detail for the
      // same id must extend that exact row.
      const list = await client.operatorSubjects("dev:compliance-lead", testDeviceId, Date.now());
      assert.equal(list.status, "ok");
      if (list.status !== "ok") return;
      const row = list.view.subjects[0];
      const result = await client.operatorSubject("dev:compliance-lead", testDeviceId, row.subject_id, Date.now());
      assert.equal(result.status, "ok");
      if (result.status !== "ok") return;
      assert.equal(result.view.mode, "test");
      const subject = result.view.subject;
      assert.equal(subject.subject_id, row.subject_id);
      assert.equal(subject.display_name, row.display_name);
      assert.equal(subject.kyc_status, row.kyc_status);
      assert.equal(subject.flags, row.flags);
      assert.equal(subject.registered_at, row.registered_at);
      assert.equal(subject.last_active_at, row.last_active_at);
      assert.equal(subject.posting, "none");
      assert.match(subject.account_status, /^(active|dormant|restricted|closed)$/);
      assert.match(subject.contact_hash, /^cth_[0-9a-f]{32}$/);
      assert.ok(Number.isInteger(subject.sessions) && subject.sessions >= 0);
      assert.ok(subject.sessions <= subject.limits.max_sessions);
      assert.ok(subject.devices.length <= subject.limits.max_devices);
      for (const device of subject.devices) {
        assert.match(device, /^dev_[0-9a-f]{16}$/);
      }
      // The recent activity page parses to a bounded newest-first list.
      assert.ok(subject.recent_activity.length >= 1 && subject.recent_activity.length <= 8);
      for (let index = 1; index < subject.recent_activity.length; index += 1) {
        const prev = subject.recent_activity[index - 1];
        const next = subject.recent_activity[index];
        assert.ok(
          next.occurred_at < prev.occurred_at
            || (next.occurred_at === prev.occurred_at && next.activity_id > prev.activity_id),
          `ordering at ${index}`
        );
      }
      // Unknown ids share the uniform not-found — no existence leak.
      assert.deepEqual(
        await client.operatorSubject("dev:compliance-lead", testDeviceId, `syn_cust_${"f".repeat(24)}`, Date.now()),
        { status: "not-found" }
      );
      const wrongKey = createCustomerApiClient({ baseUrl, devTokenKey: randomBytes(32).toString("hex") });
      assert.deepEqual(
        await wrongKey.operatorSubject("dev:compliance-lead", testDeviceId, row.subject_id, Date.now()),
        { status: "unavailable" }
      );
    });
  });

  it("sends the same operator request headers on the subject detail read", async () => {
    const key = randomBytes(32).toString("hex");
    const subject = customerApiSubject("dev:auditor");
    await withFakeApi(
      () => subjectView(),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorSubject(
          "dev:auditor", testDeviceId, "syn_cust_00112233445566778899aabb", Date.now()
        );
        assert.equal(result.status, "ok");
        assert.equal(seen.length, 1);
        const headers = seen[0];
        assert.equal(headers["x-device-id"], testDeviceId);
        assert.equal(headers["x-platform"], customerApiPlatform);
        assert.match(String(headers["x-request-id"]), uuidV7);
        assert.match(
          String(headers.authorization),
          new RegExp(`^Bearer sodev1\\.${subject}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
        );
      }
    );
  });

  it("never emits a malformed X-Device-Id on the subject detail read", async () => {
    const key = randomBytes(32).toString("hex");
    await withFakeApi(
      () => subjectView(),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        for (const deviceId of ["not-a-uuid", "", "F47AC10B-58CC-4372-A567-0E02B2C3D479"]) {
          assert.deepEqual(
            await client.operatorSubject("dev:auditor", deviceId, "syn_cust_00112233445566778899aabb", Date.now()),
            { status: "unavailable" },
            deviceId
          );
        }
        assert.equal(seen.length, 0);
      }
    );
  });

  it("answers non-contract subject ids locally without an upstream call", async () => {
    const key = randomBytes(32).toString("hex");
    await withFakeApi(
      () => subjectView(),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        for (const subjectId of ["not-an-id", "syn_oper_00000001", "syn_cust_00112233445566778899aabb/extra", ""]) {
          assert.deepEqual(
            await client.operatorSubject("dev:auditor", testDeviceId, subjectId, Date.now()),
            { status: "not-found" },
            subjectId
          );
        }
        assert.equal(seen.length, 0);
      }
    );
  });

  it("fails closed on subject detail contract drift", async () => {
    const key = randomBytes(32).toString("hex");
    const good = subjectView();
    const detail = (overrides: Record<string, unknown> = {}) => subjectView(overrides);
    const limits = (overrides: Record<string, unknown> = {}) => ({ max_sessions: 8, max_devices: 4, ...overrides });
    const kycFixture = (subjectDetailView().kyc ?? {}) as Record<string, unknown> & { history: Record<string, unknown>[] };
    const drifts: Record<string, unknown>[] = [
      { ...good, extra: true },
      { subject: good.subject },
      { ...good, mode: "live" },
      { ...good, subject: null },
      detail({ subject_id: "syn_oper_00000001" }),
      detail({ display_name: "alina mironova" }),
      detail({ kyc_status: "approved" }),
      detail({ flags: -1 }),
      detail({ flags: 1.5 }),
      detail({ registered_at: "2026-09-01" }),
      detail({ registered_at: "2026-09-10T00:00:00.000Z", last_active_at: "2026-09-05T00:00:00.000Z" }),
      detail({ posting: "pending" }),
      detail({ account_status: "suspended" }),
      detail({ contact_hash: "a@b.test" }),
      detail({ sessions: -1 }),
      detail({ sessions: 1.5 }),
      detail({ sessions: 17 }),
      detail({ sessions: 9 }),
      detail({ devices: "dev_0011223344556677" }),
      detail({ devices: [`dev_${"d".repeat(16)}`, `dev_${"d".repeat(16)}`] }),
      detail({ devices: [...Array.from({ length: 9 }, (_v, i) => `dev_${String(i).padStart(16, "0")}`)] }),
      detail({ devices: ["not-a-device"] }),
      detail({ devices: [`dev_${"a".repeat(16)}`, `dev_${"d".repeat(16)}`], limits: limits({ max_devices: 1 }) }),
      detail({ limits: { max_sessions: 8 } }),
      detail({ limits: limits({ extra: 1 }) }),
      detail({ limits: limits({ max_sessions: 0 }) }),
      detail({ limits: limits({ max_sessions: 17 }) }),
      detail({ limits: limits({ max_devices: 0 }) }),
      detail({ limits: limits({ max_devices: 9 }) }),
      detail({ wallet_address: "0xabc" }),
      detail({ recent_activity: [] }),
      detail({ recent_activity: "not-an-array" }),
      detail({ recent_activity: [
        { activity_id: `act_${"f".repeat(24)}`, kind: "withdrawal", occurred_at: "2026-09-19T10:00:00.000Z", summary: "confirmed", money: { amount: "0.500000", asset: "USDT" } },
        { activity_id: `opact_${"e".repeat(24)}`, kind: "kyc_transition", occurred_at: "2026-09-20T10:00:00.000Z", summary: "approved", money: null }
      ] }),
      detail({ recent_activity: [{ activity_id: `opact_${"e".repeat(24)}`, kind: "flag_added", occurred_at: "2026-09-20T10:00:00.000Z", summary: "structuring", money: { amount: "1.00", asset: "RUB" } }] }),
      detail({ recent_activity: [{ activity_id: `act_${"0".repeat(24)}`, kind: "deposit", occurred_at: "2026-09-20T10:00:00.000Z", summary: "approved", money: null }] }),
      detail({ kyc: "dossier" }),
      detail({ kyc: {} }),
      detail({ kyc: { ...kycFixture, level: "premium" } }),
      detail({ kyc: { ...kycFixture, status: "unavailable" } }),
      detail({ kyc: { ...kycFixture, status: "rejected" } }),
      detail({ kyc: { ...kycFixture, session_id: "kys_nothex" } }),
      detail({ kyc: { ...kycFixture, session_id: `kys_${"0".repeat(24)}` } }),
      detail({ kyc: { ...kycFixture, history: [] } }),
      detail({ kyc: { ...kycFixture, history: [...kycFixture.history].reverse() } }),
      detail({ kyc: { ...kycFixture, history: kycFixture.history.map((attempt: Record<string, unknown>) => ({ ...attempt, session_id: `kys_${"0".repeat(24)}` })) } }),
      detail({ kyc: { ...kycFixture, history: [{ ...kycFixture.history[0], decided_at: null }, ...kycFixture.history.slice(1)] } }),
      detail({ kyc: { ...kycFixture, history: [{ ...kycFixture.history[0], rejection_reason: "SIM_DATA_MISMATCH" }, ...kycFixture.history.slice(1)] } }),
      detail({ kyc: { ...kycFixture, history: [kycFixture.history[0], { ...kycFixture.history[1], state: "approved" }] } }),
      detail({ kyc_status: "pending", kyc: kycFixture })
    ];
    for (const body of drifts) {
      await withFakeApi(
        () => body,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.operatorSubject("dev:auditor", testDeviceId, "syn_cust_00112233445566778899aabb", Date.now()),
            { status: "unavailable" },
            JSON.stringify(body)
          );
        }
      );
    }
  });

  it("maps upstream 404 to not-found and other non-200s to unavailable on the detail read", async () => {
    const key = randomBytes(32).toString("hex");
    for (const [status, expected] of [
      [400, "unavailable"],
      [401, "unavailable"],
      [403, "unavailable"],
      [404, "not-found"],
      [429, "unavailable"],
      [500, "unavailable"]
    ] as [number, string][]) {
      const server = createServer((_request, response) => {
        response.statusCode = status;
        response.end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorSubject("dev:auditor", testDeviceId, "syn_cust_00112233445566778899aabb", Date.now()),
          { status: expected },
          String(status)
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });

  it("fails closed on subject detail responses that are non-JSON or oversized", async () => {
    const key = randomBytes(32).toString("hex");
    const oversized = JSON.stringify({ ...subjectView(), padding: "x".repeat(maxCustomerApiResponseBytes) });
    assert.ok(Buffer.byteLength(oversized) > maxCustomerApiResponseBytes);
    for (const [label, contentType, payload] of [
      ["text/html", "text/html", JSON.stringify(subjectView())],
      ["oversized", "application/json", oversized]
    ] as [string, string, string][]) {
      const server = createServer((_request, response) => {
        response.setHeader("content-type", contentType);
        response.end(payload);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorSubject("dev:auditor", testDeviceId, "syn_cust_00112233445566778899aabb", Date.now()),
          { status: "unavailable" },
          label
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });
});

describe("operatorQueue", () => {
  it("reads every queue kind from the dev customer API with the kind query", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      for (const kind of ["kyc", "aml", "tickets"] as const) {
        const result = await client.operatorQueue("dev:auditor", testDeviceId, kind, Date.now());
        assert.equal(result.status, "ok", kind);
        if (result.status !== "ok") continue;
        assert.equal(result.view.mode, "test");
        assert.equal(result.view.queue.kind, kind);
        assert.equal(result.view.queue.posting, "none");
        assert.equal(result.view.queue.summary.count, result.view.queue.items.length);
        for (const item of result.view.queue.items) {
          assert.match(item.subject_id, /^syn_cust_[a-z0-9]{8,32}$/);
          assert.match(item.priority, /^(normal|high|urgent)$/);
          assert.ok(Number.isInteger(item.age_ms) && item.age_ms >= 0);
        }
      }
    });
  });

  it("sends the kind query and the operator headers upstream", async () => {
    const key = randomBytes(32).toString("hex");
    const seenUrls: (string | undefined)[] = [];
    await withFakeApi(
      (path) => {
        seenUrls.push(path);
        return {
          mode: "test",
          queue: {
            kind: "aml",
            items: [{
              queue_id: "qml_00112233445566778899aabb",
              subject_id: "syn_cust_00112233445566778899aabb",
              alert_type: "velocity",
              evidence_refs: ["evd_00112233445566778899aabb"],
              sla_due_at: "2026-09-23T00:00:00.000Z",
              state: "pending",
              priority: "normal",
              assignee: null,
              age_ms: 1_000_000
            }],
            summary: { count: 1, by_state: { pending: 1, in_review: 0, escalated: 0 } },
            posting: "none"
          }
        };
      },
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorQueue("dev:auditor", testDeviceId, "aml", Date.now());
        assert.equal(result.status, "ok");
        assert.equal(seenUrls[0], "/api/v1/operator/queue?kind=aml");
        assert.equal(seen[0]["x-device-id"], testDeviceId);
        assert.match(
          String(seen[0].authorization),
          new RegExp(`^Bearer sodev1\\.${customerApiSubject("dev:auditor")}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
        );
      }
    );
  });

  it("answers malformed device ids and never reaches upstream for any kind", async () => {
    const key = randomBytes(32).toString("hex");
    let calls = 0;
    await withFakeApi(
      () => {
        calls += 1;
        return { status: "ok" };
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        for (const kind of ["kyc", "aml", "tickets"] as const) {
          assert.deepEqual(await client.operatorQueue("dev:auditor", "not-a-device", kind, Date.now()), { status: "unavailable" }, kind);
        }
        assert.equal(calls, 0);
      }
    );
  });

  it("fails closed on a kind-mismatched view (aml requested, kyc answered)", async () => {
    const key = randomBytes(32).toString("hex");
    await withFakeApi(
      () => ({
        mode: "test",
        queue: {
          kind: "kyc",
          items: [],
          summary: { count: 0, by_state: { pending: 0, in_review: 0, escalated: 0 } },
          posting: "none"
        }
      }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(await client.operatorQueue("dev:auditor", testDeviceId, "aml", Date.now()), { status: "unavailable" });
      }
    );
  });
});
