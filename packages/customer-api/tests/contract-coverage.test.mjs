// Contract-coverage guard: the served route surface can never drift from the
// declared contract. Every route the running server answers must be declared
// in packages/api-contracts/openapi.yaml with the same method; every
// declared-but-unserved operation stays contract-only with the pinned 404
// envelope (never 2xx/3xx, never a wildcard or prefix match); unknown paths
// under /api/v1/customer/** 404 instead of falling through.
import assert from "node:assert/strict";
import test from "node:test";

import { ERROR_MESSAGES, OPERATIONS } from "../src/contract.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import {
  assertConforms,
  checkedRequest,
  contract,
  customerHeaders,
  header,
  NOW_MS,
  rawExchange,
  REQUEST_ID,
  startTestServer,
  stopServer,
  validator,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];
const PATH_PARAMETER_VALUES = Object.freeze({ checkId: "syn_check_0001" });
const OPERATOR_HEADERS = [
  ...customerHeaders({ "X-Platform": "operator-web" }),
  ["X-Device-Id", "4d1c3a52-1f43-4c6b-9b3a-2a1f7e9c0d11"]
];

const servedPairs = new Map(
  OPERATIONS.map((operation) => [`${operation.method} ${operation.path}`, operation])
);
const declaredOperations = [];
for (const [path, item] of Object.entries(contract.openapi.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    declaredOperations.push({ path, method: method.toUpperCase(), operation });
  }
}
const unserved = declaredOperations.filter(
  ({ path, method }) => !servedPairs.has(`${method} ${path}`)
);

let server;
let port;

test.before(async () => {
  ({ server, port } = await startTestServer({
    rateLimiter: createFixedWindowRateLimiter({ limit: 100_000, clock: () => NOW_MS })
  }));
});

test.after(async () => {
  await stopServer(server);
});

function instantiate(path) {
  return path.replace(/\{([^{}]+)\}/gu, (_match, name) => {
    const value = PATH_PARAMETER_VALUES[name];
    assert.ok(value !== undefined, `no pinned value for path parameter ${name}`);
    return value;
  });
}

function assertContractOnly(response, context) {
  assert.equal(response.status, 404, context);
  assert.equal(header(response, "x-request-id"), REQUEST_ID, context);
  if (response.body === "") {
    return;
  }
  const body = JSON.parse(response.body);
  assert.equal(body.code, "CAPABILITY_DENIED", context);
  assert.equal(body.message, ERROR_MESSAGES.CAPABILITY_DENIED, context);
  assert.equal(body.request_id, REQUEST_ID, context);
  assert.deepEqual(body.details, {}, context);
}

test("every served route is declared in the contract with the same method", () => {
  assert.equal(servedPairs.size, OPERATIONS.length, "duplicate served method+path pair");
  for (const [pair, operation] of servedPairs) {
    const item = contract.openapi.paths[operation.path];
    assert.ok(item, `${pair} is served but missing from openapi.yaml`);
    const declared = item[operation.method.toLowerCase()];
    assert.ok(declared, `${pair} is served but missing from openapi.yaml`);
    assert.equal(declared.operationId, operation.operationId, pair);
    assert.ok(
      !operation.path.startsWith("/api/v1/operator/") && !(declared.tags ?? []).includes("Operator"),
      `${pair} must not be an operator route`
    );
  }
});

test("pinned path-parameter values satisfy every declared path parameter", () => {
  const seen = new Set();
  for (const { path, operation } of declaredOperations) {
    for (const reference of operation.parameters ?? []) {
      const parameter = reference.$ref ? validator.resolve(reference.$ref) : reference;
      if (parameter.in !== "path") {
        continue;
      }
      assert.ok(path.includes(`{${parameter.name}}`), `${parameter.name} is not in ${path}`);
      seen.add(parameter.name);
      const value = PATH_PARAMETER_VALUES[parameter.name];
      assert.ok(value !== undefined, `add a pinned value for ${parameter.name}`);
      assert.ok(
        new RegExp(parameter.schema.pattern, "u").test(value),
        `pinned ${parameter.name}=${value} fails the declared pattern`
      );
    }
  }
  assert.deepEqual([...Object.keys(PATH_PARAMETER_VALUES)].sort(), [...seen].sort());
});

test("every declared-but-unserved operation answers the pinned contract-only 404", async () => {
  assert.ok(unserved.length > 0);
  for (const { path, method, operation } of unserved) {
    const target = instantiate(path);
    const headers = (operation.tags ?? []).includes("Operator") ? OPERATOR_HEADERS : customerHeaders();
    const response = await checkedRequest(port, { method, path: target, headers });
    assertContractOnly(response, `${method} ${target}`);
  }
});

test("only served contract pairs answer; every other method on every declared path 404s", async () => {
  const targets = new Map();
  for (const { path } of declaredOperations) {
    targets.set(path, instantiate(path));
  }
  for (const { path } of OPERATIONS) {
    targets.set(path, instantiate(path));
  }
  for (const [contractPath, target] of targets) {
    for (const method of METHODS) {
      const response = await checkedRequest(port, { method, path: target, headers: verifiedCustomerHeaders() });
      const pair = `${method} ${contractPath}`;
      if (servedPairs.has(pair)) {
        assert.ok(
          response.status >= 200 && response.status < 300,
          `${method} ${target} must stay served, got ${response.status}`
        );
      } else {
        assertContractOnly(response, `${method} ${target}`);
      }
    }
  }
});

