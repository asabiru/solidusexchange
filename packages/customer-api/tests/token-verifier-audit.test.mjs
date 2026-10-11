import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createSyntheticTokenVerifier,
  CUSTOMER_SCOPES,
  mintSyntheticCustomerToken,
  mintSyntheticOperatorToken,
  OPERATOR_SCOPES,
  SYNTHETIC_TOKEN_MAX_TTL_SECONDS
} from "../src/auth.mjs";
import { OPERATIONS } from "../src/contract.mjs";
import {
  customerHeaders,
  DEVICE_ID,
  NOW_MS,
  OPERATOR_SUBJECT,
  operatorHeaders,
  request,
  REQUEST_ID,
  startTestServer,
  stopServer,
  SUBJECT,
  TEST_KEY,
  token
} from "./http-client.mjs";

const execFileAsync = promisify(execFile);
const MINT_SCRIPT = fileURLToPath(new URL("../scripts/mint-dev-token.mjs", import.meta.url));
const MINT_ENV = {
  ...process.env,
  CUSTOMER_API_DEV_AUTH: "synthetic",
  CUSTOMER_API_DEV_TOKEN_KEY: TEST_KEY
};

const CUSTOMER_DOMAIN = "solidchange-customer-api-synthetic-dev-token-v1";
const OPERATOR_DOMAIN = "solidchange-operator-api-synthetic-dev-token-v1";
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const EXPIRES_TEXT = String(NOW_SECONDS + 900);

const verifier = createSyntheticTokenVerifier({ key: TEST_KEY, clock: () => NOW_MS });

function hmac(domain, subject, expiresText) {
  return createHmac("sha256", Buffer.from(TEST_KEY, "hex"))
    .update(`${domain}\n${subject}\n${expiresText}`)
    .digest("hex");
}

function customerToken(subject = SUBJECT, expiresText = EXPIRES_TEXT, domain = CUSTOMER_DOMAIN) {
  return `scdev1.${subject}.${expiresText}.${hmac(domain, subject, expiresText)}`;
}

function operatorTokenWith(domain, subject = OPERATOR_SUBJECT, expiresText = EXPIRES_TEXT) {
  return `sodev1.${subject}.${expiresText}.${hmac(domain, subject, expiresText)}`;
}

async function rejectsEach(cases) {
  for (const crafted of cases) {
    assert.equal(await verifier.verify(crafted), null, `accepted: ${JSON.stringify(crafted)}`);
  }
}

test("audience is bound inside the signature: no re-domaining crosses families", async () => {
  const customer = token();
  const operator = operatorTokenWith(OPERATOR_DOMAIN);
  const [, , , customerSignature] = customer.split(".");

  // Control: both genuine tokens verify under their own family.
  assert.equal((await verifier.verify(customer))?.actorType, "customer");
  assert.equal((await verifier.verify(operator))?.actorType, "operator");

  await rejectsEach([
    // Customer bytes re-labelled with the operator prefix.
    customer.replace("scdev1.", "sodev1."),
    customer.replace("scdev1.", "sodev1.").replace("syn_cust_", "syn_oper_"),
    // Operator bytes re-labelled with the customer prefix.
    operator.replace("sodev1.", "scdev1."),
    operator.replace("sodev1.", "scdev1.").replace("syn_oper_", "syn_cust_"),
    // Swapping only the subject namespace never reaches the signature check.
    customer.replace("syn_cust_", "syn_oper_"),
    operator.replace("syn_oper_", "syn_cust_"),
    // Same fields signed under the OTHER family's domain never verify.
    `scdev1.${SUBJECT}.${EXPIRES_TEXT}.${hmac(OPERATOR_DOMAIN, SUBJECT, EXPIRES_TEXT)}`,
    `sodev1.${OPERATOR_SUBJECT}.${EXPIRES_TEXT}.${hmac(CUSTOMER_DOMAIN, OPERATOR_SUBJECT, EXPIRES_TEXT)}`,
    // The customer signature is worthless on an operator-shaped token.
    `sodev1.${OPERATOR_SUBJECT}.${EXPIRES_TEXT}.${customerSignature}`,
    `scdev1.${SUBJECT}.${EXPIRES_TEXT}.${operator.split(".")[3]}`
  ]);
});

