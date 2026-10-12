import assert from "node:assert/strict";
import test from "node:test";

import { createDenyAllVerifier } from "../src/auth.mjs";
import { evaluateOperatorCapabilities } from "../src/capabilities.mjs";
import {
  createSyntheticOperatorDirectory,
  createSyntheticOperatorSubjectsDirectory,
  OPERATOR_ACTIVITY_KINDS,
  OPERATOR_QUEUE_KINDS,
  OPERATOR_ROLES,
  OPERATOR_TICKET_QUEUE_STATES,
  operatorCapabilitiesViewFor,
  operatorRoleFor,
  operatorSessionViewFor,
  validOperatorAdminView,
  validOperatorCapabilitiesView,
  validOperatorAuditView,
  validOperatorQueueItemDetail,
  validOperatorQueueView,
  validOperatorSessionView,
  validOperatorSubjectDetailView,
  validOperatorSubjectKyc,
  validOperatorSubjectsView
} from "../src/operator.mjs";
import { syntheticSupportTickets, TICKET_CATEGORIES } from "../src/support.mjs";
import {
  auditOperatorHeaders,
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
const OPERATOR_SUBJECTS = "/api/v1/operator/subjects";
const OPERATOR_QUEUE = "/api/v1/operator/queue";
const SESSION = "/api/v1/customer/session";
const GRANTED = ["operator.session.read", "operator.capabilities.read", "operator.admin.read", "operator.subjects.read", "operator.queue.read"];

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
  // The roleless evaluation projects the whole vocabulary — the audit read
  // included — so the contract's capability vocabulary stays complete.
  const vocabulary = evaluateOperatorCapabilities();
  assert.deepEqual([...vocabulary.granted], [...GRANTED, "operator.audit.read"]);
  assert.deepEqual(vocabulary.denied, []);
  assert.equal(vocabulary.commandsEnabled, false);
  // The route-scoped evaluation applies the audit role gate: the oversight
  // roles keep the audit read, every other operator role loses exactly it.
  for (const role of ["auditor", "compliance-lead"]) {
    const evaluation = evaluateOperatorCapabilities({ role });
    assert.deepEqual([...evaluation.granted], [...GRANTED, "operator.audit.read"], role);
    assert.deepEqual(evaluation.denied, [], role);
  }
  for (const role of ["support-l1", "aml-investigator", "fraud-investigator"]) {
    const evaluation = evaluateOperatorCapabilities({ role });
    assert.deepEqual([...evaluation.granted], GRANTED, role);
    assert.deepEqual(
      evaluation.denied.map((item) => [item.capability, [...item.reasons]]),
      [["operator.audit.read", ["OPERATOR_ROLE_RESTRICTED"]]],
      role
    );
  }
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
      for (const path of [ADMIN, OPERATOR_SUBJECTS]) {
        const response = await request(port, { path, headers: operatorHeaders() });
        assert.equal(response.status, 200, path);
      }
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
  assert.deepEqual(first, second);
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
  const evaluation = evaluateOperatorCapabilities({ role: operatorRoleFor(OPERATOR_SUBJECT) });
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

function subjectRow(overrides = {}) {
  return {
    subject_id: "syn_cust_00112233445566778899aabb",
    display_name: "Alina Mironova",
    kyc_status: "verified",
    flags: 2,
    registered_at: "2026-09-05T00:00:00.000Z",
    last_active_at: "2026-09-25T00:00:00.000Z",
    posting: "none",
    ...overrides
  };
}

function subjectsView(overrides = {}) {
  return {
    mode: "test",
    subjects: [subjectRow()],
    ...overrides
  };
}

test("GET /api/v1/operator/subjects returns the deterministic shared directory view", async () => {
  await withServer({}, async (port) => {
    const served = await request(port, { path: OPERATOR_SUBJECTS, headers: operatorHeaders() });
    assert.equal(served.status, 200);
    const expected = await createSyntheticOperatorSubjectsDirectory().subjectsFor();
    assert.deepEqual(JSON.parse(served.body), { mode: "test", subjects: expected.subjects.map((row) => ({ ...row })) });
    assert.equal(header(served, "x-request-id"), REQUEST_ID);
    // Every operator sees the same directory: the universe is shared, not
    // derived per caller.
    const other = await request(port, {
      path: OPERATOR_SUBJECTS,
      headers: operatorHeaders({ Authorization: `Bearer ${operatorToken({ subject: "syn_oper_00000002" })}` })
    });
    assert.deepEqual(JSON.parse(other.body), JSON.parse(served.body));
  });
});

test("the synthetic subjects view stays deterministic, frozen and within the contract shape", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const first = await directory.subjectsFor();
  const second = await directory.subjectsFor();
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.subjects));
  assert.ok(first.subjects.every((row) => Object.isFrozen(row)));
  assert.equal(first.mode, "test");
  assert.equal(validOperatorSubjectsView(first), true);
  // The view answers the pinned contract schema exactly.
  assert.deepEqual(
    validator.validate(
      validator.resolve("#/components/schemas/OperatorSubjectsView"),
      { ...first, subjects: first.subjects.map((row) => ({ ...row })) }
    ),
    []
  );
});

test("a malformed operator subjects view fails closed", async () => {
  const missingSubjects = subjectsView();
  delete missingSubjects.subjects;
  const row = (overrides = {}) => subjectRow(overrides);
  const malformed = [
    subjectsView({ mode: "live" }),
    subjectsView({ subjects: [] }),
    subjectsView({ subjects: Array.from({ length: 65 }, (_value, index) => row({ subject_id: `syn_cust_${String(index).padStart(24, "0")}` })) }),
    subjectsView({ subjects: [row(), row()] }),
    subjectsView({ subjects: [row({ subject_id: "sub_0001" })] }),
    subjectsView({ subjects: [row({ subject_id: "syn_oper_00000001" })] }),
    subjectsView({ subjects: [row({ display_name: "alina mironova" })] }),
    subjectsView({ subjects: [row({ display_name: "A1ina Mironova" })] }),
    subjectsView({ subjects: [row({ kyc_status: "approved" })] }),
    subjectsView({ subjects: [row({ flags: -1 })] }),
    subjectsView({ subjects: [row({ flags: 1.5 })] }),
    subjectsView({ subjects: [row({ flags: "2" })] }),
    subjectsView({ subjects: [row({ registered_at: "yesterday" })] }),
    subjectsView({ subjects: [row({ registered_at: "2026-09-10T00:00:00.000Z", last_active_at: "2026-09-05T00:00:00.000Z" })] }),
    subjectsView({ subjects: [row({ posting: "pending" })] }),
    subjectsView({ subjects: [{ ...row(), wallet_address: "0xabc" }] }),
    subjectsView({ subjects: [row(), null] }),
    missingSubjects,
    null,
    "view"
  ];
  for (const view of malformed) {
    assert.equal(validOperatorSubjectsView(view), false, JSON.stringify(view));
    await withServer(
      { operatorSubjectsDirectory: { async subjectsFor() { return view; }, async subjectFor() { return null; }, async queueFor() { return createSyntheticOperatorSubjectsDirectory().queueFor(); }, async queueItemFor() { return null; } } },
      async (port) => {
        const response = await request(port, { path: OPERATOR_SUBJECTS, headers: operatorHeaders() });
        assert.equal(response.status, 500, JSON.stringify(view));
        assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      }
    );
  }
});