test("declared templated check paths never match as wildcards", async () => {
  const variants = [
    "/api/v1/customer/checks/a",
    "/api/v1/customer/checks/abc",
    "/api/v1/customer/checks/ABC",
    "/api/v1/customer/checks/preview",
    "/api/v1/customer/checks/status",
    "/api/v1/customer/checks/claim",
    "/api/v1/customer/checks/cancel",
    "/api/v1/customer/checks/syn-check-999",
    "/api/v1/customer/checks/%7BcheckId%7D",
    `/api/v1/customer/checks/${"9".repeat(128)}`,
    "/api/v1/customer/checks/..",
    "/api/v1/customer/checks/preview/claim",
    "/api/v1/customer/checks/preview/cancel",
    "/api/v1/customer/checks/syn_check_0001/claim/extra"
  ];
  for (const path of variants) {
    for (const method of ["GET", "POST"]) {
      const response = await checkedRequest(port, { method, path, headers: customerHeaders() });
      assertContractOnly(response, `${method} ${path}`);
    }
  }
});

test("unknown paths under /api/v1/customer/** 404 rather than fall through", async () => {
  const unknown = [
    "/api/v1/customer",
    "/api/v1/customer/",
    "/api/v1/customer/unknown",
    "/api/v1/customer/sessions",
    "/api/v1/customer/session/current",
    "/api/v1/customer/capabilities/all",
    "/api/v1/customer/checks",
    "/api/v1/customer/checks/",
    "/api/v1/customer/auth/",
    "/api/v1/customer/auth/sess_0123456789abcdef01234567",
    "/api/v1/customer/auth/revoke",
    "/api/v1/customer/kyc/",
    "/api/v1/customer/kyc/application",
    "/api/v1/customer/kyc/kyc_0123456789abcdef01234567",
    "/api/v1/customer/wallets/",
    "/api/v1/customer/wallets/syn_wal_0001",
    "/api/v1/customer/notifications/",
    "/api/v1/customer/notifications/ntf_000000000000000000000001",
    "/api/v1/customer/profile/",
    "/api/v1/customer/profile/SC-DEV-00001",
    "/api/v1/customer/support/",
    "/api/v1/customer/support/tck_0123456789abcdef01234567",
    "/api/v1/customer/deposits/",
    "/api/v1/customer/deposits/dep_0123456789abcdef01234567",
    "/api/v1/customer/withdrawals/",
    "/api/v1/customer/withdrawals/wdr_0123456789abcdef01234567",
    "/api/v1/customer/quotes/",
    "/api/v1/customer/quotes/qte_0123456789abcdef01234567",
    "/api/v1/customer/exchange-orders/",
    "/api/v1/customer/exchange-orders/ord_0123456789abcdef01234567",
    "/api/v1/customer/payments/",
    "/api/v1/customer/payments/pay_0123456789abcdef01234567",
    "/api/v1/customer/cards/",
    "/api/v1/customer/cards/crd_0123456789abcdef01234567",
    "/api/v1/customers/session",
    "/api/v1/customer//session",
    "/api/v1/customer/%73ession",
    "/api/v1/customer/session%20",
    "/api/v1/customer/checks/syn_check_0001/extra",
    "/api/v1/operator",
    "/metrics"
  ];
  for (const path of unknown) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const response = await checkedRequest(port, { method, path, headers: customerHeaders() });
      assertContractOnly(response, `${method} ${path}`);
    }
  }
});

test("a declared-but-unserved operation stays unreachable even with a request body", async () => {
  const headers = [...customerHeaders(), ["Content-Type", "application/json"], ["Content-Length", "2"]]
    .map(([name, value]) => `${name}: ${value}`)
    .join("\r\n");
  const response = await rawExchange(
    port,
    `POST /api/v1/customer/checks/preview HTTP/1.1\r\nHost: 127.0.0.1\r\n${headers}\r\n\r\n{}`
  );
  assertConforms("POST", "/api/v1/customer/checks/preview", response);
  assert.equal(response.status, 404);
  assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
});

test("seeded probe: no undeclared route answers inside the customer namespace", async () => {
  const pieces = [
    "checks",
    "preview",
    "status",
    "claim",
    "cancel",
    "session",
    "capabilities",
    "meta",
    "auth",
    "kyc",
    "wallets",
    "notifications",
    "profile",
    "support",
    "deposits",
    "withdrawals",
    "quotes",
    "exchange-orders",
    "payments",
    "cards",
    "admin",
    "syn_check_0001",
    "a",
    "%7BcheckId%7D",
    ".",
    "..",
    "",
    "~"
  ];
  let seed = 20261008;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const tried = new Set();
  for (let index = 0; index < 250; index += 1) {
    const length = next() % 5;
    const path = [
      "/api/v1/customer",
      ...Array.from({ length }, () => pieces[next() % pieces.length])
    ].join("/");
    if (tried.has(path)) {
      continue;
    }
    tried.add(path);
    const response = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
    const pair = `GET ${path}`;
    if (servedPairs.has(pair)) {
      assert.ok(response.status >= 200 && response.status < 300, pair);
    } else {
      assertContractOnly(response, pair);
    }
  }
});
