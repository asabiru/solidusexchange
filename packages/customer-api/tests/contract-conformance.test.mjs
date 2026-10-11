import assert from "node:assert/strict";
import test from "node:test";

import { createDenyAllVerifier } from "../src/auth.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { createSyntheticOperatorSubjectsDirectory } from "../src/operator.mjs";
import { API_METADATA, CONTRACT_GAP_STATUSES, OPERATIONS, PLATFORMS } from "../src/contract.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { CONTRACT_GAP_STATUSES as VALIDATOR_GAP_STATUSES } from "./contract-validator.mjs";
import {
  checkedRequest,
  contract,
  customerHeaders,
  DEVICE_ID,
  header,
  NOW_MS,
  OPERATOR_SUBJECT,
  operationIdFor,
  operationPathFor,
  operatorHeaders,
  orderIdFor,
  REQUEST_ID,
  SUBJECT,
  startTestServer,
  stopServer,
  token,
  validator,
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
const CHECKS = "/api/v1/customer/checks";
const ACTIVITY = "/api/v1/customer/activity";
const OPERATIONS_LIST = "/api/v1/customer/operations";
const OPERATION_DETAIL = `/api/v1/customer/operations/${await operationIdFor()}`;
const EXCHANGE_ORDER_DETAIL = `/api/v1/customer/exchange-orders/${await orderIdFor()}`;
const DEPOSIT_ADDRESSES = "/api/v1/customer/deposit-addresses";
const ADDRESS_SCREENINGS = "/api/v1/customer/address-screenings";
const TRADES = "/api/v1/customer/trades";
const MARKETS = "/api/v1/customer/markets";
const MARKET_DEPTH = "/api/v1/customer/markets/USDT%2FRUB";
const AUTH = "/api/v1/customer/auth";
const USERS = "/api/v1/customer/users";
const ADMIN = "/api/v1/operator/admin";
const OPERATOR_SESSION = "/api/v1/operator/session";
const OPERATOR_CAPABILITIES = "/api/v1/operator/capabilities";
const OPERATOR_SUBJECTS = "/api/v1/operator/subjects";
// A real roster id: the member read only reaches its 200 path for ids inside
// the shared subject universe.
const KNOWN_OPERATOR_SUBJECT_ID = (
  await createSyntheticOperatorSubjectsDirectory().subjectsFor()
).subjects[0].subject_id;
const OPERATOR_SUBJECT_DETAIL = `${OPERATOR_SUBJECTS}/${KNOWN_OPERATOR_SUBJECT_ID}`;
const OPERATOR_QUEUE = "/api/v1/operator/queue";
const OPERATOR_PATHS = [OPERATOR_SESSION, OPERATOR_CAPABILITIES, ADMIN, OPERATOR_SUBJECTS, `${OPERATOR_SUBJECTS}/{subjectId}`, OPERATOR_QUEUE];
const metaHeaders = [["X-Request-Id", REQUEST_ID]];
const observed = new Set();

async function observe(port, options) {
  const response = await checkedRequest(port, options);
  observed.add(`${operationPathFor(options.path)} ${response.status}`);
  return response;
}

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

function headerParameterNames(operation) {
  return operation.parameters
    // Parameters may be declared inline (the operator queue's `kind` query
    // parameter) as well as by reference into components.parameters.
    .map((parameter) => parameter.$ref === undefined ? parameter : validator.resolve(parameter.$ref))
    .filter((parameter) => parameter.in === "header" && parameter.required)
    .map((parameter) => parameter.name.toLowerCase());
}

test("served operations match the contract exactly; unserved operator and checks paths stay unserved", () => {
  const served = new Set(OPERATIONS.map((operation) => operation.path));
  const contractOperations = [];
  for (const [path, item] of Object.entries(contract.openapi.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      contractOperations.push({ path, method: method.toUpperCase(), operation });
    }
  }
  // Operator routes other than the three served reads and every checks
  // command path remain declared-but-unserved.
  const unserved = (path) =>
    path.startsWith("/api/v1/customer/checks/") ||
    (path.startsWith("/api/v1/operator/") && !OPERATOR_PATHS.includes(path));
  const expected = contractOperations.filter(({ path }) => !unserved(path));
  assert.equal(OPERATIONS.length, expected.length);
  for (const { path, method, operation } of expected) {
    const runtime = OPERATIONS.find((candidate) => candidate.operationId === operation.operationId);
    assert.ok(runtime, operation.operationId);
    assert.equal(runtime.path, path);
    assert.equal(runtime.method, method);
    assert.equal(runtime.authenticated, operation.security.length > 0);
    assert.deepEqual(
      [...runtime.statuses].sort(),
      Object.keys(operation.responses).map(Number).sort()
    );
    const operatorRoute = path.startsWith("/api/v1/operator/");
    const required = headerParameterNames(operation);
    if (runtime.authenticated) {
      required.push("authorization");
      assert.deepEqual(operation.security, [operatorRoute ? { OperatorBearer: [] } : { CustomerBearer: [] }]);
    }
    assert.deepEqual([...runtime.requiredHeaders].sort(), required.sort());
    assert.equal(required.includes("x-device-id"), operatorRoute, `${path} device-id requirement`);
  }
  const unservedPaths = contractOperations.filter(({ path }) => unserved(path));
  assert.ok(unservedPaths.length > 0);
  for (const { path } of unservedPaths) {
    assert.ok(!served.has(path), path);
  }
});

test("runtime metadata and platforms mirror the contract and x-solidchange flags", () => {
  assert.deepEqual(validator.validate({ $ref: "#/components/schemas/ApiMetadata" }, { ...API_METADATA }), []);
  assert.equal(API_METADATA.contract_version, contract.openapi.info.version);
  assert.equal(API_METADATA.runtime_boundary, contract.openapi["x-solidchange-runtime-boundary"]);
  assert.equal(contract.openapi["x-solidchange-financial-commands-enabled"], false);
  assert.equal(contract.openapi["x-solidchange-production-providers-enabled"], false);
  assert.equal(API_METADATA.financial_commands_enabled, false);
  assert.equal(API_METADATA.production_providers_enabled, false);
  assert.deepEqual([...PLATFORMS], validator.resolve("#/components/parameters/Platform").schema.enum);
  assert.deepEqual([...CONTRACT_GAP_STATUSES], [...VALIDATOR_GAP_STATUSES]);
});

test("GET /api/v1/meta returns the exact metadata without authentication", async () => {
  await withServer({ verifier: createDenyAllVerifier() }, async (port) => {
    const response = await observe(port, { path: META, headers: metaHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), API_METADATA);
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    assert.equal(header(response, "x-content-type-options"), "nosniff");
  });
});

test("GET /api/v1/meta ignores credentials and customer context headers", async () => {
  await withServer({}, async (port) => {
    const response = await observe(port, {
      path: META,
      headers: [...metaHeaders, ["Authorization", "Bearer forged"], ["X-Platform", "nope"]]
    });
    assert.equal(response.status, 200);
  });
});

test("GET /api/v1/customer/session returns a SessionView for a synthetic token", async () => {
  await withServer({}, async (port) => {
    const response = await observe(port, { path: SESSION, headers: customerHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      subject: SUBJECT,
      actor_type: "customer",
      scopes: ["customer.session.read", "customer.capabilities.read"],
      expires_at: new Date(Math.floor(NOW_MS / 1000) * 1000 + 900_000).toISOString()
    });
  });
});

test("GET /api/v1/customer/capabilities grants only read capabilities, even after KYC", async () => {
  await withServer({}, async (port) => {
    for (const subject of [SUBJECT, "syn_cust_verified01"]) {
      const response = await observe(port, {
        path: CAPABILITIES,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.body), {
        capabilities: subject === "syn_cust_verified01"
          ? ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read", "customer.auth.read", "customer.users.read", "customer.wallets.read", "customer.notifications.read", "customer.deposits.read", "customer.withdrawals.read", "customer.quotes.read", "customer.exchange-orders.read", "customer.trades.read", "customer.markets.read", "customer.payments.read", "customer.cards.read", "customer.checks.read", "customer.deposit-addresses.read", "customer.address-screenings.read", "customer.activity.read", "customer.operations.read"]
          : ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read", "customer.auth.read", "customer.users.read"],
        commands_enabled: false
      });
    }
  });
});

test("every platform enum value is accepted on customer operations", async () => {
  await withServer({}, async (port) => {
    for (const platform of PLATFORMS) {
      const response = await observe(port, { path: SESSION, headers: customerHeaders({ "X-Platform": platform }) });
      assert.equal(response.status, 200, platform);
    }
  });
});

test("deny-all verifier rejects every token with 401", async () => {
  await withServer({ verifier: createDenyAllVerifier() }, async (port) => {
    for (const path of [SESSION, CAPABILITIES, WALLETS, NOTIFICATIONS, KYC, PROFILE, SUPPORT, AUTH, USERS, DEPOSITS, WITHDRAWALS, QUOTES, EXCHANGE_ORDERS, TRADES, MARKETS, MARKET_DEPTH, PAYMENTS, CARDS, CHECKS, ACTIVITY, OPERATIONS_LIST, OPERATION_DETAIL, EXCHANGE_ORDER_DETAIL, DEPOSIT_ADDRESSES, ADDRESS_SCREENINGS, `${ADDRESS_SCREENINGS}/scr_${"0".repeat(32)}`]) {
      const response = await observe(port, { path, headers: customerHeaders() });
      assert.equal(response.status, 401);
      assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
      assert.equal(header(response, "www-authenticate"), "Bearer");
    }
  });
});

test("rate limiting returns 429 with Retry-After before authentication", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 2, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    for (const path of [SESSION, CAPABILITIES, WALLETS, NOTIFICATIONS, KYC, PROFILE, SUPPORT, AUTH, USERS, DEPOSITS, WITHDRAWALS, QUOTES, EXCHANGE_ORDERS, TRADES, MARKETS, MARKET_DEPTH, PAYMENTS, CARDS, CHECKS, ACTIVITY, OPERATIONS_LIST, OPERATION_DETAIL, EXCHANGE_ORDER_DETAIL, DEPOSIT_ADDRESSES, ADDRESS_SCREENINGS]) {
      now += 61_000;
      assert.equal((await observe(port, { path, headers: verifiedCustomerHeaders() })).status, 200);
      assert.equal((await observe(port, { path, headers: customerHeaders({ Authorization: null }) })).status, 401);
      const limited = await observe(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(limited.status, 429);
      assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
      assert.equal(header(limited, "retry-after"), "60");
    }
    now += 61_000;
    const listed = await observe(port, { path: ADDRESS_SCREENINGS, headers: verifiedCustomerHeaders() });
    const screeningId = JSON.parse(listed.body).screenings[0].screening_id;
    now += 61_000;
    const screeningPath = `${ADDRESS_SCREENINGS}/${screeningId}`;
    assert.equal((await observe(port, { path: screeningPath, headers: verifiedCustomerHeaders() })).status, 200);
    assert.equal((await observe(port, { path: screeningPath, headers: customerHeaders({ Authorization: null }) })).status, 401);
    const limitedScreening = await observe(port, { path: screeningPath, headers: verifiedCustomerHeaders() });
    assert.equal(limitedScreening.status, 429);
    assert.equal(JSON.parse(limitedScreening.body).code, "RATE_LIMITED");
    for (const path of OPERATOR_PATHS) {
      const target = path.replace("{subjectId}", KNOWN_OPERATOR_SUBJECT_ID);
      now += 61_000;
      assert.equal((await observe(port, { path: target, headers: operatorHeaders() })).status, 200);
      assert.equal((await observe(port, { path: target, headers: operatorHeaders({ Authorization: null }) })).status, 401);
      const limited = await observe(port, { path: target, headers: operatorHeaders() });
      assert.equal(limited.status, 429);
      assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
      assert.equal(header(limited, "retry-after"), "60");
    }
    const meta = await observe(port, { path: META, headers: metaHeaders });
    assert.equal(meta.status, 200);
  });
});

