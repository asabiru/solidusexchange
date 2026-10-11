import assert from "node:assert/strict";
import test from "node:test";

import {
  ADDRESS_SCREENING_RISK_LEVELS,
  ADDRESS_SCREENING_STATUSES,
  ADDRESS_SCREENING_TARGETS,
  ADDRESS_SCREENING_VERDICTS,
  createSyntheticAddressScreeningDirectory,
  validAddressScreeningsView,
  validAddressScreeningView
} from "../src/address-screenings.mjs";
import { createSyntheticKycDirectory } from "../src/capabilities.mjs";
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

const ADDRESS_SCREENINGS = "/api/v1/customer/address-screenings";
const SCREENING_ID = /^scr_[0-9a-f]{32}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const VERDICT_BY_RISK_LEVEL = { low: "clear", medium: "review", high: "flagged", severe: "flagged" };

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

async function firstScreeningId(port) {
  const response = await checkedRequest(port, {
    path: ADDRESS_SCREENINGS,
    headers: verifiedCustomerHeaders()
  });
  assert.equal(response.status, 200);
  const view = JSON.parse(response.body);
  assert.ok(view.screenings.length >= 1);
  return view.screenings[0].screening_id;
}

test("synthetic address screening directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticAddressScreeningDirectory();
  const first = await directory.listFor(VERIFIED_SUBJECT);
  const second = await directory.listFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.screenings));
  for (const entry of first.screenings) {
    assert.ok(Object.isFrozen(entry));
  }
  assert.equal(first.mode, "test");
  assert.deepEqual(
    first.screenings.map((entry) => `${entry.asset}/${entry.network}`),
    ADDRESS_SCREENING_TARGETS.map((target) => `${target.asset}/${target.network}`)
  );
  const other = await directory.listFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const entry of [...first.screenings, ...other.screenings]) {
    assert.match(entry.screening_id, SCREENING_ID);
    assert.ok(
      ADDRESS_SCREENING_TARGETS.some(
        (target) => target.asset === entry.asset && target.network === entry.network
      )
    );
    assert.equal(entry.direction, "outbound");
    assert.ok(ADDRESS_SCREENING_STATUSES.includes(entry.status));
    assert.ok(ADDRESS_SCREENING_VERDICTS.includes(entry.verdict));
    // status carries the risk badge: a terminal outcome echoes as risk_level
    // with the matching verdict, an operational state clears both.
    if (ADDRESS_SCREENING_RISK_LEVELS.includes(entry.status)) {
      assert.equal(entry.risk_level, entry.status);
      assert.equal(entry.verdict, VERDICT_BY_RISK_LEVEL[entry.risk_level]);
    } else {
      assert.equal(entry.risk_level, null);
      assert.equal(entry.verdict, "none");
    }
    // Advisory-only vocabulary: never executable, posting stays "none".
    assert.equal(entry.advisory, true);
    assert.equal(entry.executable, false);
    assert.match(entry.submitted_at, ISO_TIMESTAMP);
    assert.match(entry.deadline, ISO_TIMESTAMP);
    assert.ok(Date.parse(entry.deadline) > Date.parse(entry.submitted_at));
    assert.equal(entry.posting, "none");
  }
});

test("detail lookup returns the same frozen record and misses foreign ids", async () => {
  const directory = createSyntheticAddressScreeningDirectory();
  const view = await directory.listFor(VERIFIED_SUBJECT);
  for (const entry of view.screenings) {
    const detail = await directory.viewFor(VERIFIED_SUBJECT, entry.screening_id);
    assert.deepEqual(detail, entry);
  }
  for (const subject of [SUBJECT, "syn_cust_ffffffff"]) {
    const foreign = await directory.viewFor(subject, view.screenings[0].screening_id);
    assert.equal(foreign, undefined, subject);
  }
  for (const malformed of ["", "scr_short", "wdr_0123456789abcdef01234567", "SCR_0123456789ABCDEF0123456789ABCDEF"]) {
    assert.equal(await directory.viewFor(VERIFIED_SUBJECT, malformed), undefined, malformed);
  }
});