test("token fields cannot be rearranged, emptied, duplicated or extended", async () => {
  const customer = token();
  const signature = customer.split(".")[3];
  await rejectsEach([
    `scdev1.${EXPIRES_TEXT}.${SUBJECT}.${signature}`,
    `scdev1..${EXPIRES_TEXT}.${signature}`,
    `scdev1.${SUBJECT}..${signature}`,
    `scdev1.${SUBJECT}.${EXPIRES_TEXT}.`,
    `${customer}.extra`,
    `${customer}.`,
    `.${customer}`,
    `scdev1..${SUBJECT}.${EXPIRES_TEXT}.${signature}`,
    `scdev1.${SUBJECT}.${EXPIRES_TEXT}.${signature}.trailing`,
    `scdev1.scdev1.${EXPIRES_TEXT}.${signature}`,
    `scdev1${SUBJECT}.${EXPIRES_TEXT}.${signature}`,
    `scdev1.${SUBJECT}${EXPIRES_TEXT}.${signature}`,
    `scdev1.${SUBJECT}.${EXPIRES_TEXT}${signature}`,
    // Prefix case is part of the token grammar, not of the signature.
    `SCDEV1.${SUBJECT}.${EXPIRES_TEXT}.${signature}`,
    `Scdev1.${SUBJECT}.${EXPIRES_TEXT}.${signature}`,
    `sodev1.${SUBJECT}.${EXPIRES_TEXT}.${signature}`,
    // Family prefix cannot be smuggled inside the subject segment.
    `scdev1.${SUBJECT}.sodev1.${signature}`,
    `scdev1.sodev1.${EXPIRES_TEXT}.${signature}`
  ]);
});

test("only the exact 64-hex HMAC-SHA256 digest is accepted", async () => {
  const customer = token();
  const signature = customer.split(".")[3];
  const flipped = (signature.startsWith("0") ? "1" : "0") + signature.slice(1);
  await rejectsEach([
    customer.slice(0, -1),
    customer.slice(0, -64),
    `${customer.slice(0, -64)}${signature.toUpperCase()}`,
    `${customer.slice(0, -64)}${flipped}`,
    `${customer}f`,
    `${customer.slice(0, -64)}${signature.slice(2)}00`,
    `${customer.slice(0, -64)}${"0".repeat(64)}`,
    `${customer.slice(0, -64)}${"g".repeat(64)}`,
    `${customer.slice(0, -64)}${"ab".repeat(33)}`
  ]);
  // A correctly-signed token over other valid material still verifies: the
  // check is authenticity, not byte-equality with one particular token.
  assert.equal((await verifier.verify(customerToken(SUBJECT, String(NOW_SECONDS + 901))))?.subject, SUBJECT);
});

test("the expiry grammar admits only the canonical ten-digit epoch seconds", async () => {
  for (const expiry of [
    "999999999",
    "10000000000",
    `0${EXPIRES_TEXT}`,
    `+${EXPIRES_TEXT}`,
    `-${EXPIRES_TEXT.slice(0, 9)}`,
    `${EXPIRES_TEXT}.5`,
    "1.8e9",
    `${EXPIRES_TEXT} `,
    ` ${EXPIRES_TEXT}`,
    "17960009O0",
    "0x1796000900",
    "NaN",
    "Infinity",
    ""
  ]) {
    // Signed correctly under the right domain and still rejected: the grammar
    // never lets a malformed field reach the expiry comparison.
    await rejectsEach([customerToken(SUBJECT, expiry), operatorTokenWith(OPERATOR_DOMAIN, OPERATOR_SUBJECT, expiry)]);
  }
});

test("the expiry window holds exactly at both boundaries", async () => {
  assert.equal((await verifier.verify(token({ ttlSeconds: SYNTHETIC_TOKEN_MAX_TTL_SECONDS })))?.subject, SUBJECT);
  await rejectsEach([
    token({ ttlSeconds: SYNTHETIC_TOKEN_MAX_TTL_SECONDS + 1 }),
    token({ ttlSeconds: 0 }),
    token({ ttlSeconds: -1 }),
    token({ ttlSeconds: -3600 }),
    token({ ttlSeconds: 90_000 })
  ]);
  // The same boundaries hold for the operator family.
  const atBound = `sodev1.${OPERATOR_SUBJECT}.${NOW_SECONDS + SYNTHETIC_TOKEN_MAX_TTL_SECONDS}.${
    hmac(OPERATOR_DOMAIN, OPERATOR_SUBJECT, String(NOW_SECONDS + SYNTHETIC_TOKEN_MAX_TTL_SECONDS))
  }`;
  assert.equal((await verifier.verify(atBound))?.actorType, "operator");
  const pastBound = `sodev1.${OPERATOR_SUBJECT}.${NOW_SECONDS + SYNTHETIC_TOKEN_MAX_TTL_SECONDS + 1}.${
    hmac(OPERATOR_DOMAIN, OPERATOR_SUBJECT, String(NOW_SECONDS + SYNTHETIC_TOKEN_MAX_TTL_SECONDS + 1))
  }`;
  await rejectsEach([pastBound]);
});

