import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { can, type Capability, roleProfiles } from "../auth/access.js";
import { loadServerConfig } from "./config.js";
import { createBackofficeServer } from "./server.js";
import { subjectTimelineKindCapability } from "./subjects.js";

const origin = "http://127.0.0.1:4173";
const root = new URL("../../", import.meta.url);
const serverSource = readFileSync(new URL("src/server/server.ts", root), "utf8");

let server: Server;
let baseUrl: string;

async function devSession(role: string): Promise<string> {
  const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body: JSON.stringify({ role })
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

function routeGateCalls(): { shape: string; capability?: string }[] {
  return [...serverSource.matchAll(/authorized\(request, response(?:, "([^"]+)")?\)/g)]
    .map((match) => ({ shape: match[0], capability: match[1] }));
}

describe("backoffice authorization matrix", () => {
  before(async () => {
    server = createBackofficeServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: true,
      sessionTtlSeconds: 900,
      audit: {
        storage: "memory",
        retentionDays: 30
      },
      stepUp: {
        provider: "synthetic-dev",
        challengeTtlSeconds: 300,
        grantTtlSeconds: 60,
        maxAttempts: 3
      },
      signing: {
        backend: "ephemeral-dev",
        rotationSeconds: 900,
        retainedVerificationKeys: 2
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server address unavailable");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("enforces only capabilities that exist and are held by at least one role", () => {
    const calls = routeGateCalls();
    // One call site per gate; the definition itself must not match this scan.
    const mentions = serverSource.match(/authorized\(/g) ?? [];
    assert.equal(
      mentions.length - 1 - calls.length,
      0,
      "a capability gate ran on something other than (request, response, capability)"
    );

    const expected = new Set([
      "aml:read",
      "approvals:preview",
      "approvals:read",
      "approvals:step-up",
      "audit:export",
      "audit:read",
      "checks:read",
      "custody:read",
      "customers:read",
      "dashboard:read",
      "fraud:read",
      "investigations:read",
      "kyc:read",
      "reports:read",
      "subjects:read",
      "support:read"
    ]);
    const enforced = new Set(calls.flatMap((call) => call.capability ? [call.capability] : []));
    assert.deepEqual([...enforced].sort(), [...expected].sort());

    // A capability nobody holds is a dead route; a literal outside this set is
    // a typo or a domain-confused check that would 403 every operator.
    for (const capability of enforced) {
      assert.ok(
        roleProfiles.some((profile) => can(profile.id, capability as Capability)),
        `route capability ${capability} is not granted to any role`
      );
    }

    // Only /bff/api/session and /bff/api/operator/admin run the gate without a
    // capability — both read the operator's own record, which every role holds.
    assert.equal(calls.filter((call) => !call.capability).length, 2);
  });

  it("matches roles and capabilities exactly, never by prefix, case or wildcard", () => {
    for (const weird of [
      "checks",
      "check:read",
      "checks:read ",
      " checks:read",
      "CHECKS:READ",
      "checks:Read",
      "checks:*",
      "*",
      "checks:read,audit:read",
      "checks:read\n"
    ]) {
      assert.equal(can("compliance-lead", weird as Capability), false, JSON.stringify(weird));
    }
    for (const role of [
      "COMPLIANCE-LEAD",
      "compliance-lead ",
      " compliance-lead",
      "compliance",
      "compliance_lead",
      "support",
      "admin",
      "*",
      "",
      "__proto__",
      "constructor"
    ]) {
      assert.equal(can(role, "checks:read"), false, JSON.stringify(role));
    }
    for (const profile of roleProfiles) {
      assert.equal(can(profile.id, profile.capabilities[0]), true, profile.id);
      assert.equal(can(profile.id.slice(0, -1), profile.capabilities[0]), false, profile.id);
    }
  });

  it("declares each role once with a non-empty, duplicate-free capability set", () => {
    const ids = roleProfiles.map((profile) => profile.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate role id shadows a profile");
    for (const profile of roleProfiles) {
      assert.ok(profile.capabilities.length > 0, profile.id);
      assert.equal(
        new Set(profile.capabilities).size,
        profile.capabilities.length,
        `${profile.id} lists a capability twice`
      );
    }
  });

  it("maps every subject-timeline kind to the capability its own route enforces", () => {
    // A domain-confused remapping (withdrawal -> kyc:read, audit -> checks:read)
    // stays invisible to role-level tests whenever both capabilities happen to
    // be co-granted, so the mapping is pinned literally here.
    assert.deepEqual({ ...subjectTimelineKindCapability }, {
      check: "checks:read",
      support: "support:read",
      withdrawal: "custody:read",
      kyc: "kyc:read",
      aml: "aml:read",
      investigation: "investigations:read",
      "fraud-alert": "fraud:read",
      audit: "audit:read"
    });
    const routeCaps = new Set(
      routeGateCalls().flatMap((call) => call.capability ? [call.capability] : [])
    );
    for (const capability of Object.values(subjectTimelineKindCapability)) {
      assert.ok(routeCaps.has(capability), `timeline kind maps to unenforced ${capability}`);
    }
  });

  it("binds every declared role to its profile on the dev-session path", async () => {
    // The dev-session role set and the profile table must not drift: a role in
    // roleProfiles that dev-session cannot mint would be a dead login, and a
    // session minted for anything else would bypass the profile table.
    for (const profile of roleProfiles) {
      const cookie = await devSession(profile.id);
      const response = await fetch(`${baseUrl}/bff/api/session`, {
        headers: { cookie }
      });
      assert.equal(response.status, 200, profile.id);
      const operator = (await response.json() as {
        payload: { operator: { role: string; name: string; capabilities: readonly string[] } };
      }).payload.operator;
      assert.equal(operator.role, profile.id);
      assert.equal(operator.name, profile.operator);
      assert.deepEqual(operator.capabilities, profile.capabilities);
    }
  });

  it("rejects dev-session roles the profile table does not declare", async () => {
    for (const role of [
      "admin",
      "root",
      "operator",
      "COMPLIANCE-LEAD",
      "compliance_lead",
      " compliance-lead",
      "compliance-lead ",
      "support",
      "__proto__",
      "constructor",
      "toString",
      "",
      "null",
      "undefined"
    ]) {
      const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ role })
      });
      assert.equal(response.status, 400, JSON.stringify(role));
      assert.deepEqual(await response.json(), { error: "unsupported_role" });
    }
  });

  it("accepts every declared role as an OIDC role-map target and rejects others", () => {
    const env = {
      BACKOFFICE_ALLOWED_ORIGINS: origin,
      BACKOFFICE_OIDC_ISSUER: "https://idp.example.test",
      BACKOFFICE_OIDC_AUTHORIZATION_ENDPOINT: "https://idp.example.test/authorize",
      BACKOFFICE_OIDC_TOKEN_ENDPOINT: "https://idp.example.test/token",
      BACKOFFICE_OIDC_JWKS_URI: "https://idp.example.test/jwks.json",
      BACKOFFICE_OIDC_CLIENT_ID: "backoffice-dev",
      BACKOFFICE_OIDC_REDIRECT_URI: `${origin}/bff/auth/callback`,
      BACKOFFICE_OIDC_ROLE_MAP_JSON: "",
      NODE_ENV: "",
      BACKOFFICE_MODE: ""
    };
    const names = Object.keys(env);
    const saved = new Map(names.map((name) => [name, process.env[name]]));
    const withRoleMap = (roleMap: Record<string, string>) => {
      for (const [name, value] of Object.entries(env)) process.env[name] = value;
      delete process.env.NODE_ENV;
      delete process.env.BACKOFFICE_MODE;
      process.env.BACKOFFICE_OIDC_ROLE_MAP_JSON = JSON.stringify(roleMap);
      return loadServerConfig();
    };
    try {
      for (const profile of roleProfiles) {
        const config = withRoleMap({ "corp-directory-group": profile.id });
        assert.equal(config.oidc?.roleMap["corp-directory-group"], profile.id);
      }
      for (const role of ["admin", "superuser", "support", "auditor ", ""]) {
        assert.throws(() => withRoleMap({ group: role }), /Unsupported backoffice role/, role);
      }
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("never derives operator identity or role from request headers", async () => {
    const spoofHeaders: Record<string, string>[] = [
      { "x-operator-role": "compliance-lead" },
      { "x-role": "compliance-lead" },
      { "x-operator": "compliance-lead" },
      { "x-user": "compliance-lead" },
      { "x-backoffice-role": "compliance-lead" },
      { operator: "compliance-lead" },
      { "x-operator-role": "compliance-lead", "x-role": "compliance-lead" }
    ];
    for (const headers of spoofHeaders) {
      const response = await fetch(`${baseUrl}/bff/api/dashboard`, { headers });
      assert.equal(response.status, 401, JSON.stringify(headers));
    }

    // A real session cannot escalate itself through identity headers either:
    // the role comes from the server-side session object only.
    const cookie = await devSession("support-l1");
    const denied = await fetch(`${baseUrl}/bff/api/approvals`, {
      headers: { cookie, "x-operator-role": "compliance-lead", "x-role": "compliance-lead" }
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: "capability_denied" });
    const session = await fetch(`${baseUrl}/bff/api/session`, {
      headers: { cookie, "x-operator-role": "compliance-lead" }
    });
    const operator = (await session.json() as {
      payload: { operator: { role: string } };
    }).payload.operator;
    assert.equal(operator.role, "support-l1");

    // Role or session material under a different cookie name is not identity.
    const confused = await fetch(`${baseUrl}/bff/api/dashboard`, {
      headers: { cookie: "solidchange_bo_role=compliance-lead" }
    });
    assert.equal(confused.status, 401);
  });
});
