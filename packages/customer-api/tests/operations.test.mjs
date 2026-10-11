import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyntheticOperationDirectory,
  OPERATION_ASSETS,
  OPERATION_KINDS,
  OPERATION_STATUSES
} from "../src/operations.mjs";
import {
  checkedRequest,
  customerHeaders,
  operationIdFor,
  startTestServer,
  stopServer,
  SUBJECT,
  validator,
  VERIFIED_SUBJECT,
  verifiedCustomerHeaders
} from "./http-client.mjs";

const OPERATIONS_LIST = "/api/v1/customer/operations";
const OPERATION_ID = /^ope_[0-9a-f]{24}$/u;
const REFERENCE = /^SCX-[0-9]{5,10}$/u;
const ISO_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const OPERATION_DETAIL = `/api/v1/customer/operations/${await operationIdFor()}`;

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

test("synthetic operation directory returns deterministic frozen views per subject", async () => {
  const directory = createSyntheticOperationDirectory();
  const first = await directory.viewFor(VERIFIED_SUBJECT);
  const second = await directory.viewFor(VERIFIED_SUBJECT);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.operations));
  for (const item of first.operations) {
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.legs) && Object.isFrozen(item.timeline));
    assert.ok(item.exchange === null || Object.isFrozen(item.exchange));
  }
  assert.equal(first.mode, "test");
  assert.ok(first.operations.length >= 1 && first.operations.length <= OPERATION_KINDS.length);
  const other = await directory.viewFor(SUBJECT);
  assert.notDeepEqual(other, first);
  for (const subject of [VERIFIED_SUBJECT, SUBJECT]) {
    const view = await directory.viewFor(subject);
    assert.deepEqual(validator.validate({ $ref: "#/components/schemas/OperationsView" }, { ...view }), [], subject);
    const seen = new Set();
    let previous = Number.POSITIVE_INFINITY;
    for (const item of view.operations) {
      assert.match(item.operation_id, OPERATION_ID);
      assert.match(item.reference, REFERENCE);
      assert.match(item.created_at, ISO_TIMESTAMP);
      assert.equal(item.posting, "none");
      assert.ok(OPERATION_KINDS.includes(item.kind));
      // The status vocabulary is borrowed from the domain lifecycle the
      // kind projects — never re-declared — so every minted status must be
      // a member of its kind's domain status set.
      assert.ok(OPERATION_STATUSES[item.kind].includes(item.status), `${item.kind}:${item.status}`);
      assert.ok(!seen.has(item.operation_id));
      seen.add(item.operation_id);
      const at = Date.parse(item.created_at);
      assert.ok(at < previous, "operations stay newest-first");
      previous = at;
      assert.ok(item.legs.every((leg) => Object.hasOwn(OPERATION_ASSETS, leg.asset)));
      if (item.kind === "exchange") {
        assert.equal(item.legs.length, 2);
        assert.ok(item.exchange !== null && item.exchange.base_asset !== item.exchange.quote_asset);
      } else {
        assert.equal(item.legs.length, 1);
        assert.equal(item.exchange, null);
      }
      // The feed is a derived-only ledger projection: no field ever carries
      // posting state or a claim/secret bearer value.
      assert.equal(item.posting, "none");
    }
  }
});

test("operationFor fails closed for ids the subject does not own", async () => {
  const directory = createSyntheticOperationDirectory();
  const view = await directory.viewFor(VERIFIED_SUBJECT);
  for (const item of view.operations) {
    const found = await directory.operationFor(VERIFIED_SUBJECT, item.operation_id);
    assert.deepEqual(found, item);
  }
  // A well-formed but never-minted id, another subject's id and a malformed
  // id all fail closed to null (the router maps null to the pinned 404).
  assert.equal(await directory.operationFor(VERIFIED_SUBJECT, "ope_000000000000000000000000"), null);
  for (const item of await directory.viewFor(SUBJECT).then((view) => view.operations)) {
    assert.equal(await directory.operationFor(VERIFIED_SUBJECT, item.operation_id), null);
  }
  assert.equal(await directory.operationFor(VERIFIED_SUBJECT, "not-an-operation"), null);
});

test("GET /api/v1/customer/operations serves the contract view to verified customers", async () => {
  await withServer({}, async (port) => {
    const response = await checkedRequest(port, { path: OPERATIONS_LIST, headers: verifiedCustomerHeaders() });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.mode, "test");
    assert.ok(Array.isArray(body.operations) && body.operations.length >= 1);
    for (const item of body.operations) {
      assert.match(item.operation_id, OPERATION_ID);
      assert.equal(item.posting, "none");
      assert.ok(OPERATION_STATUSES[item.kind].includes(item.status));
    }
    // The gated surface never serves the collection.
    const denied = await checkedRequest(port, { path: OPERATIONS_LIST, headers: customerHeaders() });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.body).code, "CAPABILITY_DENIED");
  });
});

test("GET /api/v1/customer/operations/{operationId} serves, gates and fails closed on 404", async () => {
  await withServer({}, async (port) => {
    const detail = await checkedRequest(port, { path: OPERATION_DETAIL, headers: verifiedCustomerHeaders() });
    assert.equal(detail.status, 200);
    const body = JSON.parse(detail.body);
    assert.equal(body.operation_id, OPERATION_DETAIL.split("/").at(-1));
    assert.equal(body.posting, "none");
    assert.ok(body.legs.length >= 1 && body.timeline.length >= 1);
    // Unverified subjects are gated on the member read too.
    const denied = await checkedRequest(port, { path: OPERATION_DETAIL, headers: customerHeaders() });
    assert.equal(denied.status, 403);
    // Absent and foreign ids fail closed as the pinned 404 envelope.
    for (const path of [
      "/api/v1/customer/operations/ope_000000000000000000000000",
      `/api/v1/customer/operations/${await operationIdFor(SUBJECT)}`
    ]) {
      const missing = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(missing.status, 404);
      assert.equal(JSON.parse(missing.body).code, "CAPABILITY_DENIED");
    }
    // Malformed ids never route to the operation at all.
    for (const path of [
      "/api/v1/customer/operations/not-an-id",
      "/api/v1/customer/operations/ope_",
      "/api/v1/customer/operations/ope_X00000000000000000000000"
    ]) {
      const missing = await checkedRequest(port, { path, headers: verifiedCustomerHeaders() });
      assert.equal(missing.status, 404);
    }
  });
});

test("operation directory views are subject-scoped and replay identically", async () => {
  const directory = createSyntheticOperationDirectory();
  const first = await directory.viewFor(VERIFIED_SUBJECT);
  const again = await directory.viewFor(VERIFIED_SUBJECT);
  assert.deepEqual({ ...first }, { ...again });
  const ids = new Set(first.operations.map((item) => item.operation_id));
  for (const item of (await directory.viewFor(SUBJECT)).operations) {
    assert.ok(!ids.has(item.operation_id), "ids never collide across subjects");
  }
});
