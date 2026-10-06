import type {
  AuditEvent,
  AuditSourceEvent,
  ReadonlyBackofficeRepository
} from "../data/demo.js";
import type {
  KycProviderEvidence,
  KytProviderEvidence,
  ProviderEvidenceFeed
} from "../data/provider-evidence.js";
import type {
  DraftReport,
  ReportDefinition,
  ReportExportPayload,
  ReportId,
  ReportListPayload,
  ReportPeriod,
  ReportRow,
  ReportSection
} from "../data/reports.js";
import { sha256 } from "./controls.js";

// Draft compliance reports over synthetic data only. They summarise queues and
// evidence for operator review; they are never a regulatory submission and
// carry no decision authority.

export const reportPeriod: ReportPeriod = Object.freeze({
  from: "2026-09-28T00:00:00.000Z",
  to: "2026-09-29T00:00:00.000Z",
  asOf: "2026-09-28T14:00:00.000Z",
  timezone: "UTC"
});

export const kycSlaTargetMinutes = 360;

export const draftNotice = "Черновик — не для подачи регулятору · DRAFT — NOT FOR SUBMISSION · synthetic dev data";

const catalog: readonly { id: ReportId; title: string; description: string }[] = Object.freeze([
  {
    id: "kyc-queue-daily",
    title: "KYC queue · daily summary",
    description: "Cases by status, type and age bucket with synthetic SLA breaches"
  },
  {
    id: "aml-kyt-alerts",
    title: "AML / KYT alert summary",
    description: "Alerts by risk and scenario, open vs closed, provider evidence needing review"
  },
  {
    id: "maker-checker-approvals",
    title: "Maker-checker approvals summary",
    description: "Approval states, outstanding sign-offs, evidence gaps and approval audit events"
  }
]);

export interface ReportInputs {
  repository: ReadonlyBackofficeRepository;
  kycEvidence: ProviderEvidenceFeed<KycProviderEvidence>;
  kytEvidence: ProviderEvidenceFeed<KytProviderEvidence>;
  auditEvents: readonly AuditEvent[];
}

type ReportContent = Pick<DraftReport, "sections" | "tables">;

const assetScales: Readonly<Record<string, number>> = Object.freeze({ RUB: 2, USDT: 6, TON: 9 });

function scaleOf(asset: string): number {
  if (!Object.hasOwn(assetScales, asset)) throw new Error("Unsupported synthetic report asset");
  return assetScales[asset];
}

export function parseDecimal(value: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > scale) {
    throw new Error("Synthetic report amount is not a decimal string");
  }
  return BigInt(match[1] + (match[2] ?? "").padEnd(scale, "0"));
}

export function formatDecimal(units: bigint, scale: number): string {
  if (units < 0n) throw new Error("Synthetic report totals must not be negative");
  const digits = units.toString().padStart(scale + 1, "0");
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function rubExposureUnits(exposure: string): bigint | undefined {
  const compact = exposure.replace(/[\s\u00a0\u202f]/g, "");
  const match = /^(\d+(?:\.\d{1,2})?)₽$/.exec(compact);
  return match ? parseDecimal(match[1], scaleOf("RUB")) : undefined;
}

function counts(values: readonly string[], order: readonly string[] = []): ReportRow[] {
  const keys = [...order, ...[...new Set(values)].filter((value) => !order.includes(value)).sort()];
  return keys.map((key) => ({
    key,
    value: values.filter((value) => value === key).length,
    unit: "count"
  }));
}

function count(key: string, value: number): ReportRow {
  return { key, value, unit: "count" };
}

function section(id: string, title: string, rows: readonly ReportRow[]): ReportSection {
  return { id, title, rows };
}

function ageMinutes(openedAt: string): number {
  const opened = Date.parse(openedAt);
  const asOf = Date.parse(reportPeriod.asOf);
  if (Number.isNaN(opened) || opened > asOf) throw new Error("Synthetic case opened outside the report period");
  return Math.floor((asOf - opened) / 60_000);
}

export function ageBucket(minutes: number): string {
  if (minutes < 240) return "lt_4h";
  if (minutes < 480) return "4h_8h";
  if (minutes < 1_440) return "8h_24h";
  return "gte_24h";
}

const ageBuckets = ["lt_4h", "4h_8h", "8h_24h", "gte_24h"] as const;

const kycProviderStatus: Readonly<Record<string, string>> = Object.freeze({
  verified: "approved",
  "need-info": "needs_more_data",
  review: "in_review"
});

const kytExpectedRisk: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Critical: ["severe"],
  High: ["high", "severe"],
  Medium: ["medium"],
  Low: ["low"]
});

