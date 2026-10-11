import assert from "node:assert/strict";
import test from "node:test";

import { createDenyAllVerifier } from "../src/auth.mjs";
import { evaluateOperatorCapabilities } from "../src/capabilities.mjs";
import {
  createSyntheticOperatorDirectory,
  OPERATOR_ROLES,
  operatorCapabilitiesViewFor,
  operatorSessionViewFor,
  validOperatorAdminView,
  validOperatorCapabilitiesView,
  validOperatorSessionView
} from "../src/operator.mjs";
import {
  customerHeaders,
  DEVICE_ID,
  header,
  OPERATOR_SUBJECT,
  operatorHeaders,
  operatorToken,
  request,
  REQUEST_ID,
  startTestServer,
  stopServer,
  SUBJECT,
  token,
  validator
} from "./http-client.mjs";

const ADMIN = "/api/v1/operator/admin";
const OPERATOR_SESSION = "/api/v1/operator/session";
const OPERATOR_CAPABILITIES = "/api/v1/operator/capabilities";
const SESSION = "/api/v1/customer/session";
const GRANTED = ["operator.session.read", "operator.capabilities.read", "operator.admin.read"];

async function withServer(options, run) {
  const { server, port } = await startTestServer(options);
  try {
    await run(port);
  } finally {
    await stopServer(server);
  }
}

function adminView(overrides = {}) {
  return {
    mode: "test",
    operator_id: "opr_0123456789abcdef01234567",
    subject: OPERATOR_SUBJECT,
    role: "auditor",
    granted_capabilities: [...GRANTED],
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides
  };
}

test("operator capabilities grant exactly the operator read tier", () => {
  const evaluation = evaluateOperatorCapabilities();
  assert.deepEqual([...evaluation.granted], GRANTED);
  assert.deepEqual(evaluation.denied, []);
  assert.equal(evaluation.commandsEnabled, false);
});

test("GET /api/v1/operator/admin returns the deterministic synthetic view", async () => {
  await withServer({}, async (port) => {
    const served = await request(port, { path: ADMIN, headers: operatorHeaders() });
    assert.equal(served.status, 200);
    const expected = await createSyntheticOperatorDirectory().viewFor(OPERATOR_SUBJECT, GRANTED);
    assert.deepEqual(JSON.parse(served.body), { ...expected });
    assert.equal(header(served, "x-request-id"), REQUEST_ID);
  });
});

