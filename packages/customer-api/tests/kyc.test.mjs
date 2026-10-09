import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory, KYC_STATUSES } from "../src/capabilities.mjs";
import {
  createSyntheticKycApplicationDirectory,
  KYC_APPLICATION_STATUSES,
  validKycStatusView
} from "../src/kyc.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  checkedRequest,
  customerHeaders,
  header,
  NOW_MS,
  REQUEST_ID,
  startTestServer,
  stopServer,
  SUBJECT,
  token,
  validator,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const KYC = "/api/v1/customer/kyc";
const APPLICATION_ID = /^kyc_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const REASON_CODES = ["SIM_DOCUMENT_UNREADABLE", "SIM_DATA_MISMATCH"];
const REQUESTED_ITEMS = ["proof_of_address", "selfie_retake"];

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic KYC directory returns deterministic frozen views per subject and session status", async () => {
  const directory = createSyntheticKycApplicationDirectory();
  for (const sessionKyc of KYC_STATUSES) {
    const first = await directory.viewFor(VERIFIED_SUBJECT, sessionKyc);
    const second = await directory.viewFor(VERIFIED_SUBJECT, sessionKyc);
    assert.equal(first, second);
    assert.ok(Object.isFrozen(first), sessionKyc);
    for (const key of ["reason_codes", "requested_items"]) {
      if (first[key] !== undefined) {
        assert.ok(Object.isFrozen(first[key]), `${sessionKyc} ${key}`);
      }
    }
    assert.equal(first.mode, "test");
    assert.equal(first.provider, "simulator");
    assert.equal(first.session_kyc, sessionKyc);
    assert.ok(KYC_APPLICATION_STATUSES.includes(first.status));
    assert.equal(typeof first.can_submit, "boolean");
    assert.match(first.updated_at, ISO_TIMESTAMP);
  }
  const other = await directory.viewFor(SUBJECT, "verified");
  const verified = await directory.viewFor(VERIFIED_SUBJECT, "verified");
  assert.notDeepEqual(other, verified);
});

test("the served application state can never contradict the session KYC status", async () => {
  const directory = createSyntheticKycApplicationDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000", "syn_cust_deadbeef"]) {
    const approved = await directory.viewFor(subject, "verified");
    assert.equal(approved.status, "approved", subject);
    assert.equal(approved.can_submit, false);
    assert.match(approved.application_id, APPLICATION_ID);
    assert.match(approved.submitted_at, ISO_TIMESTAMP);
    const pending = await directory.viewFor(subject, "pending");
    assert.ok(["submitted", "in_review"].includes(pending.status), `${subject} ${pending.status}`);
    assert.equal(pending.can_submit, false);
    assert.match(pending.review_deadline, ISO_TIMESTAMP);
    const unverified = await directory.viewFor(subject, "unverified");
    assert.ok(
      ["not_started", "rejected", "needs_more_data", "timed_out", "unavailable"].includes(unverified.status),
      `${subject} ${unverified.status}`
    );
    assert.equal(unverified.can_submit, true);
    if (unverified.status === "not_started" || unverified.status === "unavailable") {
      assert.equal(Object.hasOwn(unverified, "application_id"), false, subject);
      assert.equal(Object.hasOwn(unverified, "submitted_at"), false, subject);
    } else {
      assert.match(unverified.application_id, APPLICATION_ID, subject);
      assert.match(unverified.submitted_at, ISO_TIMESTAMP, subject);
    }
    if (unverified.status === "rejected") {
      assert.ok(unverified.reason_codes.every((code) => REASON_CODES.includes(code)), subject);
    }
    if (unverified.status === "needs_more_data") {
      assert.ok(unverified.requested_items.every((item) => REQUESTED_ITEMS.includes(item)), subject);
    }
  }
});

test("every derived view conforms to the declared KycStatusView schema", async () => {
  const directory = createSyntheticKycApplicationDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    for (const sessionKyc of KYC_STATUSES) {
      const view = await directory.viewFor(subject, sessionKyc);
      assert.deepEqual(
        validator.validate({ $ref: "#/components/schemas/KycStatusView" }, { ...view }),
        [],
        `${subject} ${sessionKyc}`
      );
    }
  }
});

test("an unknown session KYC status fails closed inside the directory", async () => {
  const directory = createSyntheticKycApplicationDirectory();
  await assert.rejects(() => directory.viewFor(SUBJECT, "approved-by-ai"), /Unknown session KYC status/u);
});