test("the subject grammar rejects delimiters, whitespace, control and unicode bytes", async () => {
  const crafted = [
    "syn_cust_0000.001",
    "syn_cust_0000 001",
    "syn_cust_0000\t001",
    "syn_cust_0000\n001",
    "syn_cust_0000\r001",
    "syn_cust_00000001\x00",
    "syn_cust_0000/001",
    "syn_cust_0000\\001",
    "syn_cust_0000#001",
    "syn_cust_0000?001",
    "syn_cust_0000%001",
    "syn_cust_ABCDEFGH",
    "syn_cust_0000_001",
    "syn_cust_",
    "syn_cust_0000001",
    `syn_cust_${"0".repeat(33)}`,
    "syn_cust_0000000\u00e9",
    "syn_cust_0000\u200b001",
    "SYN_CUST_00000001"
  ];
  for (const subject of crafted) {
    // Even when the attacker signs the field correctly, it must not parse.
    await rejectsEach([customerToken(subject)]);
  }
  // A subject that would collide with the operator namespace is also rejected.
  await rejectsEach([customerToken("syn_oper_00000001"), operatorTokenWith(OPERATOR_DOMAIN, "syn_cust_00000001")]);
});

test("principal fields come only from the verified family", async () => {
  const customerPrincipal = await verifier.verify(token());
  assert.equal(customerPrincipal?.subject, SUBJECT);
  assert.equal(customerPrincipal?.actorType, "customer");
  assert.deepEqual(customerPrincipal?.scopes, [...CUSTOMER_SCOPES]);
  assert.equal(customerPrincipal?.expiresAt, new Date((NOW_SECONDS + 900) * 1000).toISOString());
  assert.ok(Object.isFrozen(customerPrincipal));
  assert.ok(Object.isFrozen(customerPrincipal?.scopes));

  const operatorPrincipal = await verifier.verify(operatorTokenWith(OPERATOR_DOMAIN));
  assert.equal(operatorPrincipal?.subject, OPERATOR_SUBJECT);
  assert.equal(operatorPrincipal?.actorType, "operator");
  assert.deepEqual(operatorPrincipal?.scopes, [...OPERATOR_SCOPES]);

  // The returned scope list is a frozen copy: mutating it cannot poison the
  // server-side constants the capability policy trusts.
  assert.throws(() => {
    /** @type {string[]} */ (/** @type {unknown} */ (operatorPrincipal?.scopes)).push("operator.admin.write");
  });
  assert.deepEqual([...OPERATOR_SCOPES], [...operatorPrincipal?.scopes]);
});

test("verifier rejects non-string and oversized inputs without reaching HMAC", async () => {
  await rejectsEach([
    null,
    undefined,
    0,
    42,
    Number.NaN,
    false,
    {},
    [],
    Buffer.from(token()),
    `${token()}${"a".repeat(40)}`,
    "a".repeat(500),
    `${token()}\n`,
    `${token()}\r\n`,
    token().toUpperCase()
  ]);
});