const KNOWN_SUBJECT_ID_PATH = async () =>
  `${OPERATOR_SUBJECTS}/${(await createSyntheticOperatorSubjectsDirectory().subjectsFor()).subjects[0].subject_id}`;

test("GET /api/v1/operator/subjects/{subjectId} returns the deterministic shared detail", async () => {
  await withServer({}, async (port) => {
    const path = await KNOWN_SUBJECT_ID_PATH();
    const served = await request(port, { path, headers: operatorHeaders() });
    assert.equal(served.status, 200);
    const expected = await createSyntheticOperatorSubjectsDirectory().subjectFor(path.split("/").at(-1));
    assert.deepEqual(JSON.parse(served.body), { mode: "test", subject: { ...expected.subject, devices: [...expected.subject.devices], limits: { ...expected.subject.limits } } });
    assert.equal(header(served, "x-request-id"), REQUEST_ID);
    // Every operator sees the same detail: the universe is shared, not
    // derived per caller.
    const other = await request(port, {
      path,
      headers: operatorHeaders({ Authorization: `Bearer ${operatorToken({ subject: "syn_oper_00000002" })}` })
    });
    assert.deepEqual(JSON.parse(other.body), JSON.parse(served.body));
    // A customer-family token on the member path never authenticates.
    const customer = await request(port, {
      path,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("the synthetic subject detail stays deterministic, frozen and within the contract shape", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const subjectId = (await directory.subjectsFor()).subjects[0].subject_id;
  const first = await directory.subjectFor(subjectId);
  const second = await directory.subjectFor(subjectId);
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.subject));
  assert.ok(Object.isFrozen(first.subject.devices));
  assert.ok(Object.isFrozen(first.subject.limits));
  assert.equal(first.mode, "test");
  assert.equal(validOperatorSubjectDetailView(first), true);
  // The view answers the pinned contract schema exactly.
  assert.deepEqual(
    validator.validate(
      validator.resolve("#/components/schemas/OperatorSubjectDetailView"),
      { mode: "test", subject: { ...first.subject, devices: [...first.subject.devices], limits: { ...first.subject.limits } } }
    ),
    []
  );
  // The detail extends the list row verbatim for the same id — the member
  // read can never disagree with the collection.
  const row = (await directory.subjectsFor()).subjects[0];
  for (const key of ["subject_id", "display_name", "kyc_status", "flags", "registered_at", "last_active_at", "posting"]) {
    assert.deepEqual(first.subject[key], row[key], key);
  }
  // The recent_activity page is frozen, newest-first and bounded like the
  // operator page size.
  const activity = first.subject.recent_activity;
  assert.ok(Object.isFrozen(activity));
  assert.ok(activity.length >= 1 && activity.length <= 8);
  for (const item of activity) {
    assert.ok(Object.isFrozen(item));
    assert.ok(OPERATOR_ACTIVITY_KINDS.includes(item.kind), item.kind);
  }
  for (let index = 1; index < activity.length; index += 1) {
    const prev = activity[index - 1];
    const next = activity[index];
    assert.ok(
      next.occurred_at < prev.occurred_at || (next.occurred_at === prev.occurred_at && next.activity_id > prev.activity_id),
      `ordering at ${index}`
    );
  }
  // An id outside the shared universe resolves to null — the route maps it
  // onto the pinned uniform 404.
  assert.equal(await directory.subjectFor(`syn_cust_${"f".repeat(24)}`), null);
  assert.equal(await directory.subjectFor("syn_oper_00000001"), null);
  assert.equal(await directory.subjectFor(""), null);
});

test("the recent_activity projection cross-checks the roster recipe", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const view = await directory.subjectsFor();
  const details = await Promise.all(view.subjects.map((row) => directory.subjectFor(row.subject_id)));
  // Operator-side events exist exactly when the roster projects them.
  assert.ok(details.some((detail) => detail.subject.recent_activity.some((item) => item.kind === "kyc_transition")));
  assert.ok(details.some((detail) => detail.subject.recent_activity.some((item) => item.kind === "flag_added")));
  for (const detail of details) {
    const subject = detail.subject;
    // Every roster detail validates — a rejected view would 500 the route.
    assert.equal(validOperatorSubjectDetailView(detail), true, subject.subject_id);
    const transitions = subject.recent_activity.filter((item) => item.kind === "kyc_transition");
    const flagEvents = subject.recent_activity.filter((item) => item.kind === "flag_added");
    // The newest-first page drops the oldest events once full, so projected
    // operator events are a subset of the roster recipe, never an invention.
    if (subject.kyc_status === "unverified") {
      assert.equal(transitions.length, 0, subject.subject_id);
    } else if (subject.kyc_status === "pending") {
      for (const item of transitions) assert.equal(item.summary, "submitted", subject.subject_id);
    } else {
      for (const item of transitions) assert.ok(item.summary === "submitted" || item.summary === "approved", subject.subject_id);
    }
    assert.ok(flagEvents.length <= subject.flags, subject.subject_id);
    // The merged page keeps the customer items verbatim: kind/status/created
    // map onto kind/summary/occurred_at and the money pair passes through.
    for (const item of subject.recent_activity) {
      if (item.activity_id.startsWith("act_")) {
        assert.ok(item.kind !== "kyc_transition" && item.kind !== "flag_added");
      } else {
        assert.ok(item.activity_id.startsWith("opact_"));
        assert.equal(item.money, null);
      }
    }
  }
});

test("the kyc dossier stays coherent with the roster recipe across the all-states matrix", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const view = await directory.subjectsFor();
  // The dossier is detail-only: list rows never carry the kyc key.
  for (const row of view.subjects) {
    assert.ok(!Object.hasOwn(row, "kyc"), row.subject_id);
  }
  const details = await Promise.all(view.subjects.map((row) => directory.subjectFor(row.subject_id)));
  const inReview = new Set(["submitted", "in_review"]);
  const endings = new Set(["rejected", "needs_more_data", "timed_out"]);
  const seen = new Set();
  for (const detail of details) {
    const subject = detail.subject;
    assert.equal(validOperatorSubjectDetailView(detail), true, subject.subject_id);
    const kyc = subject.kyc;
    seen.add(kyc === null ? "null" : kyc.status);
    if (kyc === null) {
      // A no-application draw is the only null: the roster stays unverified.
      assert.equal(subject.kyc_status, "unverified", subject.subject_id);
      continue;
    }
    assert.ok(Object.isFrozen(kyc));
    assert.ok(Object.isFrozen(kyc.history));
    assert.equal(validOperatorSubjectKyc(kyc), true, subject.subject_id);
    // The header echoes the newest attempt.
    assert.equal(kyc.session_id, kyc.history[0].session_id);
    assert.equal(kyc.status, kyc.history[0].state);
    assert.match(kyc.session_id, /^kys_[0-9a-f]{24}$/u);
    // The roster kyc_status bounds the current state.
    if (subject.kyc_status === "verified") assert.equal(kyc.status, "approved");
    else if (subject.kyc_status === "pending") assert.ok(inReview.has(kyc.status), subject.subject_id);
    else assert.ok(endings.has(kyc.status), subject.subject_id);
    // Attempts: newest-first, unique sessions, decision/reason coherence.
    let previousSubmittedAt = "";
    const ids = new Set();
    for (const [index, attempt] of kyc.history.entries()) {
      assert.ok(Object.isFrozen(attempt));
      assert.ok(!ids.has(attempt.session_id));
      ids.add(attempt.session_id);
      if (index > 0) {
        assert.ok(attempt.submitted_at <= previousSubmittedAt);
        assert.ok(endings.has(attempt.state), `${subject.subject_id} attempt ${index}`);
        assert.ok(attempt.decided_at !== null && attempt.decided_at <= kyc.history[index - 1].submitted_at);
      }
      previousSubmittedAt = attempt.submitted_at;
      if (inReview.has(attempt.state)) assert.equal(attempt.decided_at, null);
      else assert.ok(attempt.decided_at !== null && attempt.decided_at >= attempt.submitted_at);
      if (attempt.rejection_reason !== null) assert.equal(attempt.state, "rejected");
    }
    // The newest submission shares the instant the recent_activity
    // kyc_transition projects — whenever it survives the page bound.
    const submitted = subject.recent_activity.find(
      (item) => item.kind === "kyc_transition" && item.summary === "submitted"
    );
    if (submitted !== undefined) {
      assert.equal(kyc.history[0].submitted_at, submitted.occurred_at, subject.subject_id);
    }
    if (kyc.status === "approved") {
      const approved = subject.recent_activity.find(
        (item) => item.kind === "kyc_transition" && item.summary === "approved"
      );
      if (approved !== undefined) {
        assert.equal(kyc.history[0].decided_at, approved.occurred_at, subject.subject_id);
      }
    }
  }
  // The 24-member universe draws the whole matrix: absent, pending and
  // every terminal state.
  for (const state of ["null", "approved", "rejected", "needs_more_data", "timed_out"]) {
    assert.ok(seen.has(state), `matrix state ${state}`);
  }
  assert.ok(seen.has("submitted") || seen.has("in_review"), "in-review states");
});

test("a malformed kyc dossier fails the detail validator closed", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const view = await directory.subjectsFor();
  const details = await Promise.all(view.subjects.map((row) => directory.subjectFor(row.subject_id)));
  const real = details.find((detail) => detail.subject.kyc !== null && detail.subject.kyc.history.length >= 2);
  assert.ok(real !== undefined);
  const subject = real.subject;
  const kyc = subject.kyc;
  const other = details.find((detail) => detail.subject.kyc !== null && detail.subject.subject_id !== subject.subject_id);
  assert.ok(other !== undefined);
  const drifted = (subjectOverrides = {}) => ({ mode: "test", subject: { ...subject, ...subjectOverrides } });
  const attempt0 = kyc.history[0];
  const badKyc = [
    "dossier",
    [],
    {},
    { ...kyc, level: "premium" },
    { ...kyc, status: "unavailable" },
    { ...kyc, session_id: "kys_nothex" },
    { ...kyc, session_id: `kys_${"0".repeat(24)}` },
    { ...kyc, history: [] },
    { ...kyc, history: [...kyc.history].reverse() },
    { ...kyc, history: kyc.history.map((attempt) => ({ ...attempt, session_id: `kys_${"0".repeat(24)}` })) },
    { ...kyc, history: [attempt0, { ...kyc.history[1], decided_at: null }] },
    { ...kyc, history: [attempt0, { ...kyc.history[1], decided_at: "not-a-date" }] },
    { ...kyc, status: "approved", history: [{ ...attempt0, state: "approved", rejection_reason: "SIM_DATA_MISMATCH" }, ...kyc.history.slice(1)] },
    { ...kyc, history: [attempt0, { ...kyc.history[1], state: "in_review" }] },
    { ...kyc, history: [attempt0, { ...kyc.history[1], decided_at: "2027-01-01T00:00:00.000Z" }] },
    other.subject.kyc
  ];
  for (const value of badKyc) {
    assert.equal(validOperatorSubjectDetailView(drifted({ kyc: value })), false, JSON.stringify(value).slice(0, 96));
  }
  assert.equal(validOperatorSubjectKyc(kyc), true);
  assert.equal(validOperatorSubjectKyc(null), false);
  assert.equal(validOperatorSubjectKyc(other.subject.kyc), true);
  // Roster coherence: a verified roster row cannot carry an in-review dossier.
  const verified = details.find((detail) => detail.subject.kyc_status === "verified");
  assert.ok(verified !== undefined);
  const swapped = {
    ...verified.subject.kyc,
    status: "in_review",
    history: [{ ...verified.subject.kyc.history[0], state: "in_review", decided_at: null }]
  };
  assert.equal(validOperatorSubjectKyc(swapped), true);
  assert.equal(validOperatorSubjectDetailView({ mode: "test", subject: { ...verified.subject, kyc: swapped } }), false);
});