test("every derived view conforms to the declared AddressScreeningsView schema", async () => {
  const directory = createSyntheticAddressScreeningDirectory();
  for (const subject of [SUBJECT, VERIFIED_SUBJECT, "syn_cust_ffffffff", "syn_cust_00000000"]) {
    const view = await directory.listFor(subject);
    assert.deepEqual(
      validator.validate({ $ref: "#/components/schemas/AddressScreeningsView" }, { ...view }),
      [],
      subject
    );
    for (const entry of view.screenings) {
      assert.deepEqual(
        validator.validate({ $ref: "#/components/schemas/AddressScreeningView" }, { ...entry }),
        [],
        `${subject} ${entry.screening_id}`
      );
    }
  }
});

test("synthetic screening views cover every status", async () => {
  const directory = createSyntheticAddressScreeningDirectory();
  const seen = new Set();
  for (let index = 0; index < 64 && seen.size < ADDRESS_SCREENING_STATUSES.length; index += 1) {
    const view = await directory.listFor(`syn_cust_status${String(index).padStart(4, "0")}`);
    for (const entry of view.screenings) {
      seen.add(entry.status);
    }
  }
  assert.deepEqual([...seen].sort(), [...ADDRESS_SCREENING_STATUSES].sort());
});

test("validAddressScreeningsView and validAddressScreeningView fail closed on directory drift", () => {
  const entry = {
    screening_id: "scr_0123456789abcdef0123456789abcdef",
    asset: "TON",
    network: "TON_TESTNET",
    direction: "outbound",
    status: "high",
    verdict: "flagged",
    risk_level: "high",
    advisory: true,
    executable: false,
    submitted_at: "2026-09-15T00:00:00.000Z",
    deadline: "2026-09-15T00:30:00.000Z",
    posting: "none"
  };
  const bad = [
    null,
    "screenings",
    {},
    { mode: "test" },
    { mode: "live", screenings: [] },
    { mode: "test", screenings: null },
    { mode: "test", screenings: [], extra: true },
    { mode: "test", screenings: [{ ...entry, extra: "x" }] },
    { mode: "test", screenings: [{ ...entry, screening_id: "scr_short" }] },
    { mode: "test", screenings: [{ ...entry, asset: "RUB" }] },
    { mode: "test", screenings: [{ ...entry, direction: "inbound" }] },
    { mode: "test", screenings: [{ ...entry, status: "approved" }] },
    { mode: "test", screenings: [{ ...entry, verdict: "blocked" }] },
    { mode: "test", screenings: [{ ...entry, verdict: "clear" }] },
    { mode: "test", screenings: [{ ...entry, risk_level: "low" }] },
    { mode: "test", screenings: [{ ...entry, risk_level: "critical" }] },
    { mode: "test", screenings: [{ ...entry, status: "pending" }] },
    { mode: "test", screenings: [{ ...entry, status: "pending", verdict: "none", risk_level: "low" }] },
    { mode: "test", screenings: [{ ...entry, advisory: false }] },
    { mode: "test", screenings: [{ ...entry, executable: true }] },
    { mode: "test", screenings: [{ ...entry, submitted_at: "yesterday" }] },
    { mode: "test", screenings: [{ ...entry, deadline: entry.submitted_at }] },
    { mode: "test", screenings: [{ ...entry, posting: "ledger" }] },
    { mode: "test", screenings: [["scr_1"]] }
  ];
  for (const view of bad) {
    assert.equal(validAddressScreeningsView(view), false, JSON.stringify(view));
    if (Array.isArray(view?.screenings)) {
      assert.equal(validAddressScreeningView(view.screenings[0]), false, JSON.stringify(view));
    }
  }
  const full = [
    entry,
    { ...entry, screening_id: "scr_aaaaaaaabbbbbbbbccccccccdddddddd", asset: "USDT", network: "TON_TESTNET" },
    { ...entry, screening_id: "scr_eeeeeeeeffffffff0000000011111111", asset: "USDT", network: "TRON_TESTNET" }
  ];
  assert.equal(validAddressScreeningsView({ mode: "test", screenings: full }), true);
  // One record per (asset, network) target — a duplicate or a missing pair fails closed.
  assert.equal(validAddressScreeningsView({ mode: "test", screenings: [entry] }), false);
  assert.equal(
    validAddressScreeningsView({ mode: "test", screenings: [...full, { ...entry, screening_id: "scr_11111111222222223333333344444444" }] }),
    false
  );
  assert.equal(validAddressScreeningView(entry), true);
  assert.equal(
    validAddressScreeningView({ ...entry, status: "pending", verdict: "none", risk_level: null }),
    true
  );
});

