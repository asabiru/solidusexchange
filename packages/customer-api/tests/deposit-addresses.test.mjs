import assert from "node:assert/strict";
import test from "node:test";

import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
import {
  createSyntheticDepositAddressDirectory,
  DEPOSIT_ADDRESS_TARGETS,
  validDepositAddressesView
} from "../src/deposit-addresses.mjs";
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

const DEPOSIT_ADDRESSES = "/api/v1/customer/deposit-addresses";
const DEPOSIT_ADDRESS_ID = /^dpa_[0-9a-f]{24}$/u;
const TON_TESTNET_ADDRESS = /^kQ[A-Za-z0-9_-]{46}$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic deposit address directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticDepositAddressDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.deposit_addresses));
  for (const entry of first.deposit_addresses) {
    assert.ok(Object.isFrozen(entry));
  }
  assert.equal(first.mode, "test");
  assert.deepEqual(
    first.deposit_addresses.map((entry) => `${entry.asset}/${entry.network}`),
    DEPOSIT_ADDRESS_TARGETS.map((target) => `${target.asset}/${target.network}`)
  );
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const entry of [...first.deposit_addresses, ...other.deposit_addresses]) {
    assert.match(entry.deposit_address_id, DEPOSIT_ADDRESS_ID);
    if (entry.network === "TON_TESTNET") {
      assert.match(entry.address, TON_TESTNET_ADDRESS);
    } else {
      assert.equal(entry.network, "TRON_TESTNET");
      assert.match(entry.address, TRON_ADDRESS);
    }
    assert.equal(entry.status, "active");
    assert.match(entry.created_at, ISO_TIMESTAMP);
    // The served address set is advisory-only: posting stays "none" and the
    // shape can never carry key material (no private_key/seed/mnemonic field
    // exists in the schema at all).
    assert.equal(entry.posting, "none");
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["address", "asset", "created_at", "deposit_address_id", "network", "posting", "status"]
    );
  }
});

test("every derived view conforms to the declared DepositAddressesView schema", async () => {
  const directory = createSyntheticDepositAddressDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(
      validator.validate({ $ref: "#/components/schemas/DepositAddressesView" }, { ...view }),
      [],
      subject
    );
  }
});

test("validDepositAddressesView fails closed on directory drift", () => {
  const entry = {
    deposit_address_id: "dpa_0123456789abcdef01234567",
    asset: "TON",
    network: "TON_TESTNET",
    address: "kQ"+"A".repeat(46),
    status: "active",
    created_at: "2026-09-01T00:00:00.000Z",
    posting: "none"
  };
  const bad = [
    null,
    "deposit_addresses",
    {},
    { mode: "test" },
    { mode: "live", deposit_addresses: [] },
    { mode: "test", deposit_addresses: null },
    { mode: "test", deposit_addresses: [], extra: true },
    { mode: "test", deposit_addresses: [{ ...entry, extra: "x" }] },
    { mode: "test", deposit_addresses: [{ ...entry, deposit_address_id: "adr_short" }] },
    { mode: "test", deposit_addresses: [{ ...entry, asset: "RUB" }] },
    { mode: "test", deposit_addresses: [{ ...entry, network: "TON_MAINNET" }] },
    { mode: "test", deposit_addresses: [{ ...entry, asset: "USDT", network: "ETHEREUM_TESTNET" }] },
    { mode: "test", deposit_addresses: [{ ...entry, address: "0x742d35Cc6634C0532925a3b844Bc9e7595f" }] },
    { mode: "test", deposit_addresses: [{ ...entry, status: "rotated" }] },
    { mode: "test", deposit_addresses: [{ ...entry, created_at: "yesterday" }] },
    { mode: "test", deposit_addresses: [{ ...entry, posting: "ledger" }] },
    { mode: "test", deposit_addresses: [{ ...entry, private_key: "abc" }] },
    { mode: "test", deposit_addresses: [["dpa_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validDepositAddressesView(view), false, JSON.stringify(view));
  }
  const full = [
    entry,
    { ...entry, deposit_address_id: "dpa_aaaaaaaabbbbbbbbcccccccc", asset: "USDT" },
    {
      ...entry,
      deposit_address_id: "dpa_dddddddd55555555eeeeeeee",
      asset: "USDT",
      network: "TRON_TESTNET",
      address: "T" + "B".repeat(33)
    }
  ];
  assert.equal(validDepositAddressesView({ mode: "test", deposit_addresses: full }), true);
  // One entry per (asset, network) target — a duplicate or a missing pair fails closed.
  assert.equal(validDepositAddressesView({ mode: "test", deposit_addresses: [entry] }), false);
  assert.equal(
    validDepositAddressesView({ mode: "test", deposit_addresses: [...full, { ...entry, deposit_address_id: "dpa_ffffffff0000000011111111" }] }),
    false
  );
});

test("GET /api/v1/customer/deposit-addresses returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticDepositAddressDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, {
      path: DEPOSIT_ADDRESSES,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ...expected,
      deposit_addresses: [...expected.deposit_addresses]
    });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, {
      path: DEPOSIT_ADDRESSES,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(repeat.body, response.body);
  });
});

