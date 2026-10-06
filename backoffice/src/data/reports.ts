export type ReportId = "kyc-queue-daily" | "aml-kyt-alerts" | "maker-checker-approvals";

export type ReportUnit = "count" | "minutes" | "RUB" | "USDT" | "TON" | "text";

export interface ReportPeriod {
  readonly from: string;
  readonly to: string;
  readonly asOf: string;
  readonly timezone: "UTC";
}

// Every report surface carries these markers: the reports are synthetic
// working drafts and never a regulatory submission.
export interface ReportDraftMarkers {
  readonly status: "draft";
  readonly not_for_submission: true;
  readonly environment: "dev-synthetic";
  readonly generatedAt: string;
  readonly period: ReportPeriod;
}

export interface ReportDefinition extends ReportDraftMarkers {
  readonly id: ReportId;
  readonly title: string;
  readonly description: string;
}

export interface ReportRow {
  readonly key: string;
  readonly value: string | number;
  readonly unit: ReportUnit;
}

export interface ReportSection {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ReportRow[];
}

export interface ReportTable {
  readonly id: string;
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface DraftReport extends ReportDefinition {
  readonly formatVersion: 1;
  readonly dataSource: "synthetic";
  readonly decisionAuthority: "none";
  readonly contentDigest: string;
  readonly sections: readonly ReportSection[];
  readonly tables: readonly ReportTable[];
}

export interface ReportListPayload extends ReportDraftMarkers {
  readonly reports: readonly ReportDefinition[];
}

export interface ReportExportPayload extends ReportDraftMarkers {
  readonly formatVersion: 1;
  readonly reportId: ReportId;
  readonly contentDigest: string;
  readonly mediaType: "text/csv; charset=utf-8";
  readonly filename: string;
  readonly csv: string;
}
