import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_ASSETS,
  createSyntheticActivityDirectory
} from "../src/activity.mjs";
import {
  checkedRequest,
  customerHeaders,
  startTestServer,
  stopServer,
  SUBJECT,
  validator,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const ACTIVITY = "/api/v1/customer/activity";
const ACTIVITY_ID = /^act_[0-9a-f]{24}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const MONEY_KINDS = new Set(["deposit", "withdrawal", "quote", "order", "payment", "card", "check"]);
const REF = /dep_|wdr_|qte_|ord_|pay_|crd_|chk_|kyv_|ses_/u;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic activity directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticActivityDirectory();
  const first = await directory.viewFor(VERIFIED_SUBJECT);
  const second = await directory.viewFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.activity));
  for (const item of first.activity) {
    assert.ok(Object.isFrozen(item));
    assert.ok(item.money === null || Object.isFrozen(item.money));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.activity.length >= 1 && first.activity.length <= 9);
  const other = await directory.viewFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const subject of [VERIFIED_SUBJECT, SUBJECT]) {
    const view = await directory.viewFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/ActivityView" }, { ...view }), [], subject);
    for (const item of view.activity) {
      assert.match(item.activity_id, ACTIVITY_ID);
      assert.match(item.created_at, ISO_TIMESTAMP);
      assert.equal(item.posting, "none");
      assert.ok(item.title.length >= 1 && item.title.length <= 128);
      assert.ok(item.detail.length >= 1 && item.detail.length <= 256);
      // The feed references existing domain identifiers only: every money
      // kind detail carries the domain ref prefix of its kind and never a
      // claim secret or posting identifier.
      if (MONEY_KINDS.has(item.kind)) {
        assert.match(item.detail, REF, `${item.kind}: ${item.detail}`);
        const scale = ACTIVITY_ASSETS[item.money.asset];
        assert.ok(scale !== undefined, item.money.asset);
        const decimal = new RegExp(`^(0|[1-9][0-9]*)\\.[0-9]{${scale}}$`, "u");
        assert.match(item.money.amount, decimal);
        assert.ok(BigInt(item.money.amount.replace(".", "")) > 0n);
      } else {
        assert.equal(item.money, null);
      }
    }
  }
});

test("GET /api/v1/customer/activity serves verified customers a deterministic feed", async () => {
  await withServer({}, async (port) => {
    const response = await checkedRequest(port, { path: ACTIVITY, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    const view = JSON.parse(response.body);
    assert.equal(view.mode, "test");
    assert.ok(view.activity.length >= 1);
    const repeat = await checkedRequest(port, { path: ACTIVITY, headers: verifiedCustomerHeaders() });
    assert.equal(repeat.body, response.body);
  });
});

test("GET /api/v1/customer/activity gates unverified and anonymous callers", async () => {
  await withServer({}, async (port) => {
    const anonymous = await checkedRequest(port, {
      path: ACTIVITY,
      headers: customerHeaders({ Authorization: null })
    });
    assert.equal(anonymous.status, 401);
    assert.equal(JSON.parse(anonymous.body).code, "AUTHENTICATION_REQUIRED");
    const denied = await checkedRequest(port, { path: ACTIVITY, headers: customerHeaders() });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
  });
});

test("GET /api/v1/customer/activity fails closed when the directory throws or misbehaves", async () => {
  await withServer(
    {
      activityDirectory: {
        async viewFor() {
          throw new Error("activity store exploded: secret=abc");
        }
      }
    },
    async (port) => {
      const response = await checkedRequest(port, { path: ACTIVITY, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      assert.doesNotMatch(response.body, /secret|exploded/u);
    }
  );
  await withServer(
    {
      activityDirectory: {
        async viewFor() {
          return { mode: "live", activity: [] };
        }
      }
    },
    async (port) => {
      const response = await checkedRequest(port, { path: ACTIVITY, headers: verifiedCustomerHeaders() });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    }
  );
});