test("mint emits exactly the canonical form the verifier parses", async () => {
  for (const family of ["customer", "operator"]) {
    const mint = family === "customer" ? mintSyntheticCustomerToken : mintSyntheticOperatorToken;
    const subject = family === "customer" ? SUBJECT : OPERATOR_SUBJECT;
    const expiresAtSeconds = NOW_SECONDS + 600;
    const minted = mint({ key: TEST_KEY, subject, expiresAtSeconds });
    const [prefix, mintedSubject, mintedExpiry, mintedSignature] = minted.split(".");
    assert.equal(prefix, family === "customer" ? "scdev1" : "sodev1");
    assert.equal(mintedSubject, subject);
    // The signed expiry digits are exactly the canonical decimal of the number.
    assert.equal(mintedExpiry, String(expiresAtSeconds));
    assert.match(mintedExpiry, /^[1-9][0-9]{9}$/u);
    assert.equal(
      mintedSignature,
      hmac(family === "customer" ? CUSTOMER_DOMAIN : OPERATOR_DOMAIN, subject, mintedExpiry)
    );
    assert.equal((await verifier.verify(minted))?.actorType, family);
  }
  // Mint bounds coincide with the verifier grammar: 1e9 and 9999999999 are the
  // edges of the ten-digit field, and both sides of them are refused.
  for (const expiresAtSeconds of [1_000_000_000, 9_999_999_999]) {
    assert.match(mintSyntheticCustomerToken({ key: TEST_KEY, subject: SUBJECT, expiresAtSeconds }), /^scdev1\./u);
  }
  for (const expiresAtSeconds of [999_999_999, 10_000_000_000, 0, -1, 1.5, Number.NaN, "1796000900", null]) {
    assert.throws(() =>
      mintSyntheticCustomerToken({ key: TEST_KEY, subject: SUBJECT, expiresAtSeconds: /** @type {number} */ (expiresAtSeconds) })
    );
  }
});

test("mint refuses subjects outside the per-family namespaces", () => {
  for (const subject of [
    "syn_oper_00000001",
    "syn_cust_1234567",
    `syn_cust_${"a".repeat(33)}`,
    "syn_cust_ABCDEFGH",
    "syn_cust_0000 001",
    "syn_cust_0000.001",
    "syn_cust_0000\n001",
    "SYN_CUST_00000001",
    "",
    42,
    null
  ]) {
    assert.throws(() =>
      mintSyntheticCustomerToken({ key: TEST_KEY, subject: /** @type {string} */ (subject), expiresAtSeconds: NOW_SECONDS + 60 })
    );
  }
  for (const subject of ["syn_cust_00000001", "syn_oper_1234567", "syn_oper_ABCDEFGH"]) {
    assert.throws(() =>
      mintSyntheticOperatorToken({ key: TEST_KEY, subject, expiresAtSeconds: NOW_SECONDS + 60 })
    );
  }
  // A valid-looking key of the wrong shape is refused before any signing
  // (a 64-zero key is format-valid dev material and mints normally).
  for (const key of ["", "0".repeat(63), "0".repeat(65), "f".repeat(64).toUpperCase(), "g".repeat(64), 42]) {
    assert.throws(() =>
      mintSyntheticCustomerToken({ key: /** @type {string} */ (key), subject: SUBJECT, expiresAtSeconds: NOW_SECONDS + 60 })
    );
  }
});

test("no URL form reaches the dispatch outside the declared contract paths", async () => {
  const { server, port } = await startTestServer();
  try {
    for (const path of [
      "/api/v1/operator",
      "/api/v1/operatorx",
      "/api/v1/operator/session/",
      "//api/v1/operator/session",
      "/api/v1/customer/../operator/session",
      "/api/v1%2foperator%2fsession",
      "/api/v1/operator/session?x=1",
      "/api/v1/operator/session#x",
      "/api/v1/operator/session;foo=bar",
      "/api/v1/operator//session",
      "/API/V1/OPERATOR/SESSION",
      "http://127.0.0.1/api/v1/operator/session",
      "/api/v1/operator/session%2f..",
      "/api/v1/operator/sessio%00n"
    ]) {
      const response = await request(port, { path, headers: operatorHeaders() });
      assert.equal(response.status, 404, `${path} -> ${response.status}`);
    }
  } finally {
    await stopServer(server);
  }
});

test("every operator-namespaced path binds actorType and no skip path exists", async () => {
  // Contract pin: the dispatch audience is derived from the declared path, so
  // the namespace and the operation family must always agree.
  for (const operation of OPERATIONS) {
    const operatorPath = operation.path.startsWith("/api/v1/operator/");
    assert.equal(
      operatorPath,
      operation.operationId.startsWith("getOperator"),
      `${operation.operationId} namespace disagrees with ${operation.path}`
    );
    if (operatorPath) {
      assert.equal(operation.authenticated, true, `${operation.operationId} must never skip authentication`);
    }
    // No path may start with the operator prefix unless the slash follows.
    assert.equal(
      operation.path.startsWith("/api/v1/operator") && !operatorPath,
      false,
      `${operation.path} escapes the operator namespace binding`
    );
  }

  const { server, port } = await startTestServer();
  try {
    // A customer token presented to an operator surface is authenticated and
    // then rejected by the audience binding (the check itself is reached).
    const customerOnOperator = await request(port, {
      path: "/api/v1/operator/session",
      headers: [
        ["X-Device-Id", DEVICE_ID],
        ["X-Request-Id", REQUEST_ID],
        ["X-Client-Version", "1.0.0"],
        ["X-Platform", "web"],
        ["Authorization", `Bearer ${token()}`]
      ]
    });
    assert.equal(customerOnOperator.status, 401);
    assert.match(customerOnOperator.body, /AUTHENTICATION_REQUIRED/u);

    const operatorOnCustomer = await request(port, {
      path: "/api/v1/customer/session",
      headers: customerHeaders({ Authorization: `Bearer ${operatorTokenWith(OPERATOR_DOMAIN)}` })
    });
    assert.equal(operatorOnCustomer.status, 401);
  } finally {
    await stopServer(server);
  }
});

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ code: number | string, stdout: string, stderr: string }>}
 */