test("unknown or malformed subject ids fail closed with the uniform 404", async () => {
  await withServer({}, async (port) => {
    for (const id of [
      `syn_cust_${"f".repeat(24)}`,
      `syn_cust_${"0".repeat(24)}`,
      "syn_oper_00000001",
      "sub_0001",
      "unknownsubject"
    ]) {
      const response = await request(port, { path: `${OPERATOR_SUBJECTS}/${id}`, headers: operatorHeaders() });
      assert.equal(response.status, 404, id);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED");
    }
  });
});

test("a malformed operator subject detail fails closed", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const subjectId = (await directory.subjectsFor()).subjects[0].subject_id;
  const real = await directory.subjectFor(subjectId);
  const path = `${OPERATOR_SUBJECTS}/${subjectId}`;
  const detailView = (overrides = {}, subjectOverrides = {}) => ({
    mode: "test",
    subject: { ...real.subject, ...subjectOverrides },
    ...overrides
  });
  // Overrides must differ from the derived value or the case is not drift.
  const differentName = real.subject.display_name === "Roman Sokolov" ? "Vera Aliyev" : "Roman Sokolov";
  const differentStatus = real.subject.account_status === "closed" ? "restricted" : "closed";
  const missingSubject = detailView();
  delete missingSubject.subject;
  const malformed = [
    detailView({ mode: "live" }),
    detailView({}, { subject_id: `syn_cust_${"f".repeat(24)}` }),
    detailView({}, { subject_id: "sub_0001" }),
    detailView({}, { display_name: differentName }),
    detailView({}, { account_status: "suspended" }),
    detailView({}, { account_status: differentStatus }),
    detailView({}, { contact_hash: `cth_${"g".repeat(32)}` }),
    detailView({}, { contact_hash: "redacted@example.test" }),
    detailView({}, { sessions: -1 }),
    detailView({}, { sessions: real.subject.limits.max_sessions + 1 }),
    detailView({}, { devices: ["dev_0011223344556677", "dev_0011223344556677"] }),
    detailView({}, { devices: ["workstation-1"] }),
    detailView({}, { devices: [...real.subject.devices, "dev_8899aabbccddeeff", "dev_1122334455667788", "dev_2233445566778899", "dev_33445566778899aa", "dev_445566778899aabb", "dev_5566778899aabbcc", "dev_66778899aabbccdd", "dev_778899aabbccddee", "dev_889900aabbccddee"] }),
    detailView({}, { limits: { max_sessions: real.subject.limits.max_sessions } }),
    detailView({}, { limits: { ...real.subject.limits, max_devices: 0 } }),
    detailView({}, { limits: { max_sessions: real.subject.limits.max_sessions, max_devices: real.subject.limits.max_devices, daily_quota: 5 } }),
    detailView({}, { email: "a@b.test" }),
    detailView({}, { last_active_at: "2000-01-01T00:00:00.000Z" }),
    detailView({}, { posting: "pending" }),
    detailView({}, { recent_activity: [] }),
    detailView({}, { recent_activity: [...real.subject.recent_activity].reverse() }),
    detailView({}, { recent_activity: real.subject.recent_activity.map((item) => ({ ...item, summary: "approved" })) }),
    detailView({}, { recent_activity: real.subject.recent_activity.map((item) => ({ ...item, activity_id: `act_${"e".repeat(24)}` })) }),
    detailView({}, { recent_activity: [...real.subject.recent_activity, { ...real.subject.recent_activity[0], activity_id: `opact_${"9".repeat(24)}` }] }),
    missingSubject,
    "view"
  ];
  // A null return is the directory's own not-found signal (the route maps it
  // onto the 404), not drift — but the validator still rejects it as a view.
  assert.equal(validOperatorSubjectDetailView(null), false);
  for (const view of malformed) {
    assert.equal(validOperatorSubjectDetailView(view), false, JSON.stringify(view));
    await withServer(
      {
        operatorSubjectsDirectory: {
          async subjectsFor() { return createSyntheticOperatorSubjectsDirectory().subjectsFor(); },
          async subjectFor() { return view; },
          async queueFor() { return createSyntheticOperatorSubjectsDirectory().queueFor(); },
          async queueItemFor() { return null; }
        }
      },
      async (port) => {
        const response = await request(port, { path, headers: operatorHeaders() });
        assert.equal(response.status, 500, JSON.stringify(view));
        assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      }
    );
  }
});

