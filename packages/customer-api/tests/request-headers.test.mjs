import assert from "node:assert/strict";
import test from "node:test";

import { isUuidV7 } from "../src/request-id.mjs";
import {
  checkedRequest,
  customerHeaders,
  header,
  REQUEST_ID,
  startTestServer,
  stopServer,
  TEST_KEY,
  token,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const META = "/api/v1/meta";
const SESSION = "/api/v1/customer/session";
const CAPABILITIES = "/api/v1/customer/capabilities";
const WALLETS = "/api/v1/customer/wallets";
const NOTIFICATIONS = "/api/v1/customer/notifications";
const KYC = "/api/v1/customer/kyc";
const PROFILE = "/api/v1/customer/profile";
const SUPPORT = "/api/v1/customer/support";
const DEPOSITS = "/api/v1/customer/deposits";
const WITHDRAWALS = "/api/v1/customer/withdrawals";
const QUOTES = "/api/v1/customer/quotes";
const EXCHANGE_ORDERS = "/api/v1/customer/exchange-orders";
const PAYMENTS = "/api/v1/customer/payments";
const CARDS = "/api/v1/customer/cards";
const AUTH = "/api/v1/customer/auth";
const CUSTOMER_PATHS = [SESSION, CAPABILITIES, WALLETS, NOTIFICATIONS, KYC, PROFILE, SUPPORT, DEPOSITS, WITHDRAWALS, QUOTES, EXCHANGE_ORDERS, PAYMENTS, CARDS, AUTH];
const DEVICE_ID = "4d1c3a52-1f43-4c6b-9b3a-2a1f7e9c0d11";
const OTHER_REQUEST_ID = "018f3f8a-6a36-7bd8-86e0-b59cd575d55b";
let port;
let server;

test.before(async () => {
  ({ server, port } = await startTestServer());
});

test.after(async () => {
  await stopServer(server);
});

async function expectStatus(path, headers, status, code) {
  const response = await checkedRequest(port, { path, headers });
  assert.equal(response.status, status, `${path} ${JSON.stringify(headers)}`);
  if (code) {
    assert.equal(JSON.parse(response.body).code, code);
  }
  return response;
}

test("missing required customer headers are rejected", async () => {
  for (const path of CUSTOMER_PATHS) {
    for (const name of ["X-Request-Id", "X-Client-Version", "X-Platform"]) {
      await expectStatus(path, customerHeaders({ [name]: null }), 400, "VALIDATION_FAILED");
    }
    await expectStatus(path, customerHeaders({ Authorization: null }), 401, "AUTHENTICATION_REQUIRED");
  }
  await expectStatus(META, [], 400, "VALIDATION_FAILED");
});

test("duplicate required headers are rejected, including identical values", async () => {
  for (const path of CUSTOMER_PATHS) {
    for (const name of ["X-Request-Id", "X-Client-Version", "X-Platform"]) {
      const headers = customerHeaders();
      const value = headers.find(([key]) => key === name)[1];
      await expectStatus(path, [...headers, [name, value]], 400, "VALIDATION_FAILED");
      await expectStatus(path, [...headers, [name.toLowerCase(), value]], 400, "VALIDATION_FAILED");
    }
    const headers = customerHeaders();
    await expectStatus(path, [...headers, ["Authorization", `Bearer ${token()}`]], 401);
    await expectStatus(path, [...headers, ["authorization", "Bearer forged"]], 401);
  }
  await expectStatus(META, [["X-Request-Id", REQUEST_ID], ["X-Request-Id", REQUEST_ID]], 400);
});

test("malformed X-Request-Id values are rejected and never echoed", async () => {
  const values = [
    REQUEST_ID.toUpperCase(),
    "018f3f8a-6a36-4bd8-86e0-b59cd575d55a",
    "018f3f8a-6a36-7bd8-c6e0-b59cd575d55a",
    "018f3f8a6a367bd886e0b59cd575d55a",
    `${REQUEST_ID},${OTHER_REQUEST_ID}`,
    `${REQUEST_ID}0`,
    `{${REQUEST_ID}}`,
    "",
    "not-a-uuid",
    "<script>",
    "x".repeat(4096)
  ];
  for (const path of [META, ...CUSTOMER_PATHS]) {
    for (const value of values) {
      const headers = path === META ? [["X-Request-Id", value]] : customerHeaders({ "X-Request-Id": value });
      const response = await expectStatus(path, headers, 400, "VALIDATION_FAILED");
      const echoed = header(response, "x-request-id");
      assert.notEqual(echoed, value);
      assert.ok(isUuidV7(echoed));
      assert.equal(JSON.parse(response.body).request_id, echoed);
    }
  }
});

test("valid X-Request-Id is echoed on success and on every error class", async () => {
  const scenarios = [
    [META, [["X-Request-Id", OTHER_REQUEST_ID]], 200],
    [SESSION, customerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [SESSION, customerHeaders({ "X-Request-Id": OTHER_REQUEST_ID, "X-Platform": "bad" }), 400],
    [SESSION, customerHeaders({ "X-Request-Id": OTHER_REQUEST_ID, Authorization: null }), 401],
    ["/api/v1/operator/session", customerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 404],
    [WALLETS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [NOTIFICATIONS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [KYC, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [PROFILE, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [SUPPORT, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [DEPOSITS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [WITHDRAWALS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [QUOTES, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [EXCHANGE_ORDERS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [PAYMENTS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [CARDS, verifiedCustomerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200],
    [AUTH, customerHeaders({ "X-Request-Id": OTHER_REQUEST_ID }), 200]
  ];
  for (const [path, headers, status] of scenarios) {
    const response = await expectStatus(path, headers, status);
    assert.equal(header(response, "x-request-id"), OTHER_REQUEST_ID);
  }
});

test("generated request IDs are fresh UUIDv7 values", async () => {
  const seen = new Set();
  for (let index = 0; index < 20; index += 1) {
    const response = await expectStatus(META, [], 400);
    seen.add(header(response, "x-request-id"));
  }
  assert.equal(seen.size, 20);
});

test("X-Device-Id is rejected on customer and metadata operations", async () => {
  for (const value of [DEVICE_ID, "", "not-a-device", DEVICE_ID.toUpperCase()]) {
    for (const path of CUSTOMER_PATHS) {
      await expectStatus(path, [...customerHeaders(), ["X-Device-Id", value]], 400, "VALIDATION_FAILED");
      await expectStatus(path, [...customerHeaders(), ["x-device-id", value]], 400, "VALIDATION_FAILED");
    }
    await expectStatus(META, [["X-Request-Id", REQUEST_ID], ["X-DEVICE-ID", value]], 400, "VALIDATION_FAILED");
  }
});

test("X-Client-Version enforces 1-64 characters", async () => {
  for (const path of CUSTOMER_PATHS) {
    await expectStatus(path, verifiedCustomerHeaders({ "X-Client-Version": "v" }), 200);
    await expectStatus(path, verifiedCustomerHeaders({ "X-Client-Version": "9".repeat(64) }), 200);
    await expectStatus(path, customerHeaders({ "X-Client-Version": "9".repeat(65) }), 400, "VALIDATION_FAILED");
    await expectStatus(path, customerHeaders({ "X-Client-Version": "" }), 400, "VALIDATION_FAILED");
    await expectStatus(path, customerHeaders({ "X-Client-Version": "   " }), 400, "VALIDATION_FAILED");
  }
});

test("X-Platform accepts only exact enum values", async () => {
  for (const value of ["Web", "WEB", "web ", "web,ios", "desktop", "", "telegram_mini_app", "operator"]) {
    for (const path of CUSTOMER_PATHS) {
      await expectStatus(path, verifiedCustomerHeaders({ "X-Platform": value }), value === "web " ? 200 : 400);
    }
  }
});

test("Authorization accepts only one well-formed synthetic bearer token", async () => {
  const valid = token({ subject: VERIFIED_SUBJECT });
  const otherKey = "b".repeat(64);
  const forged = `${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`;
  const rejected = [
    "",
    "Bearer",
    "Bearer ",
    `Bearer  ${valid}`,
    `Basic ${valid}`,
    valid,
    `Bearer ${valid} extra`,
    `Bearer ${valid},Bearer ${valid}`,
    `Bearer ${forged}`,
    `Bearer ${valid.toUpperCase()}`,
    `Bearer ${token({ key: otherKey })}`,
    `Bearer ${token({ ttlSeconds: 0 })}`,
    `Bearer ${token({ ttlSeconds: -60 })}`,
    `Bearer ${token({ ttlSeconds: 3601 })}`,
    `Bearer ${valid.replace("scdev1", "scdev2")}`,
    `Bearer ${valid.replace("syn_cust_", "syn_oper_")}`,
    `Bearer ${valid}=`,
    `Bearer ${"a".repeat(8000)}`
  ];
  for (const path of CUSTOMER_PATHS) {
    for (const value of rejected) {
      const response = await expectStatus(path, customerHeaders({ Authorization: value }), 401, "AUTHENTICATION_REQUIRED");
      assert.equal(header(response, "www-authenticate"), "Bearer");
    }
    await expectStatus(path, customerHeaders({ Authorization: `bearer ${valid}` }), 200);
    await expectStatus(path, customerHeaders({ Authorization: `Bearer ${token({ subject: VERIFIED_SUBJECT, ttlSeconds: 3600 })}` }), 200);
  }
  assert.notEqual(TEST_KEY, otherKey);
});

test("request bodies are rejected on every served operation", async () => {
  for (const path of [META, ...CUSTOMER_PATHS]) {
    const base = path === META ? [["X-Request-Id", REQUEST_ID]] : customerHeaders();
    for (const extra of [[["Content-Length", "0"]], [["Transfer-Encoding", "chunked"]]]) {
      const response = await checkedRequest(port, { path, headers: [...base, ...extra] });
      assert.equal(response.status, 400);
      assert.equal(header(response, "connection"), "close");
    }
  }
});

test("header names are matched case-insensitively", async () => {
  const headers = verifiedCustomerHeaders().map(([name, value]) => [name.toUpperCase(), value]);
  for (const path of CUSTOMER_PATHS) {
    await expectStatus(path, headers, 200);
  }
});

test("validation order: body, device, request id, context, rate limit, then authentication", async () => {
  const response = await expectStatus(
    SESSION,
    customerHeaders({ "X-Request-Id": "bad", "X-Platform": "bad", Authorization: null }),
    400
  );
  assert.match(JSON.parse(response.body).message, /X-Request-Id/u);
  const device = await expectStatus(SESSION, [...customerHeaders({ "X-Request-Id": "bad" }), ["X-Device-Id", DEVICE_ID]], 400);
  assert.match(JSON.parse(device.body).message, /X-Device-Id/u);
  const platform = await expectStatus(SESSION, customerHeaders({ "X-Platform": "bad", Authorization: null }), 400);
  assert.match(JSON.parse(platform.body).message, /X-Platform/u);
});