test("an operator token authenticates only operator paths; a customer token never does", async () => {
  await withServer({}, async (port) => {
    const customerOnOperator = await request(port, {
      path: ADMIN,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customerOnOperator.status, 401);
    assert.equal(JSON.parse(customerOnOperator.body).code, "AUTHENTICATION_REQUIRED");
    assert.equal(header(customerOnOperator, "www-authenticate"), "Bearer");
    const operatorOnCustomer = await request(port, {
      path: SESSION,
      headers: [
        ["Authorization", `Bearer ${operatorToken()}`],
        ["X-Request-Id", REQUEST_ID],
        ["X-Client-Version", "1.0.0"],
        ["X-Platform", "operator-web"]
      ]
    });
    assert.equal(operatorOnCustomer.status, 401);
    assert.equal(JSON.parse(operatorOnCustomer.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("cross-family tokens fail closed: prefix, subject and signature domain are pinned together", async () => {
  await withServer({}, async (port) => {
    // A scdev1.* token with an operator subject is still a customer-family
    // token: the verifier never mints an operator principal from it.
    const forged = await request(port, {
      path: ADMIN,
      headers: [
        ["Authorization", `Bearer ${token({ subject: SUBJECT }).replace("syn_cust_", "syn_oper_")}`],
        ["X-Request-Id", REQUEST_ID],
        ["X-Client-Version", "1.0.0"],
        ["X-Platform", "operator-web"],
        ["X-Device-Id", DEVICE_ID]
      ]
    });
    assert.equal(forged.status, 401);
    // A customer-family token on the operator path never authenticates, even
    // though it verifies: the audience is bound to the namespace.
    const customer = await request(port, {
      path: ADMIN,
      headers: operatorHeaders({ Authorization: `Bearer ${token()}` })
    });
    assert.equal(customer.status, 401);
  });
});

test("X-Device-Id is required and validated on the operator path", async () => {
  await withServer({}, async (port) => {
    for (const [label, headers] of [
      ["missing", operatorHeaders({ "X-Device-Id": null })],
      ["empty", operatorHeaders({ "X-Device-Id": "" })],
      ["uppercase", operatorHeaders({ "X-Device-Id": DEVICE_ID.toUpperCase() })],
      ["uuidv7", operatorHeaders({ "X-Device-Id": REQUEST_ID })],
      ["not a uuid", operatorHeaders({ "X-Device-Id": "workstation-1" })]
    ]) {
      const response = await request(port, { path: ADMIN, headers });
      assert.equal(response.status, 400, label);
      assert.equal(JSON.parse(response.body).code, "VALIDATION_FAILED");
      assert.match(JSON.parse(response.body).message, /X-Device-Id/u);
    }
    const duplicated = await request(port, {
      path: ADMIN,
      headers: [...operatorHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(duplicated.status, 400);
    assert.equal(JSON.parse(duplicated.body).code, "VALIDATION_FAILED");
    // The device identifier is checked before request-id and authentication:
    // an unauthenticated request without it still answers 400.
    const bare = await request(port, { path: ADMIN });
    assert.equal(bare.status, 400);
    assert.equal(JSON.parse(bare.body).code, "VALIDATION_FAILED");
  });
});

test("the deny-all verifier rejects operator tokens with 401", async () => {
  await withServer({ verifier: createDenyAllVerifier() }, async (port) => {
    const response = await request(port, { path: ADMIN, headers: operatorHeaders() });
    assert.equal(response.status, 401);
    assert.equal(JSON.parse(response.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("the operator read never consults customer KYC state", async () => {
  await withServer(
    {
      kycDirectory: {
        async statusFor() {
          throw new Error("kyc provider down");
        }
      }
    },
    async (port) => {
      const response = await request(port, { path: ADMIN, headers: operatorHeaders() });
      assert.equal(response.status, 200);
    }
  );
});

test("a malformed operator view fails closed", async () => {
  const missingCapabilities = adminView();
  delete missingCapabilities.granted_capabilities;
  const malformed = [
    adminView({ mode: "live" }),
    adminView({ operator_id: "opr_!234" }),
    adminView({ subject: SUBJECT }),
    adminView({ role: "superadmin" }),
    adminView({ granted_capabilities: ["operator.admin.read", "operator.admin.read"] }),
    adminView({ granted_capabilities: "operator.admin.read" }),
    adminView({ granted_capabilities: [""] }),
    adminView({ created_at: "yesterday" }),
    adminView({ created_at: "2026-09-02T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" }),
    { ...adminView(), session_secret: "abc" },
    missingCapabilities,
    null,
    "view"
  ];
  for (const view of malformed) {
    assert.equal(validOperatorAdminView(view), false, JSON.stringify(view));
    await withServer(
      { operatorDirectory: { async viewFor() { return view; } } },
      async (port) => {
        const response = await request(port, { path: ADMIN, headers: operatorHeaders() });
        assert.equal(response.status, 500, JSON.stringify(view));
        assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      }
    );
  }
});

test("the synthetic view stays deterministic, frozen and within the contract shape", async () => {
  const directory = createSyntheticOperatorDirectory();
  const first = await directory.viewFor(OPERATOR_SUBJECT, GRANTED);
  const second = await directory.viewFor(OPERATOR_SUBJECT, GRANTED);
  assert.equal(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.granted_capabilities));
  assert.equal(first.mode, "test");
  assert.match(first.operator_id, /^opr_[0-9a-f]{24}$/u);
  assert.equal(first.subject, OPERATOR_SUBJECT);
  assert.ok(OPERATOR_ROLES.includes(first.role));
  assert.deepEqual([...first.granted_capabilities], GRANTED);
  assert.ok(Date.parse(first.updated_at) >= Date.parse(first.created_at));
  assert.equal(validOperatorAdminView(first), true);
  // Other subjects derive other deterministic views.
  const other = await directory.viewFor("syn_oper_00000002", GRANTED);
  assert.notEqual(other.operator_id, first.operator_id);
  // The view answers the pinned contract schema exactly.
  assert.deepEqual(
    validator.validate(
      validator.resolve("#/components/schemas/OperatorAdminView"),
      { ...first, granted_capabilities: [...first.granted_capabilities] }
    ),
    []
  );
});

const PRINCIPAL = {
  subject: OPERATOR_SUBJECT,
  actorType: "operator",
  scopes: ["operator.session.read", "operator.capabilities.read"],
  expiresAt: "2026-10-01T12:15:00.000Z"
};

function sessionView(overrides = {}) {
  return {
    subject: OPERATOR_SUBJECT,
    actor_type: "operator",
    scopes: [...PRINCIPAL.scopes],
    expires_at: PRINCIPAL.expiresAt,
    device_bound: true,
    ...overrides
  };
}

function capabilitiesView(overrides = {}) {
  return {
    capabilities: [...GRANTED],
    commands_enabled: false,
    ...overrides
  };
}

test("operatorSessionViewFor projects the principal into the contract shape, frozen", () => {
  const view = operatorSessionViewFor(PRINCIPAL);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.scopes));
  assert.deepEqual({ ...view, scopes: [...view.scopes] }, sessionView());
  assert.equal(validOperatorSessionView(view), true);
  // The view answers the pinned contract schema exactly.
  assert.deepEqual(
    validator.validate(
      validator.resolve("#/components/schemas/OperatorSessionView"),
      { ...view, scopes: [...view.scopes] }
    ),
    []
  );
});

test("a malformed operator session view fails closed", async () => {
  const missingScopes = sessionView();
  delete missingScopes.scopes;
  const missingDeviceFlag = sessionView();
  delete missingDeviceFlag.device_bound;
  const malformed = [
    sessionView({ subject: SUBJECT }),
    sessionView({ subject: "syn_oper_UPPER" }),
    sessionView({ subject: "syn_oper_short" }),
    sessionView({ actor_type: "customer" }),
    sessionView({ scopes: "operator.session.read" }),
    sessionView({ scopes: ["operator.session.read", "operator.session.read"] }),
    sessionView({ scopes: [""] }),
    sessionView({ scopes: ["x".repeat(129)] }),
    sessionView({ expires_at: "tomorrow" }),
    sessionView({ expires_at: "2026-10-01 12:15:00" }),
    sessionView({ device_bound: false }),
    sessionView({ device_bound: "true" }),
    { ...sessionView(), refresh_token: "abc" },
    missingScopes,
    missingDeviceFlag,
    null,
    "view"
  ];
  for (const view of malformed) {
    assert.equal(validOperatorSessionView(view), false, JSON.stringify(view));
  }
  // The served view fails closed through the handler too: a principal that
  // never matches the token grammar produces the client-safe 500 envelope.
  await withServer(
    {
      verifier: {
        async verify() {
          return { subject: "syn_operator_1", actorType: "operator", scopes: [], expiresAt: "2026-10-01T13:00:00.000Z" };
        }
      }
    },
    async (port) => {
      const response = await request(port, { path: OPERATOR_SESSION, headers: operatorHeaders() });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    }
  );
});

test("operatorCapabilitiesViewFor projects the policy evaluation, frozen", () => {
  const evaluation = evaluateOperatorCapabilities();
  const view = operatorCapabilitiesViewFor(evaluation);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.capabilities));
  assert.deepEqual({ ...view, capabilities: [...view.capabilities] }, capabilitiesView());
  assert.equal(validOperatorCapabilitiesView(view), true);
  assert.deepEqual(
    validator.validate(
      validator.resolve("#/components/schemas/CapabilitiesView"),
      { ...view, capabilities: [...view.capabilities] }
    ),
    []
  );
});

test("a malformed operator capabilities view fails closed", () => {
  const missingCommands = capabilitiesView();
  delete missingCommands.commands_enabled;
  const malformed = [
    capabilitiesView({ capabilities: "operator.admin.read" }),
    capabilitiesView({ capabilities: ["operator.admin.read", "operator.admin.read"] }),
    capabilitiesView({ capabilities: [""] }),
    capabilitiesView({ capabilities: ["x".repeat(129)] }),
    capabilitiesView({ commands_enabled: true }),
    capabilitiesView({ commands_enabled: "false" }),
    { ...capabilitiesView(), denied: [] },
    missingCommands,
    null,
    "view"
  ];
  for (const view of malformed) {
    assert.equal(validOperatorCapabilitiesView(view), false, JSON.stringify(view));
  }
});

test("the operator meta pair serves the session and capability views for a synthetic operator token", async () => {
  await withServer({}, async (port) => {
    const session = await request(port, { path: OPERATOR_SESSION, headers: operatorHeaders() });
    assert.equal(session.status, 200);
    assert.deepEqual(JSON.parse(session.body), sessionView({ expires_at: JSON.parse(session.body).expires_at }));
    assert.equal(header(session, "x-request-id"), REQUEST_ID);

    const capabilities = await request(port, { path: OPERATOR_CAPABILITIES, headers: operatorHeaders() });
    assert.equal(capabilities.status, 200);
    assert.deepEqual(JSON.parse(capabilities.body), capabilitiesView());
    assert.equal(header(capabilities, "x-request-id"), REQUEST_ID);

    // A deny-all principal fails closed on both reads.
    const denied = await request(port, { path: OPERATOR_SESSION, headers: customerHeaders({ "X-Device-Id": DEVICE_ID }) });
    assert.equal(denied.status, 401);
  });
});