function queueView(overrides = {}, queueOverrides = {}) {
  return {
    mode: "test",
    queue: {
      kind: "kyc",
      items: [],
      summary: { count: 0, by_state: { pending: 0, in_review: 0, escalated: 0 } },
      posting: "none",
      ...queueOverrides
    },
    ...overrides
  };
}

test("GET /api/v1/operator/queue returns the deterministic shared queue view", async () => {
  await withServer({}, async (port) => {
    const served = await request(port, { path: OPERATOR_QUEUE, headers: operatorHeaders() });
    assert.equal(served.status, 200);
    const expected = await createSyntheticOperatorSubjectsDirectory().queueFor();
    assert.deepEqual(JSON.parse(served.body), {
      mode: "test",
      queue: {
        kind: "kyc",
        items: expected.queue.items.map((item) => ({ ...item, assignee: item.assignee === null ? null : { ...item.assignee } })),
        summary: { count: expected.queue.summary.count, by_state: { ...expected.queue.summary.by_state } },
        posting: "none"
      }
    });
    assert.equal(header(served, "x-request-id"), REQUEST_ID);
    // Every operator sees the same queue: the projection is shared, not
    // derived per caller.
    const other = await request(port, {
      path: OPERATOR_QUEUE,
      headers: operatorHeaders({ Authorization: `Bearer ${operatorToken({ subject: "syn_oper_00000002" })}` })
    });
    assert.deepEqual(JSON.parse(other.body), JSON.parse(served.body));
    // A customer-family token on the queue path never authenticates.
    const customer = await request(port, {
      path: OPERATOR_QUEUE,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("GET /api/v1/operator/queue?kind=... projects every queue kind byte-faithfully", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  await withServer({}, async (port) => {
    // The default read and ?kind=kyc are byte-identical — the query is an
    // optional selector, not a new route.
    const implicit = await request(port, { path: OPERATOR_QUEUE, headers: operatorHeaders() });
    assert.equal(implicit.status, 200);
    const explicit = await request(port, { path: `${OPERATOR_QUEUE}?kind=kyc`, headers: operatorHeaders() });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.body, implicit.body);
    const bareQuery = await request(port, { path: `${OPERATOR_QUEUE}?`, headers: operatorHeaders() });
    assert.equal(bareQuery.status, 200);
    assert.equal(bareQuery.body, implicit.body);
    for (const kind of ["aml", "tickets"]) {
      const response = await request(port, {
        path: `${OPERATOR_QUEUE}?kind=${kind}`,
        headers: operatorHeaders()
      });
      assert.equal(response.status, 200, kind);
      const expected = await directory.queueFor(kind);
      assert.deepEqual(JSON.parse(response.body), {
        mode: "test",
        queue: {
          kind,
          items: expected.queue.items.map((item) => ({
            ...item,
            assignee: item.assignee === null ? null : { ...item.assignee }
          })),
          summary: {
            count: expected.queue.summary.count,
            by_state: { ...expected.queue.summary.by_state }
          },
          posting: "none"
        }
      });
      assert.equal(JSON.parse(response.body).queue.kind, kind);
      assert.equal(header(response, "x-request-id"), REQUEST_ID);
    }
    // A malformed kind is invalid input and fails closed with the same
    // VALIDATION_FAILED the malformed-header rules use — never a silent
    // default-to-kyc. So is a repeated kind and any other query key.
    for (const path of [
      `${OPERATOR_QUEUE}?kind=fraud`,
      `${OPERATOR_QUEUE}?kind=KYC`,
      `${OPERATOR_QUEUE}?kind=`,
      `${OPERATOR_QUEUE}?kind`,
      `${OPERATOR_QUEUE}?kind=kyc&kind=aml`,
      `${OPERATOR_QUEUE}?kind=aml&cursor=1`,
      `${OPERATOR_QUEUE}?cursor=1`,
      `${OPERATOR_QUEUE}?kin=aml`
    ]) {
      const response = await request(port, { path, headers: operatorHeaders() });
      assert.equal(response.status, 400, path);
      assert.equal(JSON.parse(response.body).code, "VALIDATION_FAILED", path);
    }
    // A query string stays undeclared everywhere else — the rest of the
    // surface keeps its byte-identical 404.
    for (const path of [
      `${OPERATOR_SUBJECTS}?kind=aml`,
      `${OPERATOR_SUBJECTS}/syn_cust_0123456789abcdef01234567?kind=aml`,
      `${SESSION}?kind=aml`
    ]) {
      const response = await request(port, { path, headers: operatorHeaders() });
      assert.equal(response.status, 404, path);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED", path);
    }
    // The device-identifier gate binds the whole path including the query:
    // no X-Device-Id means 400 regardless of kind.
    for (const kind of ["kyc", "aml", "tickets"]) {
      const response = await request(port, {
        path: `${OPERATOR_QUEUE}?kind=${kind}`,
        headers: customerHeaders()
      });
      assert.equal(response.status, 400, kind);
      assert.equal(JSON.parse(response.body).code, "VALIDATION_FAILED", kind);
    }
  });
});

test("every queue kind stays deterministic, frozen, roster-consistent and within the contract shape", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const roster = (await directory.subjectsFor()).subjects;
  const byId = new Map(roster.map((row) => [row.subject_id, row]));
  const kinds = {
    kyc: {
      states: ["pending", "in_review", "escalated"],
      idPattern: /^qky_[0-9a-f]{24}$/u,
      member: (row) => row.kyc_status !== "verified",
      memberOf: (item, row) => item.state === "pending" ? item.assignee === null : true
    },
    aml: {
      states: ["pending", "in_review", "escalated"],
      idPattern: /^qml_[0-9a-f]{24}$/u,
      member: (row) => row.flags >= 1,
      memberOf: (item) => item.state === "pending" ? item.assignee === null : true
    },
    tickets: {
      states: ["open", "waiting", "escalated"],
      idPattern: /^qtick_[0-9a-f]{24}$/u,
      member: (row) => syntheticSupportTickets(row.subject_id).length >= 2,
      memberOf: (item) => item.state === "open" ? item.assignee === null : true
    }
  };
  for (const kind of OPERATOR_QUEUE_KINDS) {
    const spec = kinds[kind];
    const first = await directory.queueFor(kind);
    const second = await directory.queueFor(kind);
    assert.deepEqual(first, second, kind);
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.queue));
    assert.ok(Object.isFrozen(first.queue.items) && Object.isFrozen(first.queue.summary));
    assert.ok(first.queue.items.every((item) => Object.isFrozen(item)));
    assert.equal(first.mode, "test");
    assert.equal(first.queue.kind, kind);
    assert.equal(first.queue.posting, "none");
    assert.equal(validOperatorQueueView(first), true, kind);
    // The view answers the pinned contract schema exactly — the merged
    // kind ceiling covers every kind.
    assert.deepEqual(
      validator.validate(
        validator.resolve("#/components/schemas/OperatorQueueView"),
        {
          mode: "test",
          queue: {
            ...first.queue,
            items: first.queue.items.map((item) => ({
              ...item,
              ...(item.evidence_refs === undefined ? {} : { evidence_refs: [...item.evidence_refs] }),
              assignee: item.assignee === null ? null : { ...item.assignee }
            })),
            summary: {
              count: first.queue.summary.count,
              by_state: { ...first.queue.summary.by_state }
            }
          }
        }
      ),
      [],
      kind
    );
    const seenStates = new Set();
    for (const item of first.queue.items) {
      const row = byId.get(item.subject_id);
      assert.ok(row, `${item.subject_id} is outside the roster`);
      assert.equal(spec.member(row), true, `${item.subject_id} should not queue for ${kind}`);
      assert.match(item.queue_id, spec.idPattern);
      assert.ok(spec.states.includes(item.state), `${item.state} is outside the ${kind} vocabulary`);
      assert.match(item.priority, /^(normal|high|urgent)$/u);
      assert.ok(Number.isInteger(item.age_ms) && item.age_ms > 0);
      assert.equal(spec.memberOf(item, row), true, `${item.subject_id} assignee rule broke for ${kind}`);
      if (item.assignee !== null) {
        assert.match(item.assignee.subject, /^syn_oper_[a-z0-9]{8,32}$/u);
      }
      seenStates.add(item.state);
      if (kind === "kyc") {
        assert.notEqual(row.kyc_status, "verified");
        assert.equal(item.display_name, row.display_name);
        assert.ok(Date.parse(item.submitted_at) >= Date.parse(row.registered_at));
        assert.ok(Date.parse(item.sla_due_at) > Date.parse(item.submitted_at));
      } else if (kind === "aml") {
        assert.ok(row.flags >= 1);
        assert.match(item.alert_type, /^(structuring|velocity|geo_mismatch)$/u);
        assert.ok(Array.isArray(item.evidence_refs) && item.evidence_refs.length >= 1);
        assert.equal(new Set(item.evidence_refs).size, item.evidence_refs.length);
        for (const ref of item.evidence_refs) {
          assert.match(ref, /^evd_[0-9a-f]{24}$/u);
        }
        assert.ok(Date.parse(item.sla_due_at) > Date.parse(row.registered_at));
      } else {
        const tickets = syntheticSupportTickets(item.subject_id);
        assert.ok(tickets.length >= 2);
        // The queue item projects the subject's newest support ticket.
        assert.equal(item.category, tickets[0].category);
        assert.equal(item.opened_at, tickets[0].created_at);
        assert.ok(TICKET_CATEGORIES.includes(item.category));
        assert.ok(OPERATOR_TICKET_QUEUE_STATES.includes(item.state));
      }
    }
    assert.equal(seenStates.size, 3, `every ${kind} queue state is exercised by the pinned universe`);
    // Membership is exactly the kind's deterministic rule over the roster.
    const members = new Set(first.queue.items.map((item) => item.subject_id));
    for (const row of roster) {
      assert.equal(members.has(row.subject_id), spec.member(row), `${row.subject_id} membership (${kind})`);
    }
    // The summary tallies the items exactly over the kind's own states.
    assert.equal(first.queue.summary.count, first.queue.items.length);
    const tallied = Object.fromEntries(spec.states.map((state) => [state, 0]));
    for (const item of first.queue.items) {
      tallied[item.state] += 1;
    }
    assert.deepEqual({ ...first.queue.summary.by_state }, tallied, kind);
  }
});

test("a malformed operator queue view fails closed", async () => {
  const real = await createSyntheticOperatorSubjectsDirectory().queueFor();
  const realAml = await createSyntheticOperatorSubjectsDirectory().queueFor("aml");
  const realTickets = await createSyntheticOperatorSubjectsDirectory().queueFor("tickets");
  const drifted = (itemOverrides = {}) => queueView({}, { items: [{ ...real.queue.items[0], ...itemOverrides }] });
  // A full kind view with exactly one item field wrong: the verbatim
  // recompute is what fails it.
  const kindDrifted = (view, itemOverrides = {}, queueOverrides = {}) => ({
    ...view,
    queue: {
      ...view.queue,
      items: view.queue.items.map((item, index) =>
        index === 0 ? { ...item, ...itemOverrides } : item
      ),
      ...queueOverrides
    }
  });
  const missingQueue = { mode: "test" };
  const missingSummary = queueView({}, { summary: undefined });
  delete missingSummary.queue.summary;
  const malformed = [
    queueView({ mode: "live" }),
    queueView({ mode: "test", extra: true }),
    queueView({}, { kind: "fraud" }),
    // A kind that validates but mismatches the derivation fails on the
    // recompute — here an "aml" view carrying no items at all.
    queueView({}, { kind: "aml" }),
    // An "aml" view carrying kyc-shaped items fails the item shape.
    queueView({}, { kind: "aml", items: [...real.queue.items] }),
    // A "tickets" by_state set belongs to a different vocabulary.
    queueView({}, { kind: "tickets", items: [...realTickets.queue.items], summary: { count: realTickets.queue.items.length, by_state: { open: 1, waiting: 1, escalated: 1 } } }),
    kindDrifted(realAml, { alert_type: "sanctions" }),
    kindDrifted(realAml, { evidence_refs: ["evd_deadbeef"] }),
    kindDrifted(realAml, { evidence_refs: ["tx_001122334455667788990011"] }),
    kindDrifted(realAml, { state: "open" }),
    kindDrifted(realAml, { queue_id: "qky_0123456789abcdef01234567" }),
    kindDrifted(realAml, {}, { kind: "kyc" }),
    kindDrifted(realTickets, { category: "appeal" }),
    kindDrifted(realTickets, { state: "pending" }),
    kindDrifted(realTickets, { opened_at: "yesterday" }),
    kindDrifted(realTickets, { queue_id: "tck_0123456789abcdef01234567" }),
    kindDrifted(realTickets, { subject_id: `syn_cust_${"f".repeat(24)}` }),
    kindDrifted(realTickets, {}, { summary: { count: realTickets.queue.items.length, by_state: { pending: 1, in_review: 1, escalated: 1 } } }),
    queueView({}, { posting: "pending" }),
    queueView({}, { items: null }),
    queueView({}, { summary: { count: real.queue.items.length, by_state: { pending: 1, in_review: 1, escalated: 1 } } }),
    drifted({ queue_id: "qky_" + "f".repeat(24) }),
    drifted({ queue_id: "opr_0123456789abcdef01234567" }),
    drifted({ subject_id: `syn_cust_${"f".repeat(24)}` }),
    drifted({ display_name: "alina mironova" }),
    drifted({ submitted_at: "yesterday" }),
    drifted({ sla_due_at: real.queue.items[0].submitted_at }),
    drifted({ state: "approved" }),
    drifted({ state: "pending" }),
    drifted({ priority: "critical" }),
    drifted({ priority: real.queue.items[0].priority === "urgent" ? "normal" : "urgent" }),
    drifted({ assignee: "syn_oper_00000001" }),
    drifted({ assignee: { subject: SUBJECT } }),
    drifted({ assignee: { subject: "syn_oper_00000001", contact: "x" } }),
    drifted({ assignee: real.queue.items[0].assignee === null ? { subject: "syn_oper_00000001" } : null }),
    drifted({ age_ms: -1 }),
    drifted({ age_ms: real.queue.items[0].age_ms + 1 }),
    drifted({ age_ms: 1.5 }),
    { ...queueView(), session_secret: "abc" },
    missingQueue,
    missingSummary,
    null,
    "view"
  ];
  for (const view of malformed) {
    assert.equal(validOperatorQueueView(view), false, JSON.stringify(view));
    await withServer(
      {
        operatorSubjectsDirectory: {
          async subjectsFor() { return createSyntheticOperatorSubjectsDirectory().subjectsFor(); },
          async subjectFor() { return null; },
          async queueFor() { return view; },
          async queueItemFor() { return null; }
        }
      },
      async (port) => {
        const response = await request(port, { path: OPERATOR_QUEUE, headers: operatorHeaders() });
        assert.equal(response.status, 500, JSON.stringify(view));
        assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      }
    );
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

const queueItemIdRe = /^(qky|qml|qtick)_[0-9a-f]{24}$/u;

test("GET /api/v1/operator/queue/{kind}/{itemId} returns the deterministic item detail for every kind", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  await withServer({}, async (port) => {
    for (const kind of OPERATOR_QUEUE_KINDS) {
      const queue = await directory.queueFor(kind);
      assert.ok(queue.queue.items.length > 0, kind);
      for (const item of queue.queue.items) {
        const response = await request(port, {
          path: `${OPERATOR_QUEUE}/${kind}/${item.queue_id}`,
          headers: operatorHeaders()
        });
        assert.equal(response.status, 200, `${kind}/${item.queue_id}`);
        assert.equal(header(response, "x-request-id"), REQUEST_ID);
        const served = JSON.parse(response.body);
        const expected = await directory.queueItemFor(kind, item.queue_id);
        assert.deepEqual(served, expected, `${kind}/${item.queue_id}`);
        assert.equal(validOperatorQueueItemDetail(served), true, `${kind}/${item.queue_id}`);
        assert.deepEqual(
          validator.validate(
            validator.resolve("#/components/schemas/OperatorQueueItemDetailView"),
            served
          ),
          [],
          `${kind}/${item.queue_id}`
        );
        // The detail is the queue row the collection serves verbatim — every
        // item field — plus the kind's extension keys.
        for (const [key, value] of Object.entries(item)) {
          assert.deepEqual(served.item[key], value, `${kind}/${item.queue_id}.${key}`);
        }
        // Every operator sees the same detail: the projection is shared.
        const other = await request(port, {
          path: `${OPERATOR_QUEUE}/${kind}/${item.queue_id}`,
          headers: operatorHeaders({ Authorization: `Bearer ${operatorToken({ subject: "syn_oper_00000002" })}` })
        });
        assert.deepEqual(JSON.parse(other.body), served, `${kind}/${item.queue_id}`);
      }
    }
  });
});

test("queue item detail extensions agree with the neighboring surfaces", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  // kyc: the embedded dossier reuses the #312 recipe verbatim — identical to
  // the block the subject detail serves for the same subject.
  for (const item of (await directory.queueFor("kyc")).queue.items) {
    const detail = await directory.queueItemFor("kyc", item.queue_id);
    const subject = await directory.subjectFor(item.subject_id);
    assert.deepEqual(detail.item.kyc, subject.subject.kyc, item.queue_id);
  }
  // aml: the flags list is exactly the subject's open roster flags, and every
  // flag_added activity row the subject feed shows is announced by one of
  // them — the flag id shares the event's digest under its own grammar.
  for (const item of (await directory.queueFor("aml")).queue.items) {
    const detail = await directory.queueItemFor("aml", item.queue_id);
    const subject = await directory.subjectFor(item.subject_id);
    assert.equal(detail.item.flags.length, subject.subject.flags, item.queue_id);
    const events = new Map(
      subject.subject.recent_activity
        .filter((entry) => entry.kind === "flag_added")
        .map((entry) => [entry.activity_id.slice("opact_".length), entry])
    );
    for (const flag of detail.item.flags) {
      assert.match(flag.flag_id, /^flg_[0-9a-f]{24}$/u);
      const announced = events.get(flag.flag_id.slice("flg_".length));
      if (announced !== undefined) {
        assert.equal(announced.summary, flag.alert_type, flag.flag_id);
        assert.equal(announced.occurred_at, flag.raised_at, flag.flag_id);
      }
    }
    for (const hex of events.keys()) {
      assert.ok(
        detail.item.flags.some((flag) => flag.flag_id === `flg_${hex}`),
        `flag_added ${hex} missing from ${item.queue_id} flags`
      );
    }
  }
  // tickets: the detail projects the subject's newest support ticket — its
  // topic, newest message instant and the tally of the subject's other
  // still-open tickets (open until the ticket status reaches "closed").
  for (const item of (await directory.queueFor("tickets")).queue.items) {
    const detail = await directory.queueItemFor("tickets", item.queue_id);
    const tickets = syntheticSupportTickets(item.subject_id);
    const ticket = tickets[0];
    assert.equal(detail.item.subject, ticket.topic, item.queue_id);
    assert.equal(detail.item.category, ticket.category, item.queue_id);
    assert.equal(detail.item.opened_at, ticket.created_at, item.queue_id);
    assert.equal(detail.item.last_message_at, ticket.timeline[ticket.timeline.length - 1].at, item.queue_id);
    assert.equal(
      detail.item.other_open_tickets,
      tickets.slice(1).filter((entry) => entry.status !== "closed").length,
      item.queue_id
    );
  }
});

test("unknown kind or unknown/wrong-kind item ids fail closed with the uniform 404", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const kycItem = (await directory.queueFor("kyc")).queue.items[0];
  const amlItem = (await directory.queueFor("aml")).queue.items[0];
  const ticketItem = (await directory.queueFor("tickets")).queue.items[0];
  await withServer({}, async (port) => {
    for (const path of [
      `${OPERATOR_QUEUE}/fraud/${kycItem.queue_id}`,
      `${OPERATOR_QUEUE}/KYC/${kycItem.queue_id}`,
      `${OPERATOR_QUEUE}/kyc/qky_${"f".repeat(24)}`,
      `${OPERATOR_QUEUE}/aml/qml_${"0".repeat(24)}`,
      `${OPERATOR_QUEUE}/tickets/qtick_${"9".repeat(24)}`,
      // A well-formed id minted for another kind resolves inside the
      // requested kind only — the mismatch is indistinguishable.
      `${OPERATOR_QUEUE}/kyc/${amlItem.queue_id}`,
      `${OPERATOR_QUEUE}/aml/${kycItem.queue_id}`,
      `${OPERATOR_QUEUE}/tickets/${kycItem.queue_id}`,
      `${OPERATOR_QUEUE}/aml/${ticketItem.queue_id}`,
      `${OPERATOR_QUEUE}/tickets/${amlItem.queue_id}`,
      // A subject id or any other admitted shape is never an item.
      `${OPERATOR_QUEUE}/kyc/${kycItem.subject_id}`,
      `${OPERATOR_QUEUE}/kyc/unknownitemid`
    ]) {
      const response = await request(port, { path, headers: operatorHeaders() });
      assert.equal(response.status, 404, path);
      assert.equal(JSON.parse(response.body).code, "CAPABILITY_DENIED", path);
    }
    // A query string stays undeclared on the member path too.
    const withQuery = await request(port, {
      path: `${OPERATOR_QUEUE}/kyc/${kycItem.queue_id}?kind=aml`,
      headers: operatorHeaders()
    });
    assert.equal(withQuery.status, 404);
    assert.equal(JSON.parse(withQuery.body).code, "CAPABILITY_DENIED");
    // The device and audience gates bind the member path exactly like the
    // collection: no X-Device-Id is 400, a customer-family token is 401.
    const bare = await request(port, { path: `${OPERATOR_QUEUE}/kyc/${kycItem.queue_id}` });
    assert.equal(bare.status, 400);
    assert.equal(JSON.parse(bare.body).code, "VALIDATION_FAILED");
    const customer = await request(port, {
      path: `${OPERATOR_QUEUE}/kyc/${kycItem.queue_id}`,
      headers: [...customerHeaders(), ["X-Device-Id", DEVICE_ID]]
    });
    assert.equal(customer.status, 401);
    assert.equal(JSON.parse(customer.body).code, "AUTHENTICATION_REQUIRED");
  });
});

test("queueItemFor stays deterministic, frozen and kind-scoped", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  for (const kind of OPERATOR_QUEUE_KINDS) {
    const item = (await directory.queueFor(kind)).queue.items[0];
    const first = await directory.queueItemFor(kind, item.queue_id);
    const second = await directory.queueItemFor(kind, item.queue_id);
    assert.deepEqual(first, second, kind);
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.item), kind);
    assert.equal(first.mode, "test");
    assert.equal(first.kind, kind);
    assert.equal(validOperatorQueueItemDetail(first), true, kind);
    assert.match(first.item.queue_id, queueItemIdRe);
  }
  const kycItem = (await directory.queueFor("kyc")).queue.items[0];
  const amlItem = (await directory.queueFor("aml")).queue.items[0];
  for (const [kind, itemId] of [
    ["fraud", kycItem.queue_id],
    ["kyc", amlItem.queue_id],
    ["aml", kycItem.queue_id],
    ["tickets", kycItem.queue_id],
    ["kyc", `qky_${"0".repeat(24)}`],
    ["kyc", ""],
    ["kyc", kycItem.subject_id]
  ]) {
    assert.equal(await directory.queueItemFor(kind, itemId), null, `${kind}/${itemId}`);
  }
});

