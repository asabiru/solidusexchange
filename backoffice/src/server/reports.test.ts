import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { demoRepository } from "../data/demo.js";
import type { DraftReport, ReportExportPayload, ReportListPayload } from "../data/reports.js";
import { buildAuditChain } from "./controls.js";
import { buildKycEvidence, buildKytEvidence } from "./provider-evidence.js";
import {
  ageBucket,
  buildReport,
  buildReportExport,
  csvCell,
  formatDecimal,
  listReports,
  parseDecimal,
  reportCsv,
  reportPeriod,
  rubExposureUnits,
  type ReportInputs
} from "./reports.js";
import { createBackofficeServer } from "./server.js";

const origin = "http://127.0.0.1:4173";
const generatedAt = "2026-09-28T14:00:00.000Z";
const reportIds = ["kyc-queue-daily", "aml-kyt-alerts", "maker-checker-approvals"] as const;

async function inputs(): Promise<ReportInputs> {
  return {
    repository: demoRepository,
    kycEvidence: await buildKycEvidence(),
    kytEvidence: await buildKytEvidence(),
    auditEvents: buildAuditChain(demoRepository.auditSource())
  };
}

function assertDraft(value: {
  status: string;
  not_for_submission: boolean;
  environment: string;
  generatedAt: string;
  period: unknown;
}): void {
  assert.equal(value.status, "draft");
  assert.equal(value.not_for_submission, true);
  assert.equal(value.environment, "dev-synthetic");
  assert.match(value.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(value.period, reportPeriod);
}

function row(report: DraftReport, sectionId: string, key: string): string | number | undefined {
  return report.sections.find((item) => item.id === sectionId)?.rows.find((item) => item.key === key)?.value;
}

function piiFragments(): string[] {
  return [
    ...demoRepository.kycCases().flatMap((item) => [item.subject, item.customerId]),
    ...demoRepository.amlCases().flatMap((item) => [item.subject, item.customerId, item.owner]),
    ...demoRepository.approvals().map((item) => item.maker)
  ];
}

describe("draft compliance report builders", () => {
  it("lists every report with draft markers", () => {
    const list = listReports(generatedAt);
    assertDraft(list);
    assert.deepEqual(list.reports.map((item) => item.id), reportIds);
    for (const item of list.reports) assertDraft(item);
  });

  it("builds each report deterministically with draft invariants", async () => {
    const first = await inputs();
    const second = await inputs();
    for (const id of reportIds) {
      const report = buildReport(id, first, generatedAt);
      assertDraft(report);
      assert.equal(report.id, id);
      assert.equal(report.formatVersion, 1);
      assert.equal(report.dataSource, "synthetic");
      assert.equal(report.decisionAuthority, "none");
      assert.match(report.contentDigest, /^[a-f0-9]{64}$/);
      assert.ok(report.sections.length > 0);
      for (const table of report.tables) {
        for (const tableRow of table.rows) assert.equal(tableRow.length, table.columns.length);
      }
      assert.deepEqual(buildReport(id, second, generatedAt), report);
      const later = buildReport(id, second, "2026-10-01T00:00:00.000Z");
      assert.equal(later.contentDigest, report.contentDigest);
      assert.deepEqual(later.sections, report.sections);
      assert.equal(reportCsv(buildReport(id, second, generatedAt)), reportCsv(report));
    }
  });

  it("summarises the KYC queue by status, age bucket and SLA", async () => {
    const report = buildReport("kyc-queue-daily", await inputs(), generatedAt);
    const cases = demoRepository.kycCases();
    assert.equal(row(report, "totals", "cases"), cases.length);
    const byStatus = report.sections.find((item) => item.id === "by_status")?.rows ?? [];
    assert.deepEqual(byStatus.map((item) => item.key), ["verified", "need-info", "review"]);
    assert.equal(byStatus.reduce((sum, item) => sum + Number(item.value), 0), cases.length);
    const open = cases.filter((item) => item.status !== "verified").length;
    assert.equal(row(report, "totals", "open"), open);
    const byAge = report.sections.find((item) => item.id === "by_age_bucket")?.rows ?? [];
    assert.deepEqual(byAge.map((item) => item.key), ["lt_4h", "4h_8h", "8h_24h", "gte_24h"]);
    assert.equal(byAge.reduce((sum, item) => sum + Number(item.value), 0), open);
    const table = report.tables[0];
    const breached = table.rows.filter((item) => item[table.columns.indexOf("sla_breached")] === "true");
    assert.equal(row(report, "totals", "sla_breaches"), breached.length);
    assert.ok(Number(row(report, "provider_evidence", "needs_review")) > 0);
    assert.equal(ageBucket(239), "lt_4h");
    assert.equal(ageBucket(240), "4h_8h");
    assert.equal(ageBucket(1_440), "gte_24h");
  });

  it("flags AML/KYT provider evidence mismatches as needs review", async () => {
    const report = buildReport("aml-kyt-alerts", await inputs(), generatedAt);
    const cases = demoRepository.amlCases();
    assert.equal(row(report, "totals", "alerts"), cases.length);
    assert.equal(Number(row(report, "totals", "open")) + Number(row(report, "totals", "closed")), cases.length);
    const byRisk = report.sections.find((item) => item.id === "by_risk")?.rows ?? [];
    const byScenario = report.sections.find((item) => item.id === "by_scenario")?.rows ?? [];
    assert.equal(byRisk.reduce((sum, item) => sum + Number(item.value), 0), cases.length);
    assert.equal(byScenario.reduce((sum, item) => sum + Number(item.value), 0), cases.length);
    const evidence = report.tables.find((item) => item.id === "provider_evidence");
    assert.ok(evidence);
    const review = evidence.columns.indexOf("review");
    const flagged = evidence.rows.filter((item) => item[review].startsWith("needs_review:"));
    assert.equal(row(report, "totals", "provider_needs_review"), flagged.length);
    const sanctions = evidence.rows.find((item) => item[0] === "PEV-KYT-02");
    assert.match(sanctions?.[review] ?? "", /^needs_review:.*callback_rejections/);
    const outage = evidence.rows.find((item) => item[0] === "PEV-KYT-04");
    assert.match(outage?.[review] ?? "", /provider_outage/);
    assert.match(String(row(report, "totals", "open_exposure")), /^\d+\.\d{2}$/);
  });

  it("summarises maker-checker approvals as preview-only", async () => {
    const report = buildReport("maker-checker-approvals", await inputs(), generatedAt);
    const approvals = demoRepository.approvals();
    assert.equal(row(report, "totals", "approvals"), approvals.length);
    assert.equal(row(report, "totals", "executable"), 0);
    const expected = approvals.reduce((sum, item) => sum + item.requiredApprovals - item.completedApprovals, 0);
    assert.equal(row(report, "totals", "outstanding_signoffs"), expected);
    const table = report.tables.find((item) => item.id === "approvals");
    assert.ok(table);
    assert.ok(table.rows.every((item) => item[table.columns.indexOf("executable")] === "false"));
    const audit = report.tables.find((item) => item.id === "approval_audit_events");
    assert.ok(audit && audit.rows.length > 0);
    assert.ok(audit.rows.every((item) => item[3].startsWith("approval.")));
    assert.match(String(row(report, "totals", "rub_exposure_under_review")), /^\d+\.\d{2}$/);
  });

  it("keeps amounts decimal-safe without floats", () => {
    assert.equal(parseDecimal("0.1", 6) + parseDecimal("0.2", 6), parseDecimal("0.3", 6));
    assert.equal(formatDecimal(parseDecimal("1250.75", 9), 9), "1250.750000000");
    assert.equal(formatDecimal(5n, 2), "0.05");
    assert.equal(rubExposureUnits("6 420 000 ₽"), 642_000_000n);
    assert.equal(rubExposureUnits("2 жалобы"), undefined);
    assert.throws(() => parseDecimal("1e3", 2));
    assert.throws(() => parseDecimal("0.001", 2));
  });

  it("does not leak synthetic customer names or identifiers", async () => {
    const source = await inputs();
    for (const id of reportIds) {
      const report = buildReport(id, source, generatedAt);
      const text = `${JSON.stringify(report)}\n${reportCsv(report)}`;
      for (const fragment of piiFragments()) assert.equal(text.includes(fragment), false, fragment);
    }
  });

  it("neutralises CSV formula injection and quotes fields", () => {
    for (const prefix of ["=", "+", "-", "@"]) {
      assert.equal(csvCell(`${prefix}HYPERLINK(1)`), `'${prefix}HYPERLINK(1)`);
    }
    assert.equal(csvCell(" =1+2"), "' =1+2");
    assert.equal(csvCell("\tcmd"), "'\tcmd");
    assert.equal(csvCell("=SUM(A1,B1)"), "\"'=SUM(A1,B1)\"");
    assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
    assert.equal(csvCell("line\nbreak"), "\"line\nbreak\"");
    assert.equal(csvCell("KYC-220184"), "KYC-220184");
    assert.equal(csvCell(42), "42");
  });

  it("exports CSV with draft markers on every report", async () => {
    const source = await inputs();
    for (const id of reportIds) {
      const exported = buildReportExport(buildReport(id, source, generatedAt));
      assertDraft(exported);
      assert.equal(exported.mediaType, "text/csv; charset=utf-8");
      assert.match(exported.filename, new RegExp(`^solidchange-draft-${id}-[a-f0-9]{12}\\.csv$`));
      const lines = exported.csv.split("\r\n");
      assert.match(lines[1], /^notice,Черновик — не для подачи регулятору/);
      assert.ok(lines.includes("status,draft"));
      assert.ok(lines.includes("not_for_submission,true"));
      assert.ok(lines.includes("environment,dev-synthetic"));
      for (const line of lines) {
        for (const cell of line.split(",")) assert.doesNotMatch(cell, /^"?[=+\-@]/);
      }
    }
  });
});

describe("draft compliance report routes", () => {
  let server: Server;
  let baseUrl: string;

  async function devSession(role: string): Promise<string> {
    const response = await fetch(`${baseUrl}/bff/auth/dev-session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ role })
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie);
    return cookie.split(";")[0];
  }

  async function auditActions(cookie: string): Promise<{ action: string; resource: string; actor: string }[]> {
    const response = await fetch(`${baseUrl}/bff/api/audit`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const envelope = await response.json() as {
      payload: { chain: { verified: boolean }; events: { action: string; resource: string; actor: string }[] };
    };
    assert.equal(envelope.payload.chain.verified, true);
    return envelope.payload.events;
  }

  before(async () => {
    server = createBackofficeServer({
      host: "127.0.0.1",
      port: 0,
      allowedOrigins: [origin],
      allowDevLogin: true,
      sessionTtlSeconds: 900,
      audit: { storage: "memory", retentionDays: 30 },
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

  it("requires an operator session and the reports capability", async () => {
    for (const path of ["/bff/api/reports", "/bff/api/reports/kyc-queue-daily", "/bff/api/reports/kyc-queue-daily/export"]) {
      const anonymous = await fetch(`${baseUrl}${path}`);
      assert.equal(anonymous.status, 401);
      assert.deepEqual(await anonymous.json(), { error: "operator_session_required" });
      for (const role of ["support-l1", "aml-investigator", "fraud-investigator"]) {
        const denied = await fetch(`${baseUrl}${path}`, { headers: { cookie: await devSession(role) } });
        assert.equal(denied.status, 403);
        assert.deepEqual(await denied.json(), { error: "capability_denied" });
      }
    }
  });

  it("serves signed draft list, detail and CSV export", async () => {
    const cookie = await devSession("auditor");
    const listResponse = await fetch(`${baseUrl}/bff/api/reports`, { headers: { cookie } });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("cache-control"), "no-store");
    const list = await listResponse.json() as { resource: string; signature: string; payload: ReportListPayload };
    assert.equal(list.resource, "reports");
    assert.ok(list.signature);
    assertDraft(list.payload);
    assert.deepEqual(list.payload.reports.map((item) => item.id), reportIds);

    for (const id of reportIds) {
      const detail = await fetch(`${baseUrl}/bff/api/reports/${id}`, { headers: { cookie } });
      assert.equal(detail.status, 200);
      const envelope = await detail.json() as { resource: string; signature: string; payload: DraftReport };
      assert.equal(envelope.resource, `report:${id}`);
      assert.ok(envelope.signature);
      assertDraft(envelope.payload);
      assert.equal(envelope.payload.decisionAuthority, "none");

      const repeat = await fetch(`${baseUrl}/bff/api/reports/${id}`, { headers: { cookie } });
      const repeated = await repeat.json() as { payload: DraftReport };
      assert.equal(repeated.payload.contentDigest, envelope.payload.contentDigest);
      assert.deepEqual(repeated.payload.sections, envelope.payload.sections);

      const exported = await fetch(`${baseUrl}/bff/api/reports/${id}/export`, { headers: { cookie } });
      assert.equal(exported.status, 200);
      const csvEnvelope = await exported.json() as { resource: string; payload: ReportExportPayload };
      assert.equal(csvEnvelope.resource, `report-export:${id}`);
      assertDraft(csvEnvelope.payload);
      assert.equal(csvEnvelope.payload.contentDigest, envelope.payload.contentDigest);
      assert.match(csvEnvelope.payload.csv, /^field,value\r\nnotice,Черновик — не для подачи регулятору/);
    }
  });

  it("writes an audit event for every report access", async () => {
    const cookie = await devSession("compliance-lead");
    const before = (await auditActions(cookie)).length;
    assert.equal((await fetch(`${baseUrl}/bff/api/reports/aml-kyt-alerts`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/bff/api/reports/aml-kyt-alerts/export`, { headers: { cookie } })).status, 200);
    const events = await auditActions(cookie);
    assert.equal(events.length, before + 2);
    assert.deepEqual(events.slice(-2).map((item) => [item.action, item.resource, item.actor]), [
      ["report.viewed", "report:aml-kyt-alerts", "dev:compliance-lead"],
      ["report.exported", "report:aml-kyt-alerts", "dev:compliance-lead"]
    ]);

    const denied = await fetch(`${baseUrl}/bff/api/reports/aml-kyt-alerts`, {
      headers: { cookie: await devSession("support-l1") }
    });
    assert.equal(denied.status, 403);
    assert.equal((await auditActions(cookie)).length, before + 2);
  });

  it("exposes no write routes and rejects unknown reports", async () => {
    const cookie = await devSession("compliance-lead");
    const before = (await auditActions(cookie)).length;
    for (const path of ["/bff/api/reports", "/bff/api/reports/kyc-queue-daily", "/bff/api/reports/kyc-queue-daily/export"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ status: "approved", submit: true })
        });
        assert.ok([404, 405].includes(response.status), `${method} ${path}`);
      }
    }
    for (const path of ["/bff/api/reports/unknown", "/bff/api/reports/%E0%A4%A", "/bff/api/reports/kyc-queue-daily/submit"]) {
      const response = await fetch(`${baseUrl}${path}`, { headers: { cookie } });
      assert.equal(response.status, 404, path);
    }
    assert.equal((await auditActions(cookie)).length, before);
  });
});