function evidenceReviewReasons(
  evidence: KycProviderEvidence | KytProviderEvidence
): string[] {
  return [
    ...(evidence.verification.rejected > 0 ? ["callback_rejections"] : []),
    ...(evidence.outage ? ["provider_outage"] : []),
    ...(evidence.timedOut ? ["timed_out"] : []),
    ...(evidence.lateEvents > 0 ? ["late_callback"] : []),
    ...(evidence.verification.heldForReview > 0 ? ["held_callbacks"] : [])
  ];
}

function kycReport(inputs: ReportInputs): ReportContent {
  const cases = inputs.repository.kycCases();
  const evidence = inputs.kycEvidence.cases;
  const rows = cases.map((item) => {
    const minutes = ageMinutes(item.openedAt);
    const open = item.status !== "verified";
    const linked = evidence.find((candidate) => candidate.linkedCaseId === item.id);
    const reasons = linked ? evidenceReviewReasons(linked) : [];
    if (
      linked
      && (!Object.hasOwn(kycProviderStatus, item.status)
        || kycProviderStatus[item.status] !== linked.projectedStatus)
    ) reasons.push("status_mismatch");
    return {
      item,
      minutes,
      open,
      breached: open && minutes >= kycSlaTargetMinutes,
      linked,
      reasons
    };
  });
  const feedNeedsReview = evidence.filter((item) => {
    if (evidenceReviewReasons(item).length) return true;
    return rows.some((row) => row.linked?.id === item.id && row.reasons.length > 0);
  });
  return {
    sections: [
      section("totals", "Totals", [
        count("cases", rows.length),
        count("open", rows.filter((row) => row.open).length),
        count("closed", rows.filter((row) => !row.open).length),
        count("sla_breaches", rows.filter((row) => row.breached).length),
        { key: "sla_target", value: kycSlaTargetMinutes, unit: "minutes" }
      ]),
      section("by_status", "By status", counts(cases.map((item) => item.status), ["verified", "need-info", "review"])),
      section("by_type", "By type", counts(cases.map((item) => item.type), ["KYC", "KYB"])),
      section(
        "by_age_bucket",
        "Open cases by age",
        counts(rows.filter((row) => row.open).map((row) => ageBucket(row.minutes)), ageBuckets)
      ),
      section("provider_evidence", "Provider evidence (simulator)", [
        count("feed_items", evidence.length),
        count("linked_to_cases", rows.filter((row) => row.linked).length),
        count("needs_review", feedNeedsReview.length)
      ])
    ],
    tables: [
      {
        id: "cases",
        title: "Cases",
        columns: [
          "case_id",
          "type",
          "status",
          "open",
          "opened_at",
          "age_minutes",
          "age_bucket",
          "sla_breached",
          "provider_evidence",
          "review"
        ],
        rows: rows.map((row) => [
          row.item.id,
          row.item.type,
          row.item.status,
          String(row.open),
          row.item.openedAt,
          String(row.minutes),
          ageBucket(row.minutes),
          String(row.breached),
          row.linked?.id ?? "",
          row.reasons.length ? `needs_review:${row.reasons.join(";")}` : "consistent"
        ])
      }
    ]
  };
}