test("a malformed operator queue item detail fails closed", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const kycItem = (await directory.queueFor("kyc")).queue.items[0];
  const amlItem = (await directory.queueFor("aml")).queue.items[0];
  const ticketItem = (await directory.queueFor("tickets")).queue.items[0];
  const kycReal = await directory.queueItemFor("kyc", kycItem.queue_id);
  const amlReal = await directory.queueItemFor("aml", amlItem.queue_id);
  const ticketReal = await directory.queueItemFor("tickets", ticketItem.queue_id);
  const view = (base, itemOverrides = {}, viewOverrides = {}) => ({
    mode: "test",
    kind: base.kind,
    item: { ...base.item, ...itemOverrides },
    ...viewOverrides
  });
  const differentName = kycReal.item.display_name === "Roman Sokolov" ? "Vera Aliyev" : "Roman Sokolov";
  const wrongAlertType = ["structuring", "velocity", "geo_mismatch"].find(
    (entry) => entry !== amlReal.item.flags[0].alert_type
  );
  const missingItem = view(kycReal);
  delete missingItem.item;
  const malformed = [
    view(kycReal, {}, { mode: "live" }),
    // The kind selects the detail shape: a kyc item under another kind is drift.
    view(kycReal, {}, { kind: "aml" }),
    view(kycReal, {}, { kind: "tickets" }),
    view(amlReal, {}, { kind: "kyc" }),
    view(ticketReal, {}, { kind: "aml" }),
    // An id or subject outside the queue's universe is fabrication.
    view(kycReal, { queue_id: `qky_${"f".repeat(24)}` }),
    view(kycReal, { queue_id: amlReal.item.queue_id }),
    view(kycReal, { subject_id: `syn_cust_${"f".repeat(24)}` }),
    // Every row field must equal the collection row verbatim.
    view(kycReal, { display_name: differentName }),
    view(kycReal, { state: "closed" }),
    view(kycReal, { priority: "urgent" }),
    view(kycReal, { submitted_at: "2000-01-01T00:00:00.000Z" }),
    view(amlReal, { evidence_refs: ["evd_000000000000000000000001"] }),
    view(ticketReal, { category: "complaint" === ticketReal.item.category ? "question" : "complaint" }),
    // Extensions carry their own shape and recompute.
    view(kycReal, { kyc: "dossier" }),
    view(kycReal, { kyc: { status: "approved", level: "basic", session_id: "x", history: [] } }),
    view(kycReal, { kyc: { ...kycReal.item.kyc ?? {}, status: "approved" } }),
    view(amlReal, { flags: [] }),
    view(amlReal, { flags: [{ flag_id: `flg_${"a".repeat(24)}`, alert_type: amlReal.item.flags[0].alert_type, raised_at: amlReal.item.flags[0].raised_at }] }),
    view(amlReal, { flags: amlReal.item.flags.map((flag) => ({ ...flag, alert_type: wrongAlertType })) }),
    view(amlReal, { flags: [{ flag_id: `opact_${"a".repeat(24)}`, alert_type: amlReal.item.flags[0].alert_type, raised_at: amlReal.item.flags[0].raised_at }] }),
    view(ticketReal, { subject: "" }),
    view(ticketReal, { last_message_at: "never" }),
    view(ticketReal, { last_message_at: "2000-01-01T00:00:00.000Z" }),
    view(ticketReal, { other_open_tickets: -1 }),
    view(ticketReal, { other_open_tickets: ticketReal.item.other_open_tickets + 1 }),
    view(kycReal, { extra: true }),
    missingItem,
    "view"
  ];
  assert.equal(validOperatorQueueItemDetail(null), false);
  for (const candidate of malformed) {
    assert.equal(validOperatorQueueItemDetail(candidate), false, JSON.stringify(candidate));
    await withServer(
      {
        operatorSubjectsDirectory: {
          async subjectsFor() { return createSyntheticOperatorSubjectsDirectory().subjectsFor(); },
          async subjectFor() { return null; },
          async queueFor() { return createSyntheticOperatorSubjectsDirectory().queueFor(); },
          async queueItemFor() { return candidate; }
        }
      },
      async (port) => {
        const response = await request(port, {
          path: `${OPERATOR_QUEUE}/kyc/${kycItem.queue_id}`,
          headers: operatorHeaders()
        });
        assert.equal(response.status, 500, JSON.stringify(candidate));
        assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
      }
    );
  }
});