async function runMint(args, env = MINT_ENV) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [MINT_SCRIPT, ...args], { env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = /** @type {{ code?: number | string, stdout?: string, stderr?: string }} */ (error);
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

test("mint-dev-token rejects non-canonical ttl values (regression)", async () => {
  // Number() previously accepted each of these non-decimal or padded forms.
  for (const args of [
    ["--ttl", "0x10"],
    ["--ttl", "1e3"],
    ["--ttl", " 60"],
    ["--ttl", "60 "],
    ["--ttl", "060"],
    ["--ttl", "+60"],
    ["--ttl", "900.5"],
    ["--ttl", "0"],
    ["--ttl", "3601"],
    ["--ttl=-5"],
    ["--ttl", "abc"],
    ["--ttl", ""]
  ]) {
    const result = await runMint(args);
    const ttl = args[1] ?? args[0];
    assert.equal(result.code, 1, `--ttl ${JSON.stringify(ttl)} should fail`);
    assert.match(result.stderr, /--ttl must be an integer/u);
    assert.equal(result.stdout, "");
  }
  // Canonical values still mint a verifiable token.
  const realClock = createSyntheticTokenVerifier({ key: TEST_KEY });
  for (const ttl of ["1", "900", "3600"]) {
    const result = await runMint(["--ttl", ttl]);
    assert.equal(result.code, 0, `--ttl ${ttl} should mint`);
    const minted = result.stdout.trim();
    assert.match(minted, /^scdev1\.syn_cust_[a-z0-9]{8,32}\.[1-9][0-9]{9}\.[0-9a-f]{64}$/u);
    assert.equal((await realClock.verify(minted))?.actorType, "customer");
  }
});

test("mint-dev-token keeps argv out of signed material and covers both audiences", async () => {
  const realClock = createSyntheticTokenVerifier({ key: TEST_KEY });

  const operator = await runMint(["--audience", "operator", "--ttl", "60"]);
  assert.equal(operator.code, 0);
  assert.equal((await realClock.verify(operator.stdout.trim()))?.actorType, "operator");

  const customSubject = await runMint(["--audience", "customer", "--subject", "syn_cust_deadbeef", "--ttl", "60"]);
  assert.equal(customSubject.code, 0);
  assert.equal((await realClock.verify(customSubject.stdout.trim()))?.subject, "syn_cust_deadbeef");

  // Subjects from the other namespace or carrying shell metacharacters never
  // reach the signature because mint re-validates the same grammar.
  for (const args of [
    ["--audience", "customer", "--subject", "syn_oper_00000001"],
    ["--audience", "operator", "--subject", "syn_cust_00000001"],
    ["--audience", "customer", "--subject", "syn_cust_00000001;id"],
    ["--audience", "customer", "--subject", "syn_cust_00000001;touch x"],
    ["--audience", "customer", "--subject", "syn_cust_$(id)"],
    ["--audience", "__proto__"],
    ["--audience", "constructor"],
    ["--audience", "toString"],
    ["--audience", "Customer"],
    ["--audience", "bogus"],
    ["--ttl", "900;id"]
  ]) {
    const result = await runMint(args);
    assert.equal(result.code, 1, `${args.join(" ")} should fail`);
    assert.equal(result.stdout, "");
  }

  // Without the synthetic flag the script refuses to mint at all.
  const { CUSTOMER_API_DEV_AUTH: _drop, ...withoutFlag } = MINT_ENV;
  const noAuth = await runMint([], withoutFlag);
  assert.equal(noAuth.code, 1);
  assert.match(noAuth.stderr, /CUSTOMER_API_DEV_AUTH/u);
});