test("unverified and pending customers are denied with the 403 envelope", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    for (const subject of [SUBJECT, "syn_cust_pending01", "syn_cust_unknown01"]) {
      const response = await checkedRequest(port, {
        path: DEPOSIT_ADDRESSES,
        headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
      });
      assert.equal(response.status, 403, subject);
      const body = JSON.parse(response.body);
      assert.equal(body.code, "CAPABILITY_DENIED");
      assert.equal(body.request_id, REQUEST_ID);
      assert.deepEqual(body.details, {});
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
    }
    const verified = await checkedRequest(port, {
      path: DEPOSIT_ADDRESSES,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(verified.status, 200);
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
        path: DEPOSIT_ADDRESSES,
        headers: verifiedCustomerHeaders({ Authorization: value })
      });
      assert.equal(response.status, 401, String(value));
      assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
      assert.equal(header(response, "www-authenticate"), "Bearer");
    }
  });
  const operator = {
    async verify() {
      return {
        subject: "syn_operator_1",
        actorType: "operator",
        scopes: [],
        expiresAt: "2026-10-01T13:00:00.000Z"
      };
    }
  };
  await withServer({ verifier: operator }, async (port) => {
    const response = await checkedRequest(port, { path: DEPOSIT_ADDRESSES, headers: customerHeaders() });
    assert.equal(response.status, 401);
  });
});

test("rate limiting applies before the capability check", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal(
      (await checkedRequest(port, { path: DEPOSIT_ADDRESSES, headers: verifiedCustomerHeaders() }))
        .status,
      200
    );
    const limited = await checkedRequest(port, {
      path: DEPOSIT_ADDRESSES,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal(
      (await checkedRequest(port, { path: DEPOSIT_ADDRESSES, headers: customerHeaders() })).status,
      403
    );
  });
});

test("deposit address and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    {
      depositAddressDirectory: {
        async listFor() {
          throw new Error("deposit address store exploded: secret=abc");
        }
      }
    },
    { depositAddressDirectory: { async listFor() { return { deposit_addresses: "nope" }; } } },
    {
      depositAddressDirectory: {
        async listFor() {
          return { mode: "test", deposit_addresses: [], extra: "x" };
        }
      }
    },
    {
      depositAddressDirectory: {
        async listFor() {
          return {
            mode: "test",
            deposit_addresses: [
              {
                deposit_address_id: "dpa_0123456789abcdef01234567",
                asset: "TON",
                network: "TON_TESTNET",
                address: "kQ"+"A".repeat(46),
                status: "active",
                created_at: "2026-09-01T00:00:00.000Z",
                posting: "none",
                private_key: "leaked"
              }
            ]
          };
        }
      }
    },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  for (const options of failures) {
    await withServer(options, async (port) => {
      const response = await checkedRequest(port, {
        path: DEPOSIT_ADDRESSES,
        headers: verifiedCustomerHeaders()
      });
      assert.equal(response.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded|provider|leaked/u);
    });
  }
});

test("deposit address subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    for (const path of [
      "/api/v1/customer/deposit-addresses/",
      "/api/v1/customer/deposit-addresses/1",
      "/api/v1/customer/deposit-addresses/dpa_000000000000000000000001",
      "/api/v1/customer/deposit-addresses/all"
    ]) {
      for (const method of ["GET", "POST"]) {
        const response = await checkedRequest(port, {
          method,
          path,
          headers: verifiedCustomerHeaders()
        });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await checkedRequest(port, {
        method,
        path: DEPOSIT_ADDRESSES,
        headers: verifiedCustomerHeaders()
      });
      assert.equal(response.status, 404, method);
    }
  });
});