const OPERATOR_AUDIT = "/api/v1/operator/audit";

test("the operator audit feed is deterministic, frozen and within the contract shape", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const first = await directory.auditFor();
  const second = await createSyntheticOperatorSubjectsDirectory().auditFor();
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.audit));
  assert.ok(Object.isFrozen(first.audit.entries));
  assert.equal(first.mode, "test");
  assert.equal(first.audit.as_of, "2027-01-29T00:00:00.000Z");
  assert.ok(first.audit.entries.length > 0 && first.audit.entries.length <= 32);
  const ids = new Set(first.audit.entries.map((entry) => entry.audit_id));
  assert.equal(ids.size, first.audit.entries.length);
  // Newest-first with the audit_id tie-break, all timestamps within the
  // feed's as_of horizon.
  for (let index = 1; index < first.audit.entries.length; index += 1) {
    const [previous, current] = [first.audit.entries[index - 1], first.audit.entries[index]];
    assert.ok(
      previous.at > current.at || (previous.at === current.at && previous.audit_id > current.audit_id),
      `${previous.audit_id} -> ${current.audit_id}`
    );
  }
  for (const entry of first.audit.entries) {
    assert.ok(Date.parse(entry.at) <= Date.parse(first.audit.as_of));
    assert.match(entry.detail_hash, /^adh_[0-9a-f]{32}$/u);
  }
  assert.equal(validOperatorAuditView(first), true);
  assert.deepEqual(
    validator.validate(
      validator.resolve("#/components/schemas/OperatorAuditView"),
      JSON.parse(JSON.stringify(first))
    ),
    []
  );
});

