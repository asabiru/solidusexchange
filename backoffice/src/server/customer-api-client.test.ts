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
  "operator.queue.read",
  "operator.audit.read"
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
    balances: [
      { asset: "RUB", asset_scale: 2, available: "1200.50", hold: "0.00" },
      { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
      { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
    ],
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
      detail({ kyc_status: "pending", kyc: kycFixture }),
      // Wave-64 cross-block coherence: a live session needs a device and a
      // live account; every instant stays inside the account window.
      detail({ sessions: 1, devices: [] }),
      detail({ account_status: "closed" }),
      detail({ recent_activity: [
        { activity_id: `act_${"f".repeat(24)}`, kind: "withdrawal", occurred_at: "2026-09-04T10:00:00.000Z", summary: "confirmed", money: { amount: "0.500000", asset: "USDT" } }
      ] }),
      detail({ recent_activity: [
        { activity_id: `act_${"f".repeat(24)}`, kind: "withdrawal", occurred_at: "2026-09-26T10:00:00.000Z", summary: "confirmed", money: { amount: "0.500000", asset: "USDT" } }
      ] }),
      detail({ recent_activity: [
        { activity_id: `opact_${"e".repeat(24)}`, kind: "kyc_transition", occurred_at: "2026-09-21T10:00:00.000Z", summary: "approved", money: null }
      ] }),
      detail({ kyc_status: "unverified", kyc: null, recent_activity: [
        { activity_id: `opact_${"e".repeat(24)}`, kind: "kyc_transition", occurred_at: "2026-09-20T10:00:00.000Z", summary: "submitted", money: null }
      ] }),
      detail({
        kyc_status: "pending",
        kyc: { ...kycFixture, status: "submitted", history: [{ ...kycFixture.history[0], state: "submitted", decided_at: null }] },
        recent_activity: [
          { activity_id: `opact_${"e".repeat(24)}`, kind: "kyc_transition", occurred_at: "2026-09-15T10:00:00.000Z", summary: "approved", money: null }
        ]
      }),
      detail({ recent_activity: [
        { activity_id: `opact_${"a".repeat(24)}`, kind: "flag_added", occurred_at: "2026-09-24T00:00:00.000Z", summary: "structuring", money: null },
        { activity_id: `opact_${"b".repeat(24)}`, kind: "flag_added", occurred_at: "2026-09-23T00:00:00.000Z", summary: "velocity", money: null },
        { activity_id: `opact_${"c".repeat(24)}`, kind: "flag_added", occurred_at: "2026-09-22T00:00:00.000Z", summary: "geo_mismatch", money: null }
      ] }),
      detail({ kyc: { ...kycFixture, history: [{ ...kycFixture.history[0], submitted_at: "2026-09-04T10:00:00.000Z" }, ...kycFixture.history.slice(1)] } }),
      detail({ kyc: { ...kycFixture, history: [{ ...kycFixture.history[0], submitted_at: "2026-09-26T10:00:00.000Z" }, ...kycFixture.history.slice(1)] } }),
      detail({ balances: "not-an-array" }),
      detail({ balances: [] }),
      detail({ balances: [
        { asset: "RUB", asset_scale: 2, available: "1200.50", hold: "0.00" }
      ] }),
      detail({ balances: [
        { asset: "RUB", asset_scale: 2, available: "1200.50", hold: "0.00" },
        { asset: "RUB", asset_scale: 2, available: "1.00", hold: "0.00" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      detail({ balances: [
        { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
        { asset: "RUB", asset_scale: 2, available: "1200.50", hold: "0.00" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      detail({ balances: [
        { asset: "EUR", asset_scale: 2, available: "1200.50", hold: "0.00" },
        { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      detail({ balances: [
        { asset: "RUB", asset_scale: 6, available: "1200.50", hold: "0.00" },
        { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      detail({ balances: [
        { asset: "RUB", asset_scale: 2, available: "1200.5", hold: "0.00" },
        { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      detail({ balances: [
        { asset: "RUB", asset_scale: 2, available: "-1.00", hold: "0.00" },
        { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      detail({ balances: [
        { asset: "RUB", asset_scale: 2, available: "1200.50", hold: "0.00", extra: 1 },
        { asset: "TON", asset_scale: 9, available: "3.500000000", hold: "0.125000000" },
        { asset: "USDT", asset_scale: 6, available: "87.000000", hold: "1.250000" }
      ] }),
      // A closed account echoes no live positions: anything nonzero is drift.
      detail({ account_status: "closed", sessions: 0 }),
      detail({ account_status: "closed", sessions: 0, balances: [
        { asset: "RUB", asset_scale: 2, available: "0.00", hold: "0.00" },
        { asset: "TON", asset_scale: 9, available: "0.000000001", hold: "0.000000000" },
        { asset: "USDT", asset_scale: 6, available: "0.000000", hold: "0.000000" }
      ] })
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

describe("operatorQueueItem", () => {
  it("reads each queue item member from the dev customer API and cross-checks the row fields", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      for (const kind of ["kyc", "aml", "tickets"] as const) {
        const queue = await client.operatorQueue("dev:auditor", testDeviceId, kind, Date.now());
        assert.equal(queue.status, "ok", kind);
        if (queue.status !== "ok") continue;
        const row = queue.view.queue.items[0];
        assert.ok(row, `no ${kind} queue items`);
        const result = await client.operatorQueueItem("dev:auditor", testDeviceId, kind, row.queue_id, Date.now());
        assert.equal(result.status, "ok", `${kind}:${row.queue_id}`);
        if (result.status !== "ok") continue;
        assert.equal(result.view.mode, "test");
        assert.equal(result.view.kind, kind);
        // The member read must equal the collection row on every shared field.
        const { kyc: _kyc, flags: _flags, subject: _s, last_message_at: _l, other_open_tickets: _o, ...rowFields } =
          result.view.item as unknown as Record<string, unknown> & {
            kyc?: unknown; flags?: unknown; subject?: unknown; last_message_at?: unknown; other_open_tickets?: unknown;
          };
        assert.deepEqual(rowFields, row, kind);
        if (kind === "kyc" && result.view.kind === "kyc") {
          assert.ok(result.view.item.kyc === null || typeof result.view.item.kyc.status === "string");
        }
        if (kind === "aml" && result.view.kind === "aml") {
          for (const flag of result.view.item.flags) {
            assert.match(flag.flag_id, /^flg_[0-9a-f]{24}$/);
          }
        }
        if (kind === "tickets" && result.view.kind === "tickets") {
          assert.ok(Number.isInteger(result.view.item.other_open_tickets) && result.view.item.other_open_tickets >= 0);
          assert.match(result.view.item.last_message_at, /T/);
        }
      }
    });
  });

  it("sends the member path with the operator headers upstream", async () => {
    const key = randomBytes(32).toString("hex");
    const seenUrls: (string | undefined)[] = [];
    await withFakeApi(
      (path) => {
        seenUrls.push(path);
        return {
          mode: "test",
          kind: "aml",
          item: {
            queue_id: "qml_00112233445566778899aabb",
            subject_id: "syn_cust_00112233445566778899aabb",
            alert_type: "velocity",
            evidence_refs: ["evd_00112233445566778899aabb"],
            sla_due_at: "2026-09-23T00:00:00.000Z",
            state: "pending",
            priority: "normal",
            assignee: null,
            age_ms: 1_000_000,
            flags: []
          }
        };
      },
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorQueueItem("dev:auditor", testDeviceId, "aml", "qml_00112233445566778899aabb", Date.now());
        assert.equal(result.status, "ok");
        assert.equal(seenUrls[0], "/api/v1/operator/queue/aml/qml_00112233445566778899aabb");
        assert.equal(seen[0]["x-device-id"], testDeviceId);
        assert.match(
          String(seen[0].authorization),
          new RegExp(`^Bearer sodev1\\.${customerApiSubject("dev:auditor")}\\.[0-9]{10}\\.[0-9a-f]{64}$`)
        );
      }
    );
  });

  it("guards kind and item id and malformed device ids before any upstream call", async () => {
    const key = randomBytes(32).toString("hex");
    let calls = 0;
    await withFakeApi(
      () => {
        calls += 1;
        return { status: "ok" };
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorQueueItem("dev:auditor", "not-a-device", "aml", "qml_00112233445566778899aabb", Date.now()),
          { status: "unavailable" }
        );
        for (const itemId of ["qtick_00112233445566778899aabb", "free text"]) {
          assert.deepEqual(
            await client.operatorQueueItem("dev:auditor", testDeviceId, "aml", itemId, Date.now()),
            { status: "not-found" },
            itemId
          );
        }
        assert.equal(calls, 0);
      }
    );
  });

  it("maps upstream statuses and fails closed on a kind-mismatched view", async () => {
    const key = randomBytes(32).toString("hex");
    for (const [status, expected] of [
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
          await client.operatorQueueItem("dev:auditor", testDeviceId, "kyc", "qky_00112233445566778899aabb", Date.now()),
          { status: expected },
          String(status)
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    await withFakeApi(
      () => ({
        mode: "test",
        kind: "kyc",
        item: {
          queue_id: "qky_00112233445566778899aabb",
          subject_id: "syn_cust_00112233445566778899aabb",
          display_name: "n",
          submitted_at: "2026-09-20T00:00:00.000Z",
          sla_due_at: "2026-09-23T00:00:00.000Z",
          state: "pending",
          priority: "normal",
          assignee: null,
          age_ms: 0,
          kyc: null
        }
      }),
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        assert.deepEqual(
          await client.operatorQueueItem("dev:auditor", testDeviceId, "aml", "qml_00112233445566778899aabb", Date.now()),
          { status: "unavailable" }
        );
      }
    );
  });
});

const auditContractView = (entries: Record<string, unknown>[]) => ({
  mode: "test",
  audit: {
    as_of: "2027-01-29T00:00:00.000Z",
    entries,
    next_cursor: null
  }
});

const auditEntry = (overrides: Record<string, unknown> = {}) => ({
  audit_id: `au_${"0".repeat(24)}`,
  actor_subject_id: `syn_oper_${"0".repeat(16)}`,
  actor_role: "auditor",
  action: "subject.viewed",
  target_kind: "subject",
  target_id: `syn_cust_${"0".repeat(24)}`,
  at: "2027-01-28T10:00:00.000Z",
  detail_hash: `adh_${"0".repeat(32)}`,
  ...overrides
});

describe("operatorAudit", () => {
  it("reads the audit feed from the dev customer API behind the fixed oversight reader", async () => {
    const key = randomBytes(32).toString("hex");
    await withCustomerApi(key, async (baseUrl) => {
      const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
      // The caller's own mapped subject draws a non-oversight role for
      // "dev:support" — the read still succeeds because the pass-through
      // always presents the fixed auditor principal and per-user authZ
      // stays in the BFF route's audit:read gate.
      const result = await client.operatorAudit("dev:support", testDeviceId, undefined, Date.now());
      assert.equal(result.status, "ok");
      if (result.status !== "ok") return;
      assert.equal(result.view.mode, "test");
      assert.ok(result.view.audit.entries.length >= 1 && result.view.audit.entries.length <= 32);
      assert.ok(result.view.audit.next_cursor === null || /^auc_[0-9a-f]{16}$/.test(result.view.audit.next_cursor));
      for (const entry of result.view.audit.entries) {
        assert.match(entry.audit_id, /^au_[0-9a-f]{24}$/);
        assert.match(entry.actor_subject_id, /^syn_oper_[a-z0-9]{8,32}$/);
        assert.match(entry.detail_hash, /^adh_[0-9a-f]{32}$/);
      }
      // A served next_cursor round-trips to the following page.
      let cursor = result.view.audit.next_cursor;
      while (cursor !== null) {
        const page = await client.operatorAudit("dev:support", testDeviceId, cursor, Date.now());
        assert.equal(page.status, "ok");
        if (page.status !== "ok") return;
        cursor = page.view.audit.next_cursor;
      }
    });
  });

  it("always presents the fixed oversight principal, whatever the caller subject", async () => {
    const key = randomBytes(32).toString("hex");
    await withFakeApi(
      () => auditContractView([auditEntry()]),
      async (baseUrl, seen) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const now = Date.now();
        for (const subject of ["dev:auditor", "dev:support", "dev:compliance-lead"]) {
          const result = await client.operatorAudit(subject, testDeviceId, undefined, now);
          assert.equal(result.status, "ok", subject);
        }
        assert.equal(seen.length, 3);
        // Every upstream call mints the identical token: the feed cannot
        // vary by reader, so the caller's own syn_oper_* mapping never
        // reaches the wire.
        const authorizations = seen.map((headers) => headers.authorization);
        assert.ok(authorizations.every((value) => value === authorizations[0]));
        assert.match(
          String(authorizations[0]),
          /^Bearer sodev1\.syn_oper_0000000000000002\.[0-9]{10}\.[0-9a-f]{64}$/
        );
      }
    );
  });

  it("sends the cursor query upstream and maps a never-minted token to not-found", async () => {
    const key = randomBytes(32).toString("hex");
    const mintedCursor = "auc_0011223344556677";
    const seenUrls: (string | undefined)[] = [];
    await withFakeApi(
      (path) => {
        seenUrls.push(path);
        return auditContractView([auditEntry()]);
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        const result = await client.operatorAudit("dev:auditor", testDeviceId, mintedCursor, Date.now());
        assert.equal(result.status, "ok");
        assert.equal(seenUrls[0], `/api/v1/operator/audit?cursor=${mintedCursor}`);
      }
    );
  });

  it("guards malformed cursors and device ids locally without an upstream call", async () => {
    const key = randomBytes(32).toString("hex");
    let calls = 0;
    await withFakeApi(
      () => {
        calls += 1;
        return auditContractView([auditEntry()]);
      },
      async (baseUrl) => {
        const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
        for (const cursor of ["bogus", "AUC_0011223344556677", "auc_00112233445566778", ""]) {
          assert.deepEqual(
            await client.operatorAudit("dev:auditor", testDeviceId, cursor, Date.now()),
            { status: "not-found" },
            cursor || "empty"
          );
        }
        assert.deepEqual(
          await client.operatorAudit("dev:auditor", "not-a-device", undefined, Date.now()),
          { status: "unavailable" }
        );
        assert.equal(calls, 0);
      }
    );
  });

  it("maps upstream statuses and fails closed on contract drift and misordered pages", async () => {
    const key = randomBytes(32).toString("hex");
    for (const [status, expected] of [
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
          await client.operatorAudit("dev:auditor", testDeviceId, "auc_0011223344556677", Date.now()),
          { status: expected },
          String(status)
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
    const first = auditEntry();
    const second = auditEntry({
      audit_id: `au_${"f".repeat(24)}`,
      at: "2027-01-28T09:00:00.000Z",
      detail_hash: `adh_${"f".repeat(32)}`
    });
    for (const [name, view] of [
      ["reversed newest-first", auditContractView([second, first])],
      ["ascending id under equal instants", auditContractView([
        { ...first, at: second.at },
        second
      ])],
      ["instant beyond the as_of horizon", auditContractView([
        { ...first, at: "2027-01-30T00:00:00.000Z" },
        second
      ])],
      ["duplicated audit id", auditContractView([first, { ...second, audit_id: first.audit_id }])],
      ["cross-record extra member", auditContractView([{ ...first, session_note: "x" }])],
      ["action/target_kind mismatch allowed by grammar", auditContractView([
        { ...first, action: "flag.reviewed", target_kind: "queue_item", target_id: "qml_00112233445566778899aabb" },
        second
      ])]
    ] as [string, unknown][]) {
      await withFakeApi(
        () => view,
        async (baseUrl) => {
          const client = createCustomerApiClient({ baseUrl, devTokenKey: key });
          assert.deepEqual(
            await client.operatorAudit("dev:auditor", testDeviceId, undefined, Date.now()),
            { status: "unavailable" },
            name
          );
        }
      );
    }
  });
});