test("rate limiting shares one bucket across rotated loopback source addresses", async () => {
  const rateLimiter = createFixedWindowRateLimiter({ limit: 2, clock: () => NOW_MS });
  await withServer({ rateLimiter }, async (port) => {
    const statuses = [];
    for (const localAddress of ["127.0.0.1", "127.0.0.2", "127.0.0.3", "127.1.2.3", "127.255.255.254"]) {
      statuses.push((await observe(port, { path: SESSION, headers: customerHeaders(), localAddress })).status);
    }
    assert.deepEqual(statuses, [200, 200, 429, 429, 429]);
  });
});

test("verifier and directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    { verifier: { async verify() { throw new Error("idp exploded: secret=abc"); } } },
    { verifier: { async verify() { return { subject: "x", actorType: "customer", scopes: "all", expiresAt: "never" }; } } },
    { verifier: { async verify() { return { subject: "x", actorType: "customer", scopes: [], expiresAt: "2020-01-01T00:00:00.000Z" }; } } },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } },
    { kycDirectory: { async statusFor() { return "approved-by-ai"; } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const path = options.kycDirectory ? CAPABILITIES : SESSION;
      const response = await observe(port, { path, headers: customerHeaders() });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider|approved/u);
    });
  }
  await withServer({ rateLimiter: { consume() { throw new Error("limiter broken"); } } }, async (port) => {
    assert.equal((await observe(port, { path: SESSION, headers: customerHeaders() })).status, 500);
  });
  await withServer({ walletDirectory: { async listFor() { throw new Error("wallet store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: WALLETS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ notificationDirectory: { async listFor() { throw new Error("notification store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ kycApplicationDirectory: { async viewFor() { throw new Error("kyc store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: KYC, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ profileDirectory: { async viewFor() { throw new Error("profile store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: PROFILE, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ supportDirectory: { async listFor() { throw new Error("support store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: SUPPORT, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ depositDirectory: { async listFor() { throw new Error("deposit store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ withdrawalDirectory: { async listFor() { throw new Error("withdrawal store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ quoteDirectory: { async listFor() { throw new Error("quote store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: QUOTES, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ exchangeOrderDirectory: { async listFor() { throw new Error("order store exploded: secret=abc"); }, async orderFor() { throw new Error("order store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
    const detail = await observe(port, { path: EXCHANGE_ORDER_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(detail.status, 500);
    assert.equal(JSON.parse(detail.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(detail.body, /secret|exploded/u);
  });
  await withServer({ tradeDirectory: { async listFor() { throw new Error("trade store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: TRADES, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ marketDirectory: { async listFor() { throw new Error("market store exploded: secret=abc"); }, async depthFor() { return null; } } }, async (port) => {
    const response = await observe(port, { path: MARKETS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ marketDirectory: { async listFor() { return { mode: "test", markets: [] }; }, async depthFor() { throw new Error("depth store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: MARKET_DEPTH, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ paymentDirectory: { async listFor() { throw new Error("payment store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ cardDirectory: { async listFor() { throw new Error("card store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: CARDS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ checkDirectory: { async viewFor() { throw new Error("check store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: CHECKS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ activityDirectory: { async viewFor() { throw new Error("activity store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: ACTIVITY, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ operationDirectory: { async viewFor() { throw new Error("operation store exploded: secret=abc"); }, async operationFor() { throw new Error("operation store exploded: secret=abc"); } } }, async (port) => {
    const listResponse = await observe(port, { path: OPERATIONS_LIST, headers: verifiedCustomerHeaders() });
    assert.equal(listResponse.status, 500);
    assert.equal(JSON.parse(listResponse.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(listResponse.body, /secret|exploded/u);
    const detailResponse = await observe(port, { path: OPERATION_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(detailResponse.status, 500);
    assert.equal(JSON.parse(detailResponse.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(detailResponse.body, /secret|exploded/u);
  });
  await withServer({ depositAddressDirectory: { async listFor() { throw new Error("deposit address store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: DEPOSIT_ADDRESSES, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({
    addressScreeningDirectory: {
      async listFor() {
        throw new Error("screening store exploded: secret=abc");
      },
      async viewFor() {
        throw new Error("screening store exploded: secret=abc");
      }
    }
  }, async (port) => {
    for (const path of [ADDRESS_SCREENINGS, `${ADDRESS_SCREENINGS}/scr_${"0".repeat(32)}`]) {
      const response = await observe(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500, path);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded/u);
    }
  });
  await withServer({ authSessionDirectory: { async listFor() { throw new Error("session store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: AUTH, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ userDirectory: { async viewFor() { throw new Error("user store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: USERS, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({ operatorDirectory: { async viewFor() { throw new Error("operator store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: ADMIN, headers: operatorHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
  await withServer({
    operatorSubjectsDirectory: {
      async subjectsFor() { throw new Error("subject store exploded: secret=abc"); },
      async subjectFor() { throw new Error("subject store exploded: secret=abc"); },
      async queueFor() { throw new Error("queue store exploded: secret=abc"); }
    }
  }, async (port) => {
    for (const path of [OPERATOR_SUBJECTS, OPERATOR_SUBJECT_DETAIL, OPERATOR_QUEUE]) {
      const response = await observe(port, { path, headers: operatorHeaders() });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded/u);
    }
  });
  // An operator principal outside the token grammar (here a subject that
  // never matches syn_oper_*) fails the session view's fail-closed
  // validation: the served route answers the client-safe 500 envelope.
  const badPrincipal = {
    async verify() {
      return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
    }
  };
  await withServer({ verifier: badPrincipal }, async (port) => {
    const response = await observe(port, { path: OPERATOR_SESSION, headers: operatorHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
  });
  await withServer({ verifier: { async verify() { throw new Error("idp exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: OPERATOR_CAPABILITIES, headers: operatorHeaders() });
    assert.equal(response.status, 500);
    assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    assert.doesNotMatch(response.body, /secret|exploded/u);
  });
});

test("metadata drift fails closed with a 500 envelope", async () => {
  const drifted = [
    { ...API_METADATA, financial_commands_enabled: true },
    { ...API_METADATA, runtime_boundary: "production" },
    { ...API_METADATA, debug: true },
    { api_version: "v1" },
    null
  ];
  for (const metadata of drifted) {
    await withServer({ metadata }, async (port) => {
      const response = await observe(port, { path: META, headers: metaHeaders });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    });
  }
});

test("GET /api/v1/customer/wallets serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: WALLETS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: WALLETS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/notifications serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: NOTIFICATIONS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: NOTIFICATIONS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/kyc serves every authenticated customer regardless of KYC status", async () => {
  await withServer({}, async (port) => {
    for (const headers of [verifiedCustomerHeaders(), customerHeaders()]) {
      const response = await observe(port, { path: KYC, headers });
      assert.equal(response.status, 200);
    }
  });
});

test("GET /api/v1/customer/profile serves every authenticated customer regardless of KYC status", async () => {
  await withServer({}, async (port) => {
    for (const headers of [verifiedCustomerHeaders(), customerHeaders()]) {
      const response = await observe(port, { path: PROFILE, headers });
      assert.equal(response.status, 200);
    }
  });
});

test("GET /api/v1/customer/support serves every authenticated customer regardless of KYC status", async () => {
  await withServer({}, async (port) => {
    for (const headers of [verifiedCustomerHeaders(), customerHeaders()]) {
      const response = await observe(port, { path: SUPPORT, headers });
      assert.equal(response.status, 200);
    }
  });
});

test("GET /api/v1/customer/auth serves every authenticated customer regardless of KYC status", async () => {
  await withServer({}, async (port) => {
    for (const headers of [verifiedCustomerHeaders(), customerHeaders()]) {
      const response = await observe(port, { path: AUTH, headers });
      assert.equal(response.status, 200);
    }
  });
});

test("GET /api/v1/customer/users serves every authenticated customer regardless of KYC status", async () => {
  await withServer({}, async (port) => {
    for (const headers of [verifiedCustomerHeaders(), customerHeaders()]) {
      const response = await observe(port, { path: USERS, headers });
      assert.equal(response.status, 200);
    }
  });
});

test("GET /api/v1/operator/admin serves the operator's own admin overview to the operator audience only", async () => {
  await withServer({}, async (port) => {
    const response = await observe(port, { path: ADMIN, headers: operatorHeaders() });
    assert.equal(response.status, 200);
    const view = JSON.parse(response.body);
    assert.equal(view.mode, "test");
    assert.match(view.operator_id, /^opr_[0-9a-f]{24}$/u);
    assert.equal(view.subject, OPERATOR_SUBJECT);
    assert.deepEqual(view.granted_capabilities, [
      "operator.session.read",
      "operator.capabilities.read",
      "operator.admin.read",
      "operator.subjects.read",
      "operator.queue.read"
    ]);
    const customer = await observe(port, {
      path: ADMIN,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
    assert.equal(header(customer, "www-authenticate"), "Bearer");
    const operatorOnCustomerPath = await observe(port, {
      path: SESSION,
      headers: operatorHeaders({ "X-Device-Id": null })
    });
    assert.equal(operatorOnCustomerPath.status, 401);
    assert.equal(JSON.parse(operatorOnCustomerPath.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("GET /api/v1/operator/session returns an OperatorSessionView for a synthetic operator token", async () => {
  await withServer({}, async (port) => {
    const response = await observe(port, { path: OPERATOR_SESSION, headers: operatorHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      subject: OPERATOR_SUBJECT,
      actor_type: "operator",
      scopes: ["operator.session.read", "operator.capabilities.read"],
      expires_at: new Date(Math.floor(NOW_MS / 1000) * 1000 + 900_000).toISOString(),
      device_bound: true
    });
    const customer = await observe(port, {
      path: OPERATOR_SESSION,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("GET /api/v1/operator/capabilities grants exactly the operator read tier", async () => {
  await withServer({}, async (port) => {
    const response = await observe(port, { path: OPERATOR_CAPABILITIES, headers: operatorHeaders() });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      capabilities: ["operator.session.read", "operator.capabilities.read", "operator.admin.read", "operator.subjects.read", "operator.queue.read"],
      commands_enabled: false
    });
    const customer = await observe(port, {
      path: OPERATOR_CAPABILITIES,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("GET /api/v1/operator/subjects serves the shared customer directory to the operator audience only", async () => {
  await withServer({}, async (port) => {
    const response = await observe(port, { path: OPERATOR_SUBJECTS, headers: operatorHeaders() });
    assert.equal(response.status, 200);
    const view = JSON.parse(response.body);
    assert.equal(view.mode, "test");
    assert.ok(view.subjects.length >= 1);
    for (const row of view.subjects) {
      assert.match(row.subject_id, /^syn_cust_[a-z0-9]{8,32}$/u);
      assert.match(row.kyc_status, /^(unverified|pending|verified)$/u);
      assert.ok(Number.isInteger(row.flags) && row.flags >= 0);
      assert.ok(Date.parse(row.last_active_at) >= Date.parse(row.registered_at));
      assert.equal(row.posting, "none");
    }
    const customer = await observe(port, {
      path: OPERATOR_SUBJECTS,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
    assert.equal(header(customer, "www-authenticate"), "Bearer");
  });
});

test("GET /api/v1/operator/subjects/{subjectId} serves the roster detail to the operator audience only", async () => {
  await withServer({}, async (port) => {
    const list = await observe(port, { path: OPERATOR_SUBJECTS, headers: operatorHeaders() });
    const rows = JSON.parse(list.body).subjects;
    for (const row of rows) {
      const detail = await observe(port, {
        path: `${OPERATOR_SUBJECTS}/${row.subject_id}`,
        headers: operatorHeaders()
      });
      assert.equal(detail.status, 200, row.subject_id);
      const view = JSON.parse(detail.body);
      assert.equal(view.mode, "test");
      const subject = view.subject;
      // The detail extends the list row verbatim for the same id.
      for (const key of [
        "subject_id",
        "display_name",
        "kyc_status",
        "flags",
        "registered_at",
        "last_active_at",
        "posting"
      ]) {
        assert.deepEqual(subject[key], row[key], `${row.subject_id} ${key}`);
      }
      assert.match(subject.account_status, /^(active|dormant|restricted|closed)$/u);
      assert.match(subject.contact_hash, /^cth_[0-9a-f]{32}$/u);
      assert.ok(Number.isInteger(subject.sessions) && subject.sessions >= 0);
      assert.ok(subject.sessions <= subject.limits.max_sessions);
      assert.ok(Array.isArray(subject.devices) && subject.devices.length <= subject.limits.max_devices);
      for (const device of subject.devices) {
        assert.match(device, /^dev_[0-9a-f]{16}$/u);
      }
      assert.deepEqual(Object.keys(subject.limits).sort(), ["max_devices", "max_sessions"]);
      assert.ok(subject.limits.max_sessions >= 1 && subject.limits.max_sessions <= 16);
      assert.ok(subject.limits.max_devices >= 1 && subject.limits.max_devices <= 8);
    }
    // A well-formed id outside the roster — including an operator-shaped id
    // — fails closed as the pinned uniform 404 and never reveals which ids
    // exist.
    for (const id of [`syn_cust_${"f".repeat(24)}`, "syn_oper_00000001"]) {
      const missing = await observe(port, {
        path: `${OPERATOR_SUBJECTS}/${id}`,
        headers: operatorHeaders()
      });
      assert.equal(missing.status, 404);
      assert.equal(JSON.parse(missing.body).code, "CAPABILITY_DENIED");
    }
    const customer = await observe(port, {
      path: `${OPERATOR_SUBJECTS}/${rows[0].subject_id}`,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
    assert.equal(header(customer, "www-authenticate"), "Bearer");
  });
});

test("GET /api/v1/operator/queue serves the shared KYC work queue to the operator audience only", async () => {
  await withServer({}, async (port) => {
    const list = await observe(port, { path: OPERATOR_SUBJECTS, headers: operatorHeaders() });
    const roster = new Map(JSON.parse(list.body).subjects.map((row) => [row.subject_id, row]));
    const response = await observe(port, { path: OPERATOR_QUEUE, headers: operatorHeaders() });
    assert.equal(response.status, 200);
    const view = JSON.parse(response.body);
    assert.equal(view.mode, "test");
    assert.equal(view.queue.kind, "kyc");
    assert.equal(view.queue.posting, "none");
    assert.ok(view.queue.items.length >= 1);
    const tallied = { pending: 0, in_review: 0, escalated: 0 };
    for (const item of view.queue.items) {
      const row = roster.get(item.subject_id);
      assert.ok(row, `${item.subject_id} is outside the roster`);
      assert.notEqual(row.kyc_status, "verified");
      assert.equal(item.display_name, row.display_name);
      assert.match(item.queue_id, /^qky_[0-9a-f]{24}$/u);
      assert.match(item.state, /^(pending|in_review|escalated)$/u);
      assert.match(item.priority, /^(normal|high|urgent)$/u);
      assert.ok(Date.parse(item.submitted_at) >= Date.parse(row.registered_at));
      assert.ok(Date.parse(item.sla_due_at) > Date.parse(item.submitted_at));
      assert.ok(Number.isInteger(item.age_ms) && item.age_ms > 0);
      if (item.assignee === null) {
        assert.equal(item.state, "pending");
      } else {
        assert.match(item.assignee.subject, /^syn_oper_[a-z0-9]{8,32}$/u);
      }
      tallied[item.state] += 1;
    }
    assert.equal(view.queue.summary.count, view.queue.items.length);
    assert.deepEqual(view.queue.summary.by_state, tallied);
    const customer = await observe(port, {
      path: OPERATOR_QUEUE,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
    assert.equal(header(customer, "www-authenticate"), "Bearer");
  });
});

test("GET /api/v1/customer/deposits serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: DEPOSITS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: DEPOSITS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/withdrawals serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: WITHDRAWALS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: WITHDRAWALS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/quotes serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: QUOTES, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: QUOTES, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/exchange-orders serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: EXCHANGE_ORDERS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/exchange-orders/{orderId} serves the subject's own orders only", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: EXCHANGE_ORDER_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    assert.equal(JSON.parse(granted.body).order_id, EXCHANGE_ORDER_DETAIL.split("/").at(-1));
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: EXCHANGE_ORDER_DETAIL, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
    // A well-formed id that was never minted for the subject — including an
    // id minted for a different subject — fails closed as the pinned 404.
    const foreign = `/api/v1/customer/exchange-orders/${await orderIdFor(SUBJECT)}`;
    for (const path of ["/api/v1/customer/exchange-orders/ord_ffffffffffffffffffffffff", foreign]) {
      const response = await observe(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/trades serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: TRADES, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: TRADES, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/markets serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: MARKETS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: MARKETS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/markets/{instrument} serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: MARKET_DEPTH, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    const view = JSON.parse(granted.body);
    assert.equal(view.instrument, "USDT/RUB");
    // The member read shares the collection's capability and fails closed
    // on every other admission: unverified subjects are gated like the
    // list, and an instrument outside the declared universe answers the
    // same 404 as a malformed id — no existence leak.
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: MARKET_DEPTH, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
    for (const unknown of [
      "/api/v1/customer/markets/BTC%2FUSD",
      "/api/v1/customer/markets/nope"
    ]) {
      const missing = await observe(port, { path: unknown, headers: verifiedCustomerHeaders() });
      assert.equal(missing.status, 404);
      assert.equal(JSON.parse(missing.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/payments serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: PAYMENTS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: PAYMENTS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/cards serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: CARDS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: CARDS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/checks serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: CHECKS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: CHECKS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/activity serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: ACTIVITY, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: ACTIVITY, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/operations serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: OPERATIONS_LIST, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: OPERATIONS_LIST, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/operations/{operationId} serves the subject's own operations only", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: OPERATION_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    assert.equal(JSON.parse(granted.body).operation_id, OPERATION_DETAIL.split("/").at(-1));
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: OPERATION_DETAIL, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
    // A well-formed id that was never minted for the subject — including an
    // id minted for a different subject — fails closed as the pinned 404.
    const foreign = `/api/v1/customer/operations/${await operationIdFor(SUBJECT)}`;
    for (const path of ["/api/v1/customer/operations/ope_ffffffffffffffffffffffff", foreign]) {
      const response = await observe(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/deposit-addresses serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: DEPOSIT_ADDRESSES, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: DEPOSIT_ADDRESSES, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/address-screenings serves verified customers and gates the rest", async () => {
  await withServer({}, async (port) => {
    const granted = await observe(port, { path: ADDRESS_SCREENINGS, headers: verifiedCustomerHeaders() });
    assert.equal(granted.status, 200);
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, { path: ADDRESS_SCREENINGS, headers });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("GET /api/v1/customer/address-screenings/{screeningId} serves the owned record and 404s the rest", async () => {
  await withServer({}, async (port) => {
    const list = await observe(port, { path: ADDRESS_SCREENINGS, headers: verifiedCustomerHeaders() });
    assert.equal(list.status, 200);
    const screenings = JSON.parse(list.body).screenings;
    assert.ok(screenings.length >= 1);
    for (const entry of screenings) {
      const detail = await observe(port, {
        path: `${ADDRESS_SCREENINGS}/${entry.screening_id}`,
        headers: verifiedCustomerHeaders()
      });
      assert.equal(detail.status, 200, entry.screening_id);
    }
    const missing = await observe(port, {
      path: `${ADDRESS_SCREENINGS}/scr_${"f".repeat(32)}`,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.body).code, "CAPABILITY_DENIED");
    for (const headers of [customerHeaders()]) {
      const denied = await observe(port, {
        path: `${ADDRESS_SCREENINGS}/${screenings[0].screening_id}`,
        headers
      });
      assert.equal(denied.status, 403);
      assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("a principal for a non-customer actor is never accepted on the wrong audience", async () => {
  const verifier = {
    async verify() {
      return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
    }
  };
  await withServer({ verifier, kycDirectory: createSyntheticKycDirectory() }, async (port) => {
    const response = await observe(port, { path: SESSION, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});


test("a principal for a non-customer actor is never accepted on the wrong audience", async () => {
  const verifier = {
    async verify() {
      return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
    }
  };
  await withServer({ verifier, kycDirectory: createSyntheticKycDirectory() }, async (port) => {
    const response = await observe(port, { path: SESSION, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("every declared status of every served operation is reachable", () => {
  for (const operation of OPERATIONS) {
    for (const status of operation.statuses) {
      assert.ok(observed.has(`${operation.path} ${status}`), `${operation.operationId} ${status}`);
    }
  }
});
