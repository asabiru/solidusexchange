import assert from "node:assert/strict";
import test from "node:test";

import { createDenyAllVerifier } from "../src/auth.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import { API_METADATA, CONTRACT_GAP_STATUSES, OPERATIONS, PLATFORMS } from "../src/contract.mjs";
import { createFixedWindowRateLimiter } from "../src/rate-limit.mjs";
import { CONTRACT_GAP_STATUSES as VALIDATOR_GAP_STATUSES } from "./contract-validator.mjs";
import {
  checkedRequest,
  contract,
  customerHeaders,
  header,
  NOW_MS,
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
const metaHeaders = [["X-Request-Id", REQUEST_ID]];
const observed = new Set();

async function observe(port, options) {
  const response = await checkedRequest(port, options);
  observed.add(`${options.path} ${response.status}`);
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
    .map((parameter) => validator.resolve(parameter.$ref))
    .filter((parameter) => parameter.in === "header" && parameter.required)
    .map((parameter) => parameter.name.toLowerCase());
}

test("served operations match the contract exactly; operator and checks paths are not served", () => {
  const served = new Set(OPERATIONS.map((operation) => operation.path));
  const contractOperations = [];
  for (const [path, item] of Object.entries(contract.openapi.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      contractOperations.push({ path, method: method.toUpperCase(), operation });
    }
  }
  const expected = contractOperations.filter(
    ({ path }) => !path.startsWith("/api/v1/operator/") && !path.startsWith("/api/v1/customer/checks/")
  );
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
    const required = headerParameterNames(operation);
    if (runtime.authenticated) {
      required.push("authorization");
      assert.deepEqual(operation.security, [{ CustomerBearer: [] }]);
    }
    assert.deepEqual([...runtime.requiredHeaders].sort(), required.sort());
    assert.ok(!required.includes("x-device-id"));
  }
  const unservedPaths = contractOperations.filter(
    ({ path }) => path.startsWith("/api/v1/operator/") || path.startsWith("/api/v1/customer/checks/")
  );
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
          ? ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read", "customer.wallets.read", "customer.notifications.read", "customer.deposits.read", "customer.withdrawals.read", "customer.quotes.read", "customer.exchange-orders.read", "customer.payments.read", "customer.cards.read"]
          : ["customer.session.read", "customer.capabilities.read", "customer.kyc.read", "customer.profile.read", "customer.support.read"],
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
    for (const path of [SESSION, CAPABILITIES, WALLETS, NOTIFICATIONS, KYC, PROFILE, SUPPORT, DEPOSITS, WITHDRAWALS, QUOTES, EXCHANGE_ORDERS, PAYMENTS, CARDS]) {
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
    for (const path of [SESSION, CAPABILITIES, WALLETS, NOTIFICATIONS, KYC, PROFILE, SUPPORT, DEPOSITS, WITHDRAWALS, QUOTES, EXCHANGE_ORDERS, PAYMENTS, CARDS]) {
      now += 61_000;
      assert.equal((await observe(port, { path, headers: verifiedCustomerHeaders() })).status, 200);
      assert.equal((await observe(port, { path, headers: customerHeaders({ Authorization: null }) })).status, 401);
      const limited = await observe(port, { path, headers: verifiedCustomerHeaders() });
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
  await withServer({ exchangeOrderDirectory: { async listFor() { throw new Error("order store exploded: secret=abc"); } } }, async (port) => {
    const response = await observe(port, { path: EXCHANGE_ORDERS, headers: verifiedCustomerHeaders() });
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

test("a principal for a non-customer actor is never accepted as a customer", async () => {
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
