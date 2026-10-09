import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { sha256 } from "./controls.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
const subjectRef = "sim-alina-mironova";
const subjectKinds = new Set([
  "check",
  "support",
  "withdrawal",
  "kyc",
  "aml",
  "investigation",
  "fraud-alert",
  "audit"
]);
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

describe("subject timeline BFF", () => {
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

  it("requires an operator session", async () => {
    const response = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "operator_session_required" });
  });

  it("denies roles without the subjects:read capability", async () => {
    const cookie = await devSession("fraud-investigator");
    const response = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
      headers: { cookie }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "capability_denied" });
  });

  it("serves a signed read-only timeline to authorized roles", async () => {
    for (const role of ["compliance-lead", "support-l1", "aml-investigator", "auditor"]) {
      const cookie = await devSession(role);
      const response = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
        headers: { cookie }
      });
      assert.equal(response.status, 200, role);
      const envelope = await response.json() as {
        resource: string;
        payload: {
          subject: string;
          entries: readonly { at: string; kind: string; ref: string; summary: string }[];
        };
      };
      assert.equal(envelope.resource, `subject-timeline:${subjectRef}`);
      assert.equal(envelope.payload.subject, subjectRef);
      assert.ok(envelope.payload.entries.length > 0, role);
      for (const entry of envelope.payload.entries) {
        assert.ok(subjectKinds.has(entry.kind), entry.kind);
        assert.ok(entry.ref.length > 0);
        assert.ok(entry.summary.length > 0);
        assert.ok(!Number.isNaN(Date.parse(entry.at)), entry.at);
      }
      const kinds = new Set(envelope.payload.entries.map((entry) => entry.kind));
      for (const expected of ["check", "support", "withdrawal", "kyc", "aml", "investigation", "fraud-alert", "audit"]) {
        assert.ok(kinds.has(expected), `${role}: missing ${expected}`);
      }
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("resolves customer ids to the same feed deterministically", async () => {
    const cookie = await devSession("compliance-lead");
    const bySubject = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
      headers: { cookie }
    });
    const byCustomer = await fetch(`${baseUrl}/bff/api/subjects/CUS-10482/timeline`, {
      headers: { cookie }
    });
    assert.equal(byCustomer.status, 200);
    const subjectEntries = (await bySubject.json() as {
      payload: { entries: readonly { ref: string }[] };
    }).payload.entries;
    const customerEntries = (await byCustomer.json() as {
      payload: { entries: readonly { ref: string }[] };
    }).payload.entries;
    assert.deepEqual(customerEntries, subjectEntries);
  });

  it("orders entries newest first with a stable tie-break", async () => {
    const cookie = await devSession("support-l1");
    const first = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
      headers: { cookie }
    });
    const second = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
      headers: { cookie }
    });
    const firstEntries = (await first.json() as {
      payload: { entries: readonly { at: string; kind: string; ref: string }[] };
    }).payload.entries;
    const secondEntries = (await second.json() as {
      payload: { entries: readonly { at: string; kind: string; ref: string }[] };
    }).payload.entries;
    assert.deepEqual(secondEntries, firstEntries);
    for (let index = 1; index < firstEntries.length; index += 1) {
      const previous = firstEntries[index - 1];
      const current = firstEntries[index];
      assert.ok(
        previous.at > current.at
        || (previous.at === current.at
          && (previous.kind < current.kind
            || (previous.kind === current.kind && previous.ref <= current.ref))),
        `${previous.at}/${previous.kind}/${previous.ref} before ${current.at}/${current.kind}/${current.ref}`
      );
    }
  });

  it("keeps other subjects' entities out of the feed", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/subjects/sim-nikita-serov/timeline`, {
      headers: { cookie }
    });
    assert.equal(response.status, 200);
    const entries = (await response.json() as {
      payload: { entries: readonly { ref: string }[] };
    }).payload.entries;
    const refs = new Set(entries.map((entry) => entry.ref));
    assert.ok(refs.has("SUP-384087"));
    assert.ok(refs.has("WDR-991817"));
    assert.ok(refs.has("KYC-220177"));
    assert.ok(refs.has("INV-43014"));
    assert.ok(refs.has("FRD-61072"));
    assert.ok(!refs.has("CHK-771312"));
    assert.ok(!refs.has("SUP-384120"));
    assert.ok(!refs.has("WDR-991804"));
    assert.ok(!refs.has("KYC-220184"));
    assert.ok(!refs.has("INV-43018"));
  });

  it("appends a subject.timeline.viewed audit event with subject and entry count", async () => {
    const cookie = await devSession("auditor");
    const response = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
      headers: { cookie }
    });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      payload: { subject: string; entries: readonly unknown[] };
    };

    const audit = await fetch(`${baseUrl}/bff/api/audit`, { headers: { cookie } });
    const auditPayload = (await audit.json() as {
      payload: {
        events: readonly {
          action: string;
          resource: string;
          outcome: string;
          actor: string;
          evidenceDigest: string;
        }[];
      };
    }).payload;
    const views = auditPayload.events.filter((event) => event.action === "subject.timeline.viewed");
    assert.ok(views.length > 0);
    const view = views[views.length - 1];
    assert.equal(view.resource, `subject:${subjectRef}`);
    assert.equal(view.outcome, "recorded");
    assert.equal(view.actor, "dev:auditor");
    assert.equal(
      view.evidenceDigest,
      `sha256:${sha256({ subject: subjectRef, entries: envelope.payload.entries.length })}`
    );
    // The audit event carries the structured ref and count — never the raw
    // request path or query string.
    assert.ok(!view.resource.includes("/"));
    assert.ok(!view.resource.includes("?"));
    assert.ok(!view.resource.includes("&"));
  });

  it("rejects malformed subject refs with invalid_subject_ref", async () => {
    const cookie = await devSession("compliance-lead");
    for (const ref of ["abc", "x".repeat(65), "has%20space!", "bad%25E0%25A4%25A"]) {
      const response = await fetch(`${baseUrl}/bff/api/subjects/${ref}/timeline`, {
        headers: { cookie }
      });
      assert.equal(response.status, 400, ref);
      assert.deepEqual(await response.json(), { error: "invalid_subject_ref" });
    }
  });

  it("returns subject_not_found for undecodable or unmatched refs", async () => {
    const cookie = await devSession("compliance-lead");
    const malformed = await fetch(`${baseUrl}/bff/api/subjects/%E0%A4%A/timeline`, {
      headers: { cookie }
    });
    assert.equal(malformed.status, 404);
    assert.deepEqual(await malformed.json(), { error: "subject_not_found" });

    for (const ref of ["sim-ghost-404", "cust_missing_01"]) {
      const response = await fetch(`${baseUrl}/bff/api/subjects/${ref}/timeline`, {
        headers: { cookie }
      });
      assert.equal(response.status, 404, ref);
      // A single generic error — no hint about which entity types were searched.
      assert.deepEqual(await response.json(), { error: "subject_not_found" });
    }
  });

  it("rejects cross-site fetches before serving timeline data", async () => {
    const cookie = await devSession("compliance-lead");
    const response = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
      headers: { cookie, "sec-fetch-site": "cross-site" }
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "fetch_site_rejected" });
  });

  it("accepts no mutation verbs on the timeline route", async () => {
    const cookie = await devSession("compliance-lead");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${baseUrl}/bff/api/subjects/${subjectRef}/timeline`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: "{}"
      });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), "GET");
      assert.deepEqual(await response.json(), { error: "method_not_allowed" });
    }
  });
});