function amlReport(inputs: ReportInputs): ReportContent {
  const cases = inputs.repository.amlCases();
  const evidence = inputs.kytEvidence.cases;
  const evidenceRows = evidence.map((item) => {
    const linked = cases.find((candidate) => candidate.id === item.linkedCaseId);
    const reasons = evidenceReviewReasons(item);
    if (linked && item.riskLevel !== null) {
      const expected = Object.hasOwn(kytExpectedRisk, linked.severity) ? kytExpectedRisk[linked.severity] : [];
      if (!expected.includes(item.riskLevel)) reasons.push("risk_mismatch");
    }
    if (linked && item.sanctionsHit === true && linked.source !== "Sanctions") reasons.push("sanctions_mismatch");
    return { item, linked, reasons };
  });
  let openExposure = 0n;
  let nonMonetary = 0;
  for (const item of cases) {
    const units = rubExposureUnits(item.exposure);
    if (units === undefined) nonMonetary += 1;
    else openExposure += units;
  }
  const screened = new Map<string, bigint>();
  for (const { item } of evidenceRows) {
    const scale = scaleOf(item.asset);
    screened.set(item.asset, (screened.get(item.asset) ?? 0n) + parseDecimal(item.amount, scale));
  }
  const needsReview = evidenceRows.filter((row) => row.reasons.length > 0);
  return {
    sections: [
      section("totals", "Totals", [
        count("alerts", cases.length),
        count("open", cases.length),
        count("closed", 0),
        count("provider_needs_review", needsReview.length),
        { key: "open_exposure", value: formatDecimal(openExposure, scaleOf("RUB")), unit: "RUB" },
        count("non_monetary_exposure", nonMonetary)
      ]),
      section("by_risk", "By risk", counts(cases.map((item) => item.severity), ["Critical", "High", "Medium", "Low"])),
      section(
        "by_scenario",
        "By scenario",
        counts(cases.map((item) => item.source), ["KYT", "Sanctions", "PEP", "Behavior"])
      ),
      section("by_state", "By state", counts(cases.map((item) => item.state), ["open", "review", "escalated"])),
      section(
        "provider_by_risk",
        "Provider risk (simulator)",
        counts(evidence.map((item) => item.riskLevel ?? "not_screened"), ["low", "medium", "high", "severe", "not_screened"])
      ),
      section(
        "provider_screened_amounts",
        "Screened amounts (simulator)",
        [...screened.keys()].sort().map((asset) => ({
          key: asset,
          value: formatDecimal(screened.get(asset) ?? 0n, scaleOf(asset)),
          unit: asset === "USDT" ? "USDT" : "TON"
        }))
      )
    ],
    tables: [
      {
        id: "alerts",
        title: "Alerts",
        columns: ["case_id", "scenario", "risk", "state", "open", "opened_at", "exposure_rub", "provider_evidence"],
        rows: cases.map((item) => {
          const units = rubExposureUnits(item.exposure);
          return [
            item.id,
            item.source,
            item.severity,
            item.state,
            "true",
            item.openedAt,
            units === undefined ? "" : formatDecimal(units, scaleOf("RUB")),
            evidence.find((candidate) => candidate.linkedCaseId === item.id)?.id ?? ""
          ];
        })
      },
      {
        id: "provider_evidence",
        title: "Provider evidence (simulator)",
        columns: [
          "evidence_id",
          "linked_case",
          "case_risk",
          "provider_risk",
          "scenario",
          "asset",
          "amount",
          "verification",
          "review"
        ],
        rows: evidenceRows.map(({ item, linked, reasons }) => [
          item.id,
          item.linkedCaseId ?? "",
          linked?.severity ?? "",
          item.riskLevel ?? "not_screened",
          item.scenario,
          item.asset,
          item.amount,
          item.verification.result,
          reasons.length ? `needs_review:${reasons.join(";")}` : "consistent"
        ])
      }
    ]
  };
}

// Customer references are pseudonymous but still link to a person; draft
// reports keep only the resource type.
export function reportResource(resource: string): string {
  return resource.startsWith("customer:") ? "customer:redacted" : resource;
}

function makerKind(subject: string): string {
  const prefix = subject.split(":")[0];
  return ["service", "operator", "dev"].includes(prefix) ? prefix : "other";
}

function approvalsReport(inputs: ReportInputs): ReportContent {
  const approvals = inputs.repository.approvals();
  const auditEvents = inputs.auditEvents.filter((event) => event.action.startsWith("approval."));
  let exposure = 0n;
  for (const approval of approvals) exposure += rubExposureUnits(approval.exposure) ?? 0n;
  const rows = approvals.map((approval) => {
    const ready = approval.evidenceItems.filter((item) => item.status === "ready").length;
    return {
      approval,
      ready,
      remaining: Math.max(0, approval.requiredApprovals - approval.completedApprovals),
      evidenceGap: ready < approval.evidenceItems.length
    };
  });
  return {
    sections: [
      section("totals", "Totals", [
        count("approvals", rows.length),
        count("outstanding_signoffs", rows.reduce((sum, row) => sum + row.remaining, 0)),
        count("step_up_required", rows.filter((row) => row.approval.stepUpRequired).length),
        count("evidence_gaps", rows.filter((row) => row.evidenceGap).length),
        count("maker_conflicts", rows.filter((row) => row.approval.state === "Maker conflict").length),
        count("executable", 0),
        { key: "rub_exposure_under_review", value: formatDecimal(exposure, scaleOf("RUB")), unit: "RUB" }
      ]),
      section("by_state", "By state", counts(approvals.map((approval) => approval.state))),
      section("by_maker_kind", "By maker kind", counts(approvals.map((approval) => makerKind(approval.makerSubject)), ["service", "operator", "dev", "other"])),
      section("audit_by_action", "Approval audit events by action", counts(auditEvents.map((event) => event.action))),
      section("audit_by_outcome", "Approval audit events by outcome", counts(auditEvents.map((event) => event.outcome), ["recorded", "reviewed", "denied"]))
    ],
    tables: [
      {
        id: "approvals",
        title: "Approvals",
        columns: [
          "approval_id",
          "action",
          "resource",
          "state",
          "maker_kind",
          "required",
          "completed",
          "remaining",
          "step_up_required",
          "evidence_ready",
          "evidence_total",
          "executable"
        ],
        rows: rows.map(({ approval, ready, remaining }) => [
          approval.id,
          approval.action,
          reportResource(approval.resource),
          approval.state,
          makerKind(approval.makerSubject),
          String(approval.requiredApprovals),
          String(approval.completedApprovals),
          String(remaining),
          String(approval.stepUpRequired),
          String(ready),
          String(approval.evidenceItems.length),
          "false"
        ])
      },
      {
        id: "approval_audit_events",
        title: "Approval audit events",
        columns: ["sequence", "event_id", "occurred_at", "action", "resource", "outcome", "evidence_digest"],
        rows: auditEvents.map((event) => [
          String(event.sequence),
          event.eventId,
          event.occurredAt,
          event.action,
          reportResource(event.resource),
          event.outcome,
          event.evidenceDigest
        ])
      }
    ]
  };
}