test("validKycStatusView fails closed on directory drift", () => {
  const base = {
    mode: "test",
    provider: "simulator",
    session_kyc: "verified",
    status: "approved",
    application_id: "kyc_0123456789abcdef01234567",
    submitted_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
    can_submit: false
  };
  const bad = [
    null,
    "kyc",
    [],
    {},
    { ...base, extra: true },
    { ...base, mode: "live" },
    { ...base, provider: "sumsub" },
    { ...base, session_kyc: "approved-by-ai" },
    { ...base, status: "approved-by-ai" },
    { ...base, can_submit: "no" },
    { ...base, updated_at: "not-a-date" },
    { ...base, updated_at: "2026-09-02T00:00:00Z" },
    { ...base, application_id: "KYC_0123456789abcdef01234567" },
    { ...base, application_id: "app_0123456789abcdef01234567" },
    { ...base, submitted_at: 12345 },
    { ...base, review_deadline: "soon" },
    { ...base, reason_codes: [] },
    { ...base, reason_codes: ["SIM_DOCUMENT_UNREADABLE", "SIM_DOCUMENT_UNREADABLE"] },
    { ...base, reason_codes: ["POLITICS"] },
    { ...base, requested_items: ["passport_scan"] },
    { mode: "test", provider: "simulator", session_kyc: "verified", status: "approved", updated_at: "2026-09-02T00:00:00.000Z", can_submit: false, reason_codes: ["SIM_DATA_MISMATCH"] }
  ];
  for (const view of bad) {
    assert.equal(validKycStatusView(view), false, JSON.stringify(view));
  }
  assert.equal(validKycStatusView(base), true);
  assert.equal(
    validKycStatusView({
      mode: "test",
      provider: "simulator",
      session_kyc: "unverified",
      status: "not_started",
      updated_at: "2026-09-01T00:00:00.000Z",
      can_submit: true
    }),
    true
  );
});

test("GET /api/v1/customer/kyc returns the exact synthetic view for verified, pending and unverified customers", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    for (const [subject, sessionKyc] of [
      [VERIFIED_SUBJECT, "verified"],
      ["syn_cust_pending01", "pending"],
      [SUBJECT, "unverified"]
    ]) {
      const expected = await createSyntheticKycApplicationDirectory().viewFor(subject, sessionKyc);
      const response = await checkedRequest(port, {
        path: KYC,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 200, sessionKyc);
      assert.deepEqual(JSON.parse(response.body), { ...expected });
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
      assert.equal(header(response, "cache-control"), "no-store");
      const repeat = await checkedRequest(port, {
        path: KYC,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(repeat.body, response.body);
    }
  });
});

test("unauthenticated and non-customer tokens are rejected like the sibling reads", async () => {
  await withServer({}, async (port) => {
    const valid = token({ subject: VERIFIED_SUBJECT });
    const rejected = [
      null,
      "Bearer",
      `Bearer ${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, key: "b".repeat(64) })}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 0 })}`,
      `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 3601 })}`,
      `Bearer ${valid.replace("scdev1", "scdev2")}`
    ];
    for (const value of rejected) {
      const response = await checkedRequest(port, {
        path: KYC,
        headers: verifiedCustomerHeaders({ Authorization: value })
      });
      assert.equal(response.status, 401, String(value));
      assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
      assert.equal(header(response, "www-authenticate"), "Bearer");
    }
  });
  const operator = {
    async verify() {
      return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
    }
  };
  await withServer({ verifier: operator }, async (port) => {
    const response = await checkedRequest(port, { path: KYC, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal((await checkedRequest(port, { path: KYC, headers: verifiedCustomerHeaders() })).status, 200);
    const limited = await checkedRequest(port, { path: KYC, headers: verifiedCustomerHeaders() });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    // Even an unverified subject is served: the KYC status read is the
    // onboarding surface and is not gated on a verified KYC status.
    assert.equal((await checkedRequest(port, { path: KYC, headers: customerHeaders() })).status, 200);
  });
});

test("kyc application and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { kycApplicationDirectory: { async viewFor() { throw new Error("kyc store exploded: secret=abc"); } } },
    { kycApplicationDirectory: { async viewFor() { return { status: "approved" }; } } },
    {
      kycApplicationDirectory: {
        async viewFor() {
          return {
            mode: "test",
            provider: "simulator",
            session_kyc: "verified",
            status: "approved",
            updated_at: "2026-09-02T00:00:00.000Z",
            can_submit: false,
            extra: "x"
          };
        }
      }
    },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, { path: KYC, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider/u);
    });
  }
});

test("kyc subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/kyc/",
      "/api/v1/customer/kyc/1",
      "/api/v1/customer/kyc/kyc_0123456789abcdef01234567",
      "/api/v1/customer/kyc/application",
      "/api/v1/customer/kyc/status"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, { method, path, headers: verifiedCustomerHeaders() });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, { method, path: KYC, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, method);
    }
  });
});