test("the audit feed paginates through the whole synthetic universe without overlap", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  const seen = new Set();
  let cursor;
  let pages = 0;
  for (;;) {
    const view = await directory.auditFor(cursor);
    assert.ok(view !== null, `page ${pages}`);
    assert.equal(validOperatorAuditView(view), true);
    for (const entry of view.audit.entries) {
      assert.ok(!seen.has(entry.audit_id), entry.audit_id);
      seen.add(entry.audit_id);
    }
    pages += 1;
    if (view.audit.next_cursor === null) {
      break;
    }
    assert.match(view.audit.next_cursor, /^auc_[0-9a-f]{16}$/u);
    cursor = view.audit.next_cursor;
  }
  assert.ok(pages >= 2, "the feed spans more than one page");
});

test("auditFor answers null for well-formed tokens the feed never minted", async () => {
  const directory = createSyntheticOperatorSubjectsDirectory();
  let probe = "0".repeat(16);
  while ((await directory.auditFor(`auc_${probe}`)) !== null) {
    probe = (BigInt(`0x${probe}`) + 1n).toString(16).padStart(16, "0").slice(-16);
  }
  assert.match(probe, /^[0-9a-f]{16}$/u);
  // Malformed tokens are rejected before the directory: the route grammar
  // gate answers them itself, so only the minted-token space reaches
  // auditFor.
});