const builders: Readonly<Record<ReportId, (inputs: ReportInputs) => ReportContent>> = Object.freeze({
  "kyc-queue-daily": kycReport,
  "aml-kyt-alerts": amlReport,
  "maker-checker-approvals": approvalsReport
});

function markers(generatedAt: string) {
  return {
    status: "draft",
    not_for_submission: true,
    environment: "dev-synthetic",
    generatedAt,
    period: reportPeriod
  } as const;
}

export function findReportDefinition(id: string): (typeof catalog)[number] | undefined {
  return catalog.find((item) => item.id === id);
}

export function listReports(generatedAt: string): ReportListPayload {
  return {
    ...markers(generatedAt),
    reports: catalog.map((item): ReportDefinition => ({ ...item, ...markers(generatedAt) }))
  };
}

export function buildReport(id: ReportId, inputs: ReportInputs, generatedAt: string): DraftReport {
  const definition = findReportDefinition(id);
  if (!definition) throw new Error("Unknown draft report");
  const content = builders[definition.id](inputs);
  return {
    ...definition,
    ...markers(generatedAt),
    formatVersion: 1,
    dataSource: "synthetic",
    decisionAuthority: "none",
    contentDigest: sha256({ id: definition.id, formatVersion: 1, period: reportPeriod, ...content }),
    sections: content.sections,
    tables: content.tables
  };
}

// Neutralises spreadsheet formula injection (OWASP CSV injection guidance) and
// applies RFC 4180 quoting.
export function csvCell(value: string | number | boolean): string {
  let text = String(value);
  if (/^[\s\u00a0\u3000]*[=+\-@\uff1d\uff0b\uff0d\uff20]/u.test(text) || /^[\t\r\n]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function csvLine(cells: readonly (string | number | boolean)[]): string {
  return cells.map(csvCell).join(",");
}

export function reportCsv(report: DraftReport): string {
  const lines = [
    csvLine(["field", "value"]),
    csvLine(["notice", draftNotice]),
    csvLine(["report_id", report.id]),
    csvLine(["title", report.title]),
    csvLine(["status", report.status]),
    csvLine(["not_for_submission", report.not_for_submission]),
    csvLine(["environment", report.environment]),
    csvLine(["generated_at", report.generatedAt]),
    csvLine(["period_from", report.period.from]),
    csvLine(["period_to", report.period.to]),
    csvLine(["period_as_of", report.period.asOf]),
    csvLine(["content_digest", report.contentDigest]),
    "",
    csvLine(["section", "key", "value", "unit"]),
    ...report.sections.flatMap((item) => item.rows.map((row) => csvLine([item.id, row.key, row.value, row.unit])))
  ];
  for (const table of report.tables) {
    lines.push("", csvLine(["table", table.id]), csvLine(table.columns), ...table.rows.map(csvLine));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function buildReportExport(report: DraftReport): ReportExportPayload {
  return {
    ...markers(report.generatedAt),
    formatVersion: 1,
    reportId: report.id,
    contentDigest: report.contentDigest,
    mediaType: "text/csv; charset=utf-8",
    filename: `solidchange-draft-${report.id}-${report.contentDigest.slice(0, 12)}.csv`,
    csv: reportCsv(report)
  };
}

export function reportAccessEvent(
  eventId: string,
  actor: string,
  report: DraftReport,
  action: "report.viewed" | "report.exported"
): AuditSourceEvent {
  return {
    eventId,
    occurredAt: report.generatedAt,
    actor,
    action,
    resource: `report:${report.id}`,
    outcome: "recorded",
    evidenceDigest: `sha256:${report.contentDigest}`
  };
}