test("GET /api/v1/customer/address-screenings returns the exact synthetic view for a verified customer", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticAddressScreeningDirectory().listFor(VERIFIED_SUBJECT);
    const response = await checkedRequest(port, {
      path: ADDRESS_SCREENINGS,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ...expected, screenings: [...expected.screenings] });
    assert.equal(header(response, "x-request-id"), REQUEST_ID);
    assert.equal(header(response, "cache-control"), "no-store");
    const repeat = await checkedRequest(port, {
      path: ADDRESS_SCREENINGS,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(repeat.body, response.body);
  });
});

test("GET /api/v1/customer/address-screenings/{screeningId} returns the owned record", async () => {
  await withServer({}, async (port) => {
    const expected = await createSyntheticAddressScreeningDirectory().listFor(VERIFIED_SUBJECT);
    for (const entry of expected.screenings) {
      const response = await checkedRequest(port, {
        path: `${ADDRESS_SCREENINGS}/${entry.screening_id}`,
        headers: verifiedCustomerHeaders()
      });
      assert.equal(response.status, 200, entry.screening_id);
      assert.deepEqual(JSON.parse(response.body), { ...entry });
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
    }
  });
});

test("the detail read 404s on foreign, malformed and trailing-segment ids", async () => {
  await withServer({}, async (port) => {
    const known = await firstScreeningId(port);
    const foreign = await createSyntheticAddressScreeningDirectory().listFor(SUBJECT);
    for (const path of [
      `${ADDRESS_SCREENINGS}/${foreign.screenings[0].screening_id}`,
      `${ADDRESS_SCREENINGS}/scr_${"f".repeat(32)}`,
      `${ADDRESS_SCREENINGS}/scr_short`,
      `${ADDRESS_SCREENINGS}/${known}/extra`,
      `${ADDRESS_SCREENINGS}/`,
      `${ADDRESS_SCREENINGS}?unused=1`
    ]) {
      const response = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 404, path);
      const body = JSON.parse(response.body);
      assert.equal(body.code, "CAPABILITY_DENIED", path);
      assert.equal(body.request_id, REQUEST_ID);
      assert.deepEqual(body.details, {});
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
    }
  });
});

test("unverified and pending customers are denied with the 403 envelope on list and detail", async () => {
  const kycDirectory = createSyntheticKycDirectory({
    [VERIFIED_SUBJECT]: "verified",
    syn_cust_pending01: "pending"
  });
  await withServer({ kycDirectory }, async (port) => {
    const known = await firstScreeningId(port);
    for (const path of [ADDRESS_SCREENINGS, `${ADDRESS_SCREENINGS}/${known}`]) {
      for (const subject of [SUBJECT, "syn_cust_pending01", "syn_cust_unknown01"]) {
        const response = await checkedRequest(port, {
          path,
          headers: customerHeaders({ Authorization: `Bearer ${token({ subject })}` })
        });
        assert.equal(response.status, 403, `${subject} ${path}`);
        const body = JSON.parse(response.body);
        assert.equal(body.code, "CAPABILITY_DENIED");
        assert.equal(body.request_id, REQUEST_ID);
        assert.deepEqual(body.details, {});
      }
    }
  });
});