test("every audit entry's actor_role is the role draw the admin view reports for that actor", async () => {
  // The feed's actors are syn_oper_* staff refs: the role an entry
  // attributes to an actor must equal operatorRoleFor(actor) — the same
  // draw the admin view echoes and the audit route's role gate uses. A
  // feed whose entries disagree with the staff role model would show an
  // auditor's actions under a support-l1 hat.
  const directory = createSyntheticOperatorSubjectsDirectory();
  let cursor;
  let entries = 0;
  do {
    const view = await directory.auditFor(cursor);
    assert.ok(view !== null);
    for (const entry of view.audit.entries) {
      assert.equal(entry.actor_role, operatorRoleFor(entry.actor_subject_id), entry.audit_id);
      entries += 1;
    }
    cursor = view.audit.next_cursor;
  } while (cursor);
  assert.ok(entries > 0);
});

test("audit targets never dangle outside the sibling operator reads", async () => {
  // Every queue_item target must exist in the queue it names, every
  // subject target in the roster and every flag target in the subject's
  // open flag list; session refs are the one universe no read serves.
  const directory = createSyntheticOperatorSubjectsDirectory();
  const entries = [];
  let cursor;
  do {
    const view = await directory.auditFor(cursor);
    entries.push(...view.audit.entries);
    cursor = view.audit.next_cursor;
  } while (cursor);
  const queueIds = new Set();
  for (const kind of ["kyc", "aml", "tickets"]) {
    for (const item of (await directory.queueFor(kind)).queue.items) {
      queueIds.add(item.queue_id);
    }
  }
  const subjectIds = new Set((await directory.subjectsFor()).subjects.map((row) => row.subject_id));
  const flagIds = new Set();
  for (const item of (await directory.queueFor("aml")).queue.items) {
    const detail = await directory.queueItemFor("aml", item.queue_id);
    for (const flag of detail.item.flags) {
      flagIds.add(flag.flag_id);
    }
  }
  for (const entry of entries) {
    if (entry.target_kind === "queue_item") {
      assert.ok(queueIds.has(entry.target_id), entry.target_id);
    } else if (entry.target_kind === "subject") {
      assert.ok(subjectIds.has(entry.target_id), entry.target_id);
    } else if (entry.target_kind === "flag") {
      assert.ok(flagIds.has(entry.target_id), entry.target_id);
    }
  }
});

test("a malformed operator audit view fails closed and never serves", async () => {
  const real = await createSyntheticOperatorSubjectsDirectory().auditFor();
  const entry = real.audit.entries[0];
  const view = (overrides = {}) => ({ ...real, audit: { ...real.audit, ...overrides } });
  const malformed = [
    null,
    "view",
    { ...real, mode: "live" },
    view({ as_of: "2020-01-01T00:00:00.000Z" }),
    view({ entries: [] }),
    view({ entries: [...real.audit.entries, entry] }),
    view({ next_cursor: "auc_zzz" }),
    view({ next_cursor: real.audit.next_cursor === null ? "auc_0000000000000000" : null }),
    view({ entries: real.audit.entries.map((item) => ({ ...item, detail_hash: "adh_zzz" })) }),
    view({ entries: real.audit.entries.map((item) => ({ ...item, action: "money.moved" })) }),
    view({ entries: [{ ...entry, pii: "a@b.c" }, ...real.audit.entries.slice(1)] }),
    { ...real, extra: true }
  ];
  assert.equal(validOperatorAuditView(null), false);
  for (const candidate of malformed) {
    assert.equal(validOperatorAuditView(candidate), false, JSON.stringify(candidate));
  }
  await withServer(
    {
      operatorSubjectsDirectory: {
        async subjectsFor() { return createSyntheticOperatorSubjectsDirectory().subjectsFor(); },
        async subjectFor() { return null; },
        async queueFor() { return createSyntheticOperatorSubjectsDirectory().queueFor(); },
        async queueItemFor() { return null; },
        async auditFor() { return view({ entries: real.audit.entries.map((item) => ({ ...item, detail_hash: "adh_zzz" })) }); }
      }
    },
    async (port) => {
      const response = await request(port, { path: OPERATOR_AUDIT, headers: auditOperatorHeaders() });
      assert.equal(response.status, 500);
      assert.equal(JSON.parse(response.body).code, "INTERNAL_ERROR");
    }
  );
});
