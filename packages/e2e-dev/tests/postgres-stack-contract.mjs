// Postgres persistence arm of the e2e dev stack. Intentionally NOT named
// `*.test.mjs`: `npm test` stays docker-free, and this suite is only
// reachable through tests/postgres-stack.sh, which brings the pinned
// postgres service up, applies both migrations, and exports the store
// env. Missing env fails hard — the harness is the only supported entry
// point, same convention as the package-level postgres contracts.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateUuidV7 } from "@solidchange/customer-api/request-id";
import { mintSyntheticCustomerToken } from "@solidchange/customer-api/synthetic-token";

import {
  customerApiEntry,
  runToExit,
  startService,
  stopService
} from "./stack.mjs";

const customerDsn = process.env.CUSTOMER_API_STORE_DSN;
const journalDsn = process.env.MATCHING_CORE_STORE_DSN;
assert.ok(customerDsn, "CUSTOMER_API_STORE_DSN is required (run tests/postgres-stack.sh)");
assert.ok(journalDsn, "MATCHING_CORE_STORE_DSN is required (run tests/postgres-stack.sh)");

const journalHelperEntry = fileURLToPath(new URL("./postgres-journal-helper.mjs", import.meta.url));
const devTokenKey = randomBytes(32).toString("hex");
const subject = `syn_cust_${randomBytes(6).toString("hex")}`;
const tokenExpiresAt = Math.floor(Date.now() / 1_000) + 300;
const token = mintSyntheticCustomerToken({
  key: devTokenKey,
  subject,
  expiresAtSeconds: tokenExpiresAt
});

function customerApiEnv(overrides) {
  return {
    CUSTOMER_API_HOST: "127.0.0.1",
    CUSTOMER_API_PORT: "0",
    CUSTOMER_API_DEV_AUTH: "synthetic",
    CUSTOMER_API_DEV_TOKEN_KEY: devTokenKey,
    CUSTOMER_API_RATE_LIMIT_PER_MINUTE: "8",
    ...overrides
  };
}

async function sessionStatuses(base, count) {
  const statuses = [];
  for (let index = 0; index < count; index += 1) {
    const requestId = generateUuidV7();
    const response = await fetch(`${base}/api/v1/customer/session`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-request-id": requestId,
        "x-client-version": "e2e-dev-postgres",
        "x-platform": "web"
      }
    });
    const entry = {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      requestIdEcho: response.headers.get("x-request-id")
    };
    if (response.status === 200) {
      // The 200 must carry the minted session, not a drifted stub: subject
      // binding, actor type, granted scopes, the token's own expiry, and
      // the echoed request id are all pinned.
      const body = await response.json();
      assert.equal(body.subject, subject);
      assert.equal(body.actor_type, "customer");
      assert.ok(Array.isArray(body.scopes) && body.scopes.length > 0);
      assert.ok(body.scopes.every((scope) => typeof scope === "string"));
      assert.equal(body.expires_at, new Date(tokenExpiresAt * 1_000).toISOString());
      assert.equal(entry.requestIdEcho, requestId);
    } else {
      await response.arrayBuffer();
    }
    statuses.push(entry);
  }
  return statuses;
}

async function bucketAcrossRestart(storeEnv, ready, preRestartHits, postRestartHits) {
  const first = await startService(customerApiEntry, storeEnv, ready);
  const before = await sessionStatuses(`http://127.0.0.1:${first.match[1]}`, preRestartHits);
  await stopService(first);

  const second = await startService(customerApiEntry, storeEnv, ready);
  const after = await sessionStatuses(`http://127.0.0.1:${second.match[1]}`, postRestartHits);
  await stopService(second);
  return { before, after };
}

test("postgres rate-limit counters continue where they left off across a process restart", async () => {
  const { before, after } = await bucketAcrossRestart(
    customerApiEnv({
      CUSTOMER_API_STORE: "postgres",
      CUSTOMER_API_STORE_DSN: customerDsn
    }),
    /listening on http:\/\/127\.0\.0\.1:(\d+) auth=synthetic-dev store=postgresql/,
    3,
    7
  );

  // A bucket of 8 consumed 3 times before the restart must still have 5
  // slots after it: a memory backend would restart at 8 and never deny
  // here. The 200→429 transition count is pinned exactly.
  assert.deepEqual(before.map((entry) => entry.status), [200, 200, 200]);
  assert.deepEqual(
    after.map((entry) => entry.status),
    [200, 200, 200, 200, 200, 429, 429]
  );
  for (const denied of after.slice(5)) {
    assert.equal(denied.status, 429);
    assert.match(denied.retryAfter ?? "", /^[1-9][0-9]*$/);
  }
});

test("memory rate-limit counters restart fresh for the same scenario (contrast)", async () => {
  const { before, after } = await bucketAcrossRestart(
    customerApiEnv({ CUSTOMER_API_STORE: "memory" }),
    /listening on http:\/\/127\.0\.0\.1:(\d+) auth=synthetic-dev store=memory/,
    3,
    9
  );

  // The in-process backend drops the bucket at restart, so the post-restart
  // window has the full 8 slots again — the ninth hit is the only denial.
  assert.deepEqual(before.map((entry) => entry.status), [200, 200, 200]);
  assert.deepEqual(
    after.map((entry) => entry.status),
    [200, 200, 200, 200, 200, 200, 200, 200, 429]
  );
});

test("the matching journal persists across independent helper processes", async () => {
  const env = {
    MATCHING_CORE_STORE: "postgres",
    MATCHING_CORE_STORE_DSN: journalDsn,
    MATCHING_CORE_JOURNAL_NAMESPACE: "e2e_stack"
  };

  // The matching engine runs embedded inside customer-api request
  // handlers — there is no engine daemon in the stack to restart — so the
  // durability proof happens at the store contract: one helper run records
  // a deterministic scenario, a second restores it via
  // replayMatchingJournalStore and continues the recorded stream.
  const record = await runToExit(journalHelperEntry, { ...env, JOURNAL_HELPER_MODE: "record" });
  assert.equal(record.signal, null, `record helper was killed: ${record.stderr}`);
  assert.equal(record.code, 0, `record helper failed: ${record.stderr}`);
  const recorded = record.stdout.match(/journal-helper-record-ok events=(\d+)/);
  assert.ok(recorded, `record helper output: ${record.stdout}`);

  const verify = await runToExit(journalHelperEntry, { ...env, JOURNAL_HELPER_MODE: "verify" });
  assert.equal(verify.signal, null, `verify helper was killed: ${verify.stderr}`);
  assert.equal(verify.code, 0, `verify helper failed: ${verify.stderr}`);
  const continued = verify.stdout.match(/journal-helper-verify-ok events=(\d+)/);
  assert.ok(continued, `verify helper output: ${verify.stdout}`);
  assert.ok(
    Number(continued[1]) > Number(recorded[1]),
    "the restored engine must append new events on top of the recorded stream"
  );
});

test("customer-api refuses to start when the configured store is unreachable", async () => {
  const result = await runToExit(
    customerApiEntry,
    customerApiEnv({
      CUSTOMER_API_STORE: "postgres",
      CUSTOMER_API_STORE_DSN: "postgres://u:p@127.0.0.1:1/unreachable"
    })
  );
  assert.equal(result.signal, null);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /customer-api store is unavailable/);
  assert.doesNotMatch(result.stdout, /listening/);
});