test("unauthenticated and non-customer tokens are rejected like the sibling reads", async () => {
  await withServer({}, async (port) => {
    const known = await firstScreeningId(port);
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
    for (const path of [ADDRESS_SCREENINGS, `${ADDRESS_SCREENINGS}/${known}`]) {
      for (const value of rejected) {
        const response = await checkedRequest(port, {
          path,
          headers: verifiedCustomerHeaders({ Authorization: value })
        });
        assert.equal(response.status, 401, `${String(value)} ${path}`);
        assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
        assert.equal(header(response, "www-authenticate"), "Bearer");
      }
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
    for (const path of [ADDRESS_SCREENINGS, `${ADDRESS_SCREENINGS}/scr_${"0".repeat(32)}`]) {
      const response = await checkedRequest(port, { path, headers: customerHeaders() });
      assert.equal(response.status, 401, path);
    }
  });
});

test("rate limiting applies before the capability check on both routes", async () => {
  let now = NOW_MS;
  const rateLimiter = createFixedWindowRateLimiter({ limit: 1, clock: () => now });
  await withServer({ rateLimiter }, async (port) => {
    assert.equal(
      (await checkedRequest(port, { path: ADDRESS_SCREENINGS, headers: verifiedCustomerHeaders() }))
        .status,
      200
    );
    const limited = await checkedRequest(port, {
      path: ADDRESS_SCREENINGS,
      headers: verifiedCustomerHeaders()
    });
    assert.equal(limited.status, 429);
    assert.equal(JSON.parse(limited.body).code, "RATE_LIMITED");
    now += 61_000;
    assert.equal(
      (await checkedRequest(port, { path: ADDRESS_SCREENINGS, headers: customerHeaders() })).status,
      403
    );
  });
});

test("address screening and kyc directory failures return a client-safe 500 envelope", async () => {
  const failures = [
    {
      addressScreeningDirectory: {
        async listFor() {
          throw new Error("screening store exploded: secret=abc");
        },
        async viewFor() {
          throw new Error("screening store exploded: secret=abc");
        }
      }
    },
    {
      addressScreeningDirectory: {
        async listFor() {
          return { screenings: "nope" };
        },
        async viewFor() {
          return undefined;
        }
      }
    },
    {
      addressScreeningDirectory: {
        async listFor() {
          return { mode: "test", screenings: [], extra: "x" };
        },
        async viewFor() {
          return { verdict: "half-baked" };
        }
      }
    },
    { kycDirectory: { async statusFor() { throw new Error("kyc provider down"); } } }
  ];
  // Every failure mode 500s the collection route; on the detail route the
  // same failures 500 too, except a viewFor miss (undefined) which is the
  // legitimate "no such owned record" 404 — only thrown/malformed directory
  // output is a 500.
  for (const options of failures) {
    await withServer(options, async (port) => {
      const collection = await checkedRequest(port, {
        path: ADDRESS_SCREENINGS,
        headers: verifiedCustomerHeaders()
      });
      assert.equal(collection.status, 500, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(collection.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(collection.body, /secret|exploded|provider|half-baked/u);
      const detail = await checkedRequest(port, {
        path: `${ADDRESS_SCREENINGS}/scr_${"0".repeat(32)}`,
        headers: verifiedCustomerHeaders()
      });
      // The second entry's viewFor resolves undefined — a legitimate "no such
      // owned record" miss — so the detail route answers the declared 404; a
      // thrown or malformed directory result stays a client-safe 500.
      const miss = failures.indexOf(options) === 1;
      const expected = miss ? 404 : 500;
      assert.equal(detail.status, expected, JSON.stringify(Object.keys(options)));
      assert.equal(JSON.parse(detail.body).code, miss ? "CAPABILITY_DENIED" : "INTERNAL_ERROR");
      assert.doesNotMatch(detail.body, /secret|exploded|provider|half-baked/u);
    });
  }
});

test("screening write subpaths and method variants stay contract-only 404s", async () => {
  await withServer({}, async (port) => {
    const known = await firstScreeningId(port);
    // Submitting a screening is unserved: POST stays a 404 on the collection,
    // the detail route and any command-style suffix.
    for (const path of [
      ADDRESS_SCREENINGS,
      `${ADDRESS_SCREENINGS}/${known}`,
      `${ADDRESS_SCREENINGS}/preview`,
      `${ADDRESS_SCREENINGS}/${known}/cancel`
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await checkedRequest(port, {
          method,
          path,
          headers: verifiedCustomerHeaders()
        });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
      }
    }
  });
});
