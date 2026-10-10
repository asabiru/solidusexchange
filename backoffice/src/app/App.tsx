import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { roleProfiles, type Capability, type OperatorRole } from "../auth/access.js";
import {
  ApiError,
  createStepUpChallenge,
  createDevSession,
  getAmlCases,
  getApprovals,
  getAudit,
  getAuditExport,
  getAuthStatus,
  getCheck,
  getChecks,
  getCustomers,
  getDashboard,
  getFraudAlerts,
  getHealth,
  getInvestigations,
  getKycCases,
  getReport,
  getReportExport,
  getReports,
  getSession,
  getSubjectTimeline,
  getSupportTicket,
  getSupportTickets,
  getWithdrawal,
  getWithdrawals,
  logout,
  previewApproval,
  verifyStepUpChallenge,
  type AmlPayload,
  type ApprovalsPayload,
  type AuditPayload,
  type ChecksPayload,
  type CustomersPayload,
  type DashboardPayload,
  type FraudPayload,
  type HealthPayload,
  type InvestigationsPayload,
  type KycPayload,
  type SessionPayload,
  type StepUpChallengePayload,
  type SubjectTimelinePayload,
  type SupportTicketsPayload,
  type WithdrawalsPayload
} from "../data/client.js";
import type { DraftReport, ReportDefinition, ReportId, ReportListPayload, ReportRow, ReportSection, ReportTable } from "../data/reports.js";
import type {
  AmlCase,
  ApprovalPreview,
  ApprovalSummary,
  AuditEvent,
  ChatCheck,
  CheckStatus,
  CheckTimelineEvent,
  CustomerRow,
  EvidenceItem,
  FraudAlert,
  InvestigationCase,
  InvestigationTimelineEvent,
  KycCase,
  Metric,
  QueueRow,
  SupportTicket,
  SupportTicketMessage,
  SupportTicketNote,
  SupportTicketStatus,
  SubjectTimelineEntry,
  Tone,
  WithdrawalApprovalStep,
  WithdrawalIntent,
  WithdrawalIntentStatus,
  WithdrawalTimelineEvent,
  WorkflowCheck
} from "../data/demo.js";
import type {
  KycProviderEvidence,
  KytProviderEvidence,
  ProviderCallbackRecord,
  ProviderEvidenceFeed
} from "../data/provider-evidence.js";
import { navigation, navigationGroups, type NavigationItem, type ScreenId } from "./navigation.js";
import { runtime } from "./runtime.js";
import { ScreenIcon, UiIcon } from "./icons.js";
import { hasMessage, isLocale, localeNames, locales, type MessageKey } from "./i18n.js";
import { useI18n } from "./i18n-context.js";
import {
  arrayOf,
  capabilitiesOf,
  checkStatusKeyOf,
  checkStatusOf,
  countToward,
  intOf,
  operatorRoleKeyOf,
  operatorRoleOf,
  recordOf,
  rowsOf,
  subjectEntryLinkOf,
  subjectKindKeyOf,
  supportAuthorKeyOf,
  textOf,
  ticketChannelKeyOf,
  ticketPriorityKeyOf,
  ticketStatusKeyOf,
  ticketStatusOf,
  toneOf,
  truncatedOf,
  withdrawalDecisionKeyOf,
  withdrawalRoleKeyOf,
  withdrawalStatusKeyOf,
  withdrawalStatusOf
} from "./server-fields.js";

type Theme = "light" | "dark";
type Density = "compact" | "comfortable";

function initialScreen(): ScreenId {
  const candidate = window.location.hash.slice(1);
  const item = navigation.find((entry) => entry.id === candidate);
  return item?.id ?? "dashboard";
}

function screenKey(id: ScreenId): MessageKey {
  return `screen.${id}`;
}

function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className="status" data-tone={toneOf(tone)}>{children}</span>;
}

/** Localized label for a whitelisted server enum; a foreign value renders the raw server text instead of a fabricated message key. */
function enumText(t: (key: MessageKey) => string, key: MessageKey | undefined, raw: unknown): string {
  return key === undefined ? textOf(raw) : t(key);
}

/** Localized count for an untrusted numeric field; non-integers render "—" instead of "NaN". */
function safeCount(count: (value: number) => string, value: unknown): string {
  const parsed = intOf(value);
  return parsed === undefined ? "—" : count(parsed);
}

function TableShell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table regions must stay keyboard-scrollable (WCAG 2.1.1)
    <section className="table-scroll" aria-label={label} tabIndex={0}>{children}</section>
  );
}

function LiveStatus({ message }: { message: string }) {
  return <output className="sr-only" aria-live="polite" aria-atomic="true">{message}</output>;
}

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function QueueChart({ queues }: { queues: readonly QueueRow[] }) {
  const { t } = useI18n();
  const rows = rowsOf<QueueRow>(queues);
  const width = 300;
  const height = 132;
  const pad = 14;
  const max = Math.max(1, ...rows.map((row) => countToward(row.total)));
  const x = (index: number) => pad + (index * (width - pad * 2)) / Math.max(1, rows.length - 1);
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const line = (key: "total" | "critical") =>
    rows.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(countToward(recordOf(row)[key])).toFixed(1)}`).join(" ");
  const area = `${line("total")} L${x(rows.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z`;
  return (
    <figure className="queue-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("dashboard.chartLabel")}>
        <path className="queue-chart-area" d={area} />
        <path className="queue-chart-total" d={line("total")} />
        <path className="queue-chart-critical" d={line("critical")} />
        {rows.map((row, index) => (
          <circle key={`${textOf(row.queue)}:${index}`} cx={x(index)} cy={y(countToward(row.total))} r="3.5" />
        ))}
      </svg>
      <figcaption>
        {rows.map((row, index) => (
          <span key={`${textOf(row.queue)}:${index}`}><strong>{textOf(row.total, "0")}</strong>{textOf(row.queue)}</span>
        ))}
      </figcaption>
    </figure>
  );
}

function DisabledSwitch({ label }: { label: string }) {
  return <input className="switch" type="checkbox" role="switch" aria-checked={false} checked={false} disabled readOnly aria-label={label} />;
}

export function DashboardView({ data }: { data: DashboardPayload }) {
  const { t } = useI18n();
  const metrics = rowsOf<Metric>(recordOf(data).metrics);
  const queues = rowsOf<QueueRow>(recordOf(data).queues);
  return (
    <>
      <PageHeading title={t("screen.dashboard")} description={t("dashboard.description")} />
      <section className="metrics" aria-label={t("dashboard.metricsLabel")}>
        {metrics.map((metric, index) => (
          <article className="metric" data-accent={index === 0 ? "true" : undefined} key={`${textOf(metric.label)}:${index}`}>
            <div><span>{textOf(metric.label)}</span><i data-tone={toneOf(metric.tone)} /></div>
            <strong>{textOf(metric.value)}</strong>
            <small>{textOf(metric.detail)}</small>
          </article>
        ))}
      </section>
      <section className="bento">
        <article className="panel bento-queues">
          <header className="panel-heading">
            <div><h2>{t("dashboard.queuesTitle")}</h2><p>{t("dashboard.queuesDescription")}</p></div>
          </header>
          <TableShell label={t("dashboard.queuesTitle")}>
            <table>
              <thead><tr><th scope="col">{t("dashboard.queue")}</th><th scope="col">{t("dashboard.critical")}</th><th scope="col">{t("dashboard.total")}</th><th scope="col">{t("dashboard.oldest")}</th><th scope="col">{t("common.sla")}</th></tr></thead>
              <tbody>
                {queues.map((row, index) => (
                  <tr key={`${textOf(row.queue)}:${index}`}>
                    <td><button className="table-link" type="button">{textOf(row.queue)}</button></td>
                    <td>{textOf(row.critical)}</td>
                    <td>{textOf(row.total)}</td>
                    <td>{textOf(row.oldest)}</td>
                    <td><Status tone={toneOf(row.tone)}>{textOf(row.sla)}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </article>
        <article className="panel bento-chart">
          <header className="panel-heading">
            <div><h2>{t("dashboard.loadTitle")}</h2><p>{t("dashboard.loadDescription")}</p></div>
          </header>
          <QueueChart queues={queues} />
        </article>
        <aside className="panel health-panel">
          <header className="panel-heading">
            <div><h2>{t("dashboard.readinessTitle")}</h2><p>{t("dashboard.readinessDescription")}</p></div>
          </header>
          <dl className="health-list">
            <div><dt>{t("dashboard.runtime")}</dt><dd><Status tone="success">{runtime.mode}</Status></dd></div>
            <div><dt>{t("dashboard.dataSource")}</dt><dd>{t("dashboard.dataSourceValue")}</dd></div>
            <div><dt>{t("dashboard.commandClients")}</dt><dd><DisabledSwitch label={t("dashboard.commandClientsOff")} /><Status tone="warning">{t("dashboard.notInstalled")}</Status></dd></div>
            <div><dt>{t("dashboard.customerSystems")}</dt><dd><DisabledSwitch label={t("dashboard.customerSystemsOff")} /><Status>{t("dashboard.disconnected")}</Status></dd></div>
          </dl>
        </aside>
      </section>
    </>
  );
}

export function CustomersView({ query, data }: { query: string; data: CustomersPayload }) {
  const { t, count } = useI18n();
  const rows = rowsOf<CustomerRow>(recordOf(data).customers);
  const customers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return rows;
    return rows.filter((customer) =>
      [
        customer.id,
        customer.name,
        customer.country,
        customer.segment,
        customer.nextAction,
        customer.kycCaseId
      ]
        .some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [rows, query]);
  const [selectedId, setSelectedId] = useState(textOf(rows[0]?.id, ""));
  const selected = customers.find((customer) => customer.id === selectedId) ?? customers[0];

  return (
    <>
      <PageHeading title={t("screen.customers")} description={t("customers.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("customers.title")}</h2><p>{t("customers.count", { count: count(customers.length) })}</p></div>
            <Status tone="info">{t("customers.noRawPii")}</Status>
          </header>
          <TableShell label={t("customers.listLabel")}>
            <table>
              <thead><tr><th scope="col">{t("customers.customer")}</th><th scope="col">{t("customers.kyc")}</th><th scope="col">{t("common.risk")}</th><th scope="col">{t("customers.volume")}</th><th scope="col">{t("customers.nextAction")}</th></tr></thead>
              <tbody>
                {customers.map((customer, index) => (
                  <tr key={`${textOf(customer.id)}:${index}`} data-selected={customer.id === selected?.id}>
                    <td>
                      <button
                        className="person"
                        type="button"
                        aria-current={customer.id === selected?.id ? "true" : undefined}
                        onClick={() => setSelectedId(textOf(customer.id, ""))}
                      >
                        <span>{textOf(customer.initials)}</span>
                        <span>
                          <strong>{textOf(customer.name)}</strong>
                          <small>{textOf(customer.id)} · {textOf(customer.country)} · {textOf(customer.segment)}</small>
                        </span>
                      </button>
                    </td>
                    <td><Status tone={customer.kyc === "Verified" ? "success" : "warning"}>{textOf(customer.kyc)}</Status></td>
                    <td><Status tone={toneOf(customer.tone)}>{textOf(customer.risk)} · {textOf(customer.riskScore)}</Status></td>
                    <td className="numeric">{textOf(customer.volume)}</td>
                    <td>{textOf(customer.nextAction)}</td>
                  </tr>
                ))}
                {!customers.length && (
                  <tr><td colSpan={5}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && (
          <aside className="panel case-detail">
            <header className="panel-heading">
              <div><h2>{textOf(selected.name)}</h2><p>{textOf(selected.id)} · {textOf(selected.kind)}</p></div>
              <Status tone={toneOf(selected.tone)}>{textOf(selected.risk)}</Status>
            </header>
            <div className="risk-score">
              <span>{t("common.riskScore")}</span>
              <strong>{textOf(selected.riskScore)}</strong>
              <p>{textOf(selected.riskReason)}</p>
            </div>
            <dl className="detail-list">
              <div><dt>{t("customers.kycCase")}</dt><dd>{textOf(selected.kycCaseId)}</dd></div>
              <div><dt>{t("customers.openAmlCases")}</dt><dd>{textOf(selected.openAmlCases)}</dd></div>
              <div><dt>{t("customers.restriction")}</dt><dd>{textOf(selected.restriction)}</dd></div>
              <div><dt>{t("customers.lastReviewed")}</dt><dd>{textOf(selected.lastReviewedAt)}</dd></div>
            </dl>
            <div className="safe-action">
              <strong>{t("customers.projectionTitle")}</strong>
              <p>{t("customers.projectionNote")}</p>
            </div>
          </aside>
        )}
      </section>
    </>
  );
}

export function EvidenceList({ items }: { items: readonly EvidenceItem[] }) {
  return (
    <div className="evidence-list">
      {rowsOf<EvidenceItem>(items).map((item, index) => (
        <div key={`${textOf(item.id)}:${index}`}>
          <span>
            <strong>{textOf(item.label)}</strong>
            <small>{textOf(item.digest)}</small>
          </span>
          <Status tone={item.status === "ready" ? "success" : "danger"}>{textOf(item.status)}</Status>
        </div>
      ))}
    </div>
  );
}

export function WorkflowChecks({ checks }: { checks: readonly WorkflowCheck[] }) {
  return (
    <div className="check-list">
      {rowsOf<WorkflowCheck>(checks).map((check, index) => (
        <div key={`${textOf(check.id)}:${index}`}>
          <span>
            <strong>{textOf(check.label)}</strong>
            <small>{textOf(check.detail)}</small>
          </span>
          <Status tone={toneOf(check.tone)}>{textOf(check.status)}</Status>
        </div>
      ))}
    </div>
  );
}

function linkedEvidence<T extends KycProviderEvidence | KytProviderEvidence>(
  feed: ProviderEvidenceFeed<T>,
  caseId: string
): string {
  const ids = rowsOf<T>(recordOf(feed).cases)
    .filter((item) => item.linkedCaseId === caseId)
    .map((item) => textOf(item.id, ""));
  return ids.join(", ");
}

export function CallbackList({ records }: { records: readonly ProviderCallbackRecord[] }) {
  const { t } = useI18n();
  const items = rowsOf<ProviderCallbackRecord>(records);
  if (!items.length) return <div className="empty">{t("evidence.noCallbacks")}</div>;
  return (
    <div className="check-list">
      {items.map((record, index) => {
        const sequence = intOf(record.sequence);
        return (
          <div key={`${textOf(record.deliveryId)}:${index}`}>
            <span>
              <strong>
                {textOf(record.deliveryId)}
                {sequence !== undefined ? ` · ${t("evidence.callbackSequence", { sequence })}` : ""}
                {record.status ? ` · ${textOf(record.status)}` : ""}
              </strong>
              <small>
                {textOf(record.deliveredAt)} · {textOf(record.origin)}
                {record.probe ? ` (${textOf(record.probe)})` : ""}
                {record.verificationReason ? ` · ${textOf(record.verificationReason)}` : ""}
              </small>
            </span>
            <Status tone={record.verification === "rejected" ? "danger" : record.accepted === true ? "success" : "warning"}>
              {record.verification === "rejected" ? t("common.callbackRejected") : record.inboxAction ? textOf(record.inboxAction) : t("common.callbackVerified")}
            </Status>
          </div>
        );
      })}
    </div>
  );
}

export function ProviderEvidencePanel<T extends KycProviderEvidence | KytProviderEvidence>({
  title,
  feed
}: {
  title: string;
  feed: ProviderEvidenceFeed<T>;
}) {
  const { t, count } = useI18n();
  const cases = rowsOf<T>(recordOf(feed).cases);
  const [selectedId, setSelectedId] = useState(textOf(cases[0]?.id, ""));
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];

  return (
    <section className="grid risk-grid">
      <article className="panel">
        <header className="panel-heading">
          <div><h2>{title}</h2><p>{t("evidence.count", { count: count(cases.length) })}</p></div>
          <Status tone="info">{t("evidence.only")}</Status>
        </header>
        <TableShell label={title}>
          <table>
            <thead><tr><th scope="col">{t("evidence.run")}</th><th scope="col">{t("common.scenario")}</th><th scope="col">{t("evidence.providerClaim")}</th><th scope="col">{t("evidence.projection")}</th><th scope="col">{t("evidence.sequence")}</th><th scope="col">{t("evidence.callbacks")}</th></tr></thead>
            <tbody>
              {cases.map((item, index) => {
                const verification = recordOf(item.verification);
                return (
                  <tr key={`${textOf(item.id)}:${index}`} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(textOf(item.id, ""))}>
                        {textOf(item.id)}
                      </button>
                      <small className="cell-note">{item.linkedCaseId ? textOf(item.linkedCaseId) : t("evidence.unlinked")}</small>
                    </td>
                    <td>{textOf(item.label)}<small className="cell-note">{textOf(item.scenario)}</small></td>
                    <td>{textOf(item.providerStatus)}</td>
                    <td><Status tone={toneOf(item.tone)}>{textOf(item.projectedStatus)}</Status></td>
                    <td className="numeric">{textOf(item.sequence)}</td>
                    <td>
                      {t("evidence.verifiedCount", { verified: intOf(verification.verified) ?? "—", delivered: intOf(verification.delivered) ?? "—" })}
                      <small className="cell-note">{t("evidence.rejectedHeld", { rejected: intOf(verification.rejected) ?? "—", held: intOf(verification.heldForReview) ?? "—" })}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </article>
      {selected && (
        <aside className="panel case-detail">
          <header className="panel-heading">
            <div><h2>{textOf(selected.id)}</h2><p>{textOf(selected.source)} · {textOf(selected.environment)}</p></div>
            <Status tone={toneOf(selected.tone)}>{textOf(selected.projectedStatus)}</Status>
          </header>
          <dl className="detail-list">
            <div><dt>{t("evidence.providerReference")}</dt><dd className="hash-value">{textOf(selected.providerReference)}</dd></div>
            {selected.domain === "kyc" ? (
              <div><dt>{t("evidence.applicant")}</dt><dd>{textOf(selected.applicantRef)} · {textOf(selected.level)}</dd></div>
            ) : (
              <>
                <div><dt>{t("evidence.binding")}</dt><dd>{textOf(selected.asset)} · {textOf(selected.network)} · {textOf(selected.direction)}</dd></div>
                <div><dt>{t("common.risk")}</dt><dd>{textOf(selected.riskLevel)} · {textOf(selected.riskScore)}{selected.sanctionsHit === true ? ` · ${t("evidence.sanctionsHit")}` : ""}</dd></div>
              </>
            )}
            <div><dt>{t("evidence.reasonCodes")}</dt><dd>{arrayOf(selected.reasonCodes).length ? arrayOf<unknown>(selected.reasonCodes).map((code) => textOf(code, "")).join(", ") : "—"}</dd></div>
            {selected.domain === "kyc" && arrayOf(selected.requestedItems).length > 0 && (
              <div><dt>{t("evidence.requestedItems")}</dt><dd>{arrayOf<unknown>(selected.requestedItems).map((code) => textOf(code, "")).join(", ")}</dd></div>
            )}
            <div><dt>{t("evidence.verification")}</dt><dd>{textOf(recordOf(selected.verification).result)}</dd></div>
            <div><dt>{t("evidence.deadline")}</dt><dd>{textOf(selected.deadline)}{selected.timedOut === true ? ` · ${t("evidence.timedOut")}` : ""}</dd></div>
            {selected.outage && <div><dt>{t("evidence.outage")}</dt><dd>{textOf(recordOf(selected.outage).code)}{recordOf(selected.outage).retryable === true ? ` · ${t("evidence.retryable")}` : ""}</dd></div>}
          </dl>
          <h3 className="detail-section-title">{t("evidence.receivedCallbacks")}</h3>
          <CallbackList records={arrayOf(selected.receivedCallbacks)} />
          <h3 className="detail-section-title">{t("evidence.rejectedCallbacks")}</h3>
          <CallbackList records={arrayOf(selected.rejectedCallbacks)} />
          <div className="safe-action">
            <strong>{t("evidence.decisionTitle")}</strong>
            <p>{t("evidence.decisionNote")}</p>
          </div>
        </aside>
      )}
    </section>
  );
}

export function KycView({ query, data }: { query: string; data: KycPayload }) {
  const { t, count } = useI18n();
  const rows = rowsOf<KycCase>(recordOf(data).cases);
  const cases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return rows;
    return rows.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.type,
        item.status,
        item.stage,
        item.jurisdiction
      ].some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [rows, query]);
  const [selectedId, setSelectedId] = useState(textOf(rows[0]?.id, ""));
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];

  return (
    <>
      <PageHeading title={t("screen.kyc")} description={t("kyc.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("kyc.casesTitle")}</h2><p>{t("kyc.count", { count: count(cases.length) })}</p></div>
            <Status tone="info">{t("common.readOnly")}</Status>
          </header>
          <TableShell label={t("kyc.tableLabel")}>
            <table>
              <thead><tr><th scope="col">{t("common.case")}</th><th scope="col">{t("common.subject")}</th><th scope="col">{t("common.stage")}</th><th scope="col">{t("common.risk")}</th><th scope="col">{t("common.sla")}</th></tr></thead>
              <tbody>
                {cases.map((item, index) => (
                  <tr key={`${textOf(item.id)}:${index}`} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(textOf(item.id, ""))}>
                        {textOf(item.id)}
                      </button>
                      <small className="cell-note">{textOf(item.type)} · {textOf(item.status)}</small>
                    </td>
                    <td>{textOf(item.subject)}<small className="cell-note">{textOf(item.customerId)}</small></td>
                    <td>{textOf(item.stage)}</td>
                    <td><Status tone={toneOf(item.tone)}>{textOf(item.riskRating)} · {textOf(item.riskScore)}</Status></td>
                    <td>{textOf(item.sla)}</td>
                  </tr>
                ))}
                {!cases.length && (
                  <tr><td colSpan={5}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <KycCaseDetail item={selected} providerEvidence={linkedEvidence(data.providerEvidence, textOf(selected.id, ""))} />}
      </section>
      <ProviderEvidencePanel title={t("kyc.providerEvidence")} feed={data.providerEvidence} />
    </>
  );
}

export function KycCaseDetail({ item, providerEvidence }: { item: KycCase; providerEvidence: string }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{textOf(item.subject)} · {textOf(item.jurisdiction)}</p></div>
        <Status tone={toneOf(item.tone)}>{textOf(item.status)}</Status>
      </header>
      <div className="risk-score">
        <span>{t("common.riskScore")}</span>
        <strong>{textOf(item.riskScore)}</strong>
        <p>{t("kyc.stageOwner", { stage: textOf(item.stage), owner: textOf(item.owner) })}</p>
      </div>
      <dl className="detail-list">
        <div><dt>{t("common.opened")}</dt><dd>{textOf(item.openedAt)}</dd></div>
        <div><dt>{t("common.sla")}</dt><dd>{textOf(item.sla)}</dd></div>
        {item.uboSummary && <div><dt>{t("kyc.ubo")}</dt><dd>{textOf(item.uboSummary)}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
        <div><dt>{t("common.providerEvidence")}</dt><dd>{providerEvidence || t("common.notLinked")}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={arrayOf(item.evidenceItems)} />
      <h3 className="detail-section-title">{t("common.checks")}</h3>
      <WorkflowChecks checks={arrayOf(item.checks)} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: textOf(item.linkedApprovalId) }) : t("common.approvalNotRequested")}</strong>
        <p>{t("kyc.decisionNote")}</p>
      </div>
    </aside>
  );
}

export function AmlView({ query, data }: { query: string; data: AmlPayload }) {
  const { t, count } = useI18n();
  const rows = rowsOf<AmlCase>(recordOf(data).cases);
  const cases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return rows;
    return rows.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.source,
        item.severity,
        item.state
      ].some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [rows, query]);
  const [selectedId, setSelectedId] = useState(textOf(rows[0]?.id, ""));
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];

  return (
    <>
      <PageHeading title={t("screen.aml")} description={t("aml.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("aml.casesTitle")}</h2><p>{t("aml.count", { count: count(cases.length) })}</p></div>
            <Status tone="warning">{t("common.decisionGated")}</Status>
          </header>
          <TableShell label={t("aml.casesTitle")}>
            <table>
              <thead><tr><th scope="col">{t("common.case")}</th><th scope="col">{t("common.subject")}</th><th scope="col">{t("common.source")}</th><th scope="col">{t("common.severity")}</th><th scope="col">{t("common.exposure")}</th><th scope="col">{t("common.sla")}</th></tr></thead>
              <tbody>
                {cases.map((item, index) => (
                  <tr key={`${textOf(item.id)}:${index}`} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(textOf(item.id, ""))}>
                        {textOf(item.id)}
                      </button>
                      <small className="cell-note">{textOf(item.state)}</small>
                    </td>
                    <td>{textOf(item.subject)}<small className="cell-note">{textOf(item.customerId)}</small></td>
                    <td>{textOf(item.source)}</td>
                    <td><Status tone={toneOf(item.tone)}>{textOf(item.severity)}</Status></td>
                    <td className="numeric">{textOf(item.exposure)}</td>
                    <td>{textOf(item.sla)}</td>
                  </tr>
                ))}
                {!cases.length && (
                  <tr><td colSpan={6}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <AmlCaseDetail item={selected} providerEvidence={linkedEvidence(data.providerEvidence, textOf(selected.id, ""))} />}
      </section>
      <ProviderEvidencePanel title={t("aml.providerEvidence")} feed={data.providerEvidence} />
    </>
  );
}

export function AmlCaseDetail({ item, providerEvidence }: { item: AmlCase; providerEvidence: string }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{textOf(item.subject)} · {textOf(item.source)}</p></div>
        <Status tone={toneOf(item.tone)}>{textOf(item.state)}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("common.owner")}</dt><dd>{textOf(item.owner)}</dd></div>
        <div><dt>{t("common.opened")}</dt><dd>{textOf(item.openedAt)}</dd></div>
        <div><dt>{t("common.exposure")}</dt><dd>{textOf(item.exposure)}</dd></div>
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
        <div><dt>{t("common.providerEvidence")}</dt><dd>{providerEvidence || t("common.notLinked")}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("aml.screening")}</h3>
      <WorkflowChecks checks={arrayOf(item.screenings)} />
      <h3 className="detail-section-title">{t("aml.riskFactors")}</h3>
      <ul className="factor-list">
        {arrayOf(item.riskFactors).map((factor, index) => <li key={index}>{textOf(factor)}</li>)}
      </ul>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={arrayOf(item.evidenceItems)} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: textOf(item.linkedApprovalId) }) : t("common.approvalNotRequested")}</strong>
        <p>{t("aml.decisionNote")}</p>
      </div>
    </aside>
  );
}

export function LinkedRecords({ values }: { values: readonly string[] }) {
  return (
    <div className="linked-records">
      {arrayOf(values).map((value, index) => <span key={index}>{textOf(value)}</span>)}
    </div>
  );
}

export function InvestigationsView({
  query,
  data
}: {
  query: string;
  data: InvestigationsPayload;
}) {
  const { t, count } = useI18n();
  const rows = rowsOf<InvestigationCase>(recordOf(data).cases);
  const cases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return rows;
    return rows.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.category,
        item.priority,
        item.state,
        item.owner,
        ...arrayOf(item.relatedAlertIds),
        ...arrayOf(item.relatedCaseIds)
      ].some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [rows, query]);
  const [selectedId, setSelectedId] = useState(textOf(rows[0]?.id, ""));
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];

  return (
    <>
      <PageHeading title={t("screen.investigations")} description={t("investigations.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("investigations.casesTitle")}</h2><p>{t("investigations.count", { count: count(cases.length) })}</p></div>
            <Status tone="warning">{t("common.decisionGated")}</Status>
          </header>
          <TableShell label={t("investigations.casesTitle")}>
            <table>
              <thead><tr><th scope="col">{t("common.case")}</th><th scope="col">{t("common.subject")}</th><th scope="col">{t("common.category")}</th><th scope="col">{t("common.priority")}</th><th scope="col">{t("common.exposure")}</th><th scope="col">{t("common.sla")}</th></tr></thead>
              <tbody>
                {cases.map((item, index) => (
                  <tr key={`${textOf(item.id)}:${index}`} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(textOf(item.id, ""))}>
                        {textOf(item.id)}
                      </button>
                      <small className="cell-note">{textOf(item.state)}</small>
                    </td>
                    <td>{textOf(item.subject)}<small className="cell-note">{textOf(item.customerId)}</small></td>
                    <td>{textOf(item.category)}</td>
                    <td><Status tone={toneOf(item.tone)}>{textOf(item.priority)}</Status></td>
                    <td className="numeric">{textOf(item.exposure)}</td>
                    <td>{textOf(item.sla)}</td>
                  </tr>
                ))}
                {!cases.length && (
                  <tr><td colSpan={6}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <InvestigationDetail item={selected} />}
      </section>
    </>
  );
}

export function InvestigationDetail({ item }: { item: InvestigationCase }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{textOf(item.subject)} · {textOf(item.category)}</p></div>
        <Status tone={toneOf(item.tone)}>{textOf(item.state)}</Status>
      </header>
      <div className="case-summary">
        <strong>{t("investigations.priority", { priority: textOf(item.priority) })}</strong>
        <p>{textOf(item.summary)}</p>
      </div>
      <dl className="detail-list">
        <div><dt>{t("common.owner")}</dt><dd>{textOf(item.owner)}</dd></div>
        <div><dt>{t("common.opened")}</dt><dd>{textOf(item.openedAt)}</dd></div>
        <div><dt>{t("common.exposure")}</dt><dd>{textOf(item.exposure)}</dd></div>
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("investigations.relatedRecords")}</h3>
      <LinkedRecords values={[...arrayOf<unknown>(item.relatedAlertIds), ...arrayOf<unknown>(item.relatedCaseIds)] as string[]} />
      <h3 className="detail-section-title">{t("investigations.hypotheses")}</h3>
      <ul className="factor-list">
        {arrayOf(item.hypotheses).map((hypothesis, index) => <li key={index}>{textOf(hypothesis)}</li>)}
      </ul>
      <h3 className="detail-section-title">{t("investigations.timeline")}</h3>
      <div className="timeline-list">
        {rowsOf<InvestigationTimelineEvent>(item.timeline).map((event, index) => (
          <div key={`${textOf(event.id)}:${index}`}>
            <span />
            <div>
              <strong>{textOf(event.action)}</strong>
              <small>{textOf(event.occurredAt)} · {textOf(event.actor)}</small>
              <p>{textOf(event.outcome)}</p>
              <code>{textOf(event.evidenceDigest)}</code>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={arrayOf(item.evidenceItems)} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: textOf(item.linkedApprovalId) }) : t("common.approvalNotRequested")}</strong>
        <p>{t("investigations.decisionNote")}</p>
      </div>
    </aside>
  );
}

export function FraudView({ query, data }: { query: string; data: FraudPayload }) {
  const { t, count } = useI18n();
  const rows = rowsOf<FraudAlert>(recordOf(data).alerts);
  const alerts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return rows;
    return rows.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.scenario,
        item.channel,
        item.severity,
        item.state,
        item.linkedInvestigationId ?? ""
      ].some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [rows, query]);
  const [selectedId, setSelectedId] = useState(textOf(rows[0]?.id, ""));
  const selected = alerts.find((item) => item.id === selectedId) ?? alerts[0];

  return (
    <>
      <PageHeading title={t("screen.fraud")} description={t("fraud.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("fraud.alertsTitle")}</h2><p>{t("fraud.count", { count: count(alerts.length) })}</p></div>
            <Status tone="info">{t("fraud.monitorOnly")}</Status>
          </header>
          <TableShell label={t("fraud.alertsTitle")}>
            <table>
              <thead><tr><th scope="col">{t("fraud.alert")}</th><th scope="col">{t("common.subject")}</th><th scope="col">{t("common.scenario")}</th><th scope="col">{t("fraud.score")}</th><th scope="col">{t("common.exposure")}</th><th scope="col">{t("common.sla")}</th></tr></thead>
              <tbody>
                {alerts.map((item, index) => (
                  <tr key={`${textOf(item.id)}:${index}`} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(textOf(item.id, ""))}>
                        {textOf(item.id)}
                      </button>
                      <small className="cell-note">{textOf(item.channel)} · {textOf(item.state)}</small>
                    </td>
                    <td>{textOf(item.subject)}<small className="cell-note">{textOf(item.customerId)}</small></td>
                    <td>{textOf(item.scenario)}</td>
                    <td><Status tone={toneOf(item.tone)}>{textOf(item.score)} · {textOf(item.severity)}</Status></td>
                    <td className="numeric">{textOf(item.exposure)}</td>
                    <td>{textOf(item.sla)}</td>
                  </tr>
                ))}
                {!alerts.length && (
                  <tr><td colSpan={6}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <FraudDetail item={selected} />}
      </section>
    </>
  );
}

export function FraudDetail({ item }: { item: FraudAlert }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{textOf(item.subject)} · {textOf(item.channel)}</p></div>
        <Status tone={toneOf(item.tone)}>{textOf(item.severity)}</Status>
      </header>
      <div className="risk-score">
        <span>{t("fraud.fraudScore")}</span>
        <strong>{textOf(item.score)}</strong>
        <p>{t("fraud.detected", { scenario: textOf(item.scenario), detectedAt: textOf(item.detectedAt) })}</p>
      </div>
      <dl className="detail-list">
        <div><dt>{t("fraud.controlMode")}</dt><dd><Status tone="info">{textOf(item.controlMode)}</Status></dd></div>
        <div><dt>{t("fraud.linkedInvestigation")}</dt><dd>{item.linkedInvestigationId ? textOf(item.linkedInvestigationId) : t("fraud.notOpened")}</dd></div>
        <div><dt>{t("common.exposure")}</dt><dd>{textOf(item.exposure)}</dd></div>
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("fraud.signals")}</h3>
      <WorkflowChecks checks={arrayOf(item.signals)} />
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={arrayOf(item.evidenceItems)} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: textOf(item.linkedApprovalId) }) : t("fraud.noDecision")}</strong>
        <p>{t("fraud.decisionNote")}</p>
      </div>
    </aside>
  );
}

export function ApprovalsView({
  capabilities,
  data
}: {
  capabilities: readonly Capability[];
  data: ApprovalsPayload;
}) {
  const { t, count, time } = useI18n();
  const approvals = rowsOf<ApprovalSummary>(recordOf(data).approvals);
  const [selected, setSelected] = useState<ApprovalSummary | undefined>(approvals[0]);
  const [preview, setPreview] = useState<ApprovalPreview>();
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "failed">("idle");
  const stepUpErrorId = useId();
  const previewReasonId = useId();
  const [challenge, setChallenge] = useState<StepUpChallengePayload>();
  const [verificationCode, setVerificationCode] = useState("");
  const [stepUpState, setStepUpState] = useState<
    "idle" | "creating" | "challenge" | "retry" | "verifying" | "verified" | "failed" | "locked"
  >("idle");
  const operationVersion = useRef(0);
  const mayPreview = capabilities.includes("approvals:preview");
  const mayStepUp = capabilities.includes("approvals:step-up");

  async function loadPreview() {
    if (!selected) return;
    const version = ++operationVersion.current;
    setPreview(undefined);
    setPreviewState("loading");
    setChallenge(undefined);
    setVerificationCode("");
    setStepUpState("idle");
    try {
      const nextPreview = await previewApproval(selected.id, textOf(selected.commandDigest, ""));
      if (version !== operationVersion.current) return;
      setPreview(nextPreview);
      setPreviewState("idle");
    } catch {
      if (version !== operationVersion.current) return;
      setPreviewState("failed");
    }
  }

  async function startStepUp() {
    if (!selected) return;
    const version = ++operationVersion.current;
    setPreview(undefined);
    setChallenge(undefined);
    setVerificationCode("");
    setStepUpState("creating");
    try {
      const created = await createStepUpChallenge(selected.id, textOf(selected.commandDigest, ""));
      if (version !== operationVersion.current) return;
      setChallenge(created);
      setStepUpState("challenge");
    } catch {
      if (version !== operationVersion.current) return;
      setStepUpState("failed");
    }
  }

  async function verifyStepUp() {
    if (!selected || !challenge || !/^\d{6}$/.test(verificationCode)) return;
    const version = ++operationVersion.current;
    setStepUpState("verifying");
    try {
      const verification = await verifyStepUpChallenge(
        selected.id,
        textOf(selected.commandDigest, ""),
        textOf(challenge.challengeId, ""),
        verificationCode
      );
      if (version !== operationVersion.current) return;
      const nextPreview = await previewApproval(
        selected.id,
        textOf(selected.commandDigest, ""),
        typeof verification.grant === "string" ? verification.grant : undefined
      );
      if (version !== operationVersion.current) return;
      setPreview(nextPreview);
      setChallenge(undefined);
      setVerificationCode("");
      setStepUpState("verified");
    } catch (error) {
      if (version !== operationVersion.current) return;
      if (error instanceof ApiError && error.state === "invalid_code") {
        setChallenge({
          ...challenge,
          attemptsRemaining: error.attemptsRemaining ?? challenge.attemptsRemaining
        });
        setStepUpState("retry");
        return;
      }
      setChallenge(undefined);
      setVerificationCode("");
      setStepUpState(
        error instanceof ApiError && error.state === "attempts_exhausted"
          ? "locked"
          : "failed"
      );
    }
  }

  return (
    <>
      <PageHeading title={t("screen.approvals")} description={t("approvals.description")} />
      <section className="grid approval-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("approvals.pendingTitle")}</h2><p>{t("approvals.pendingDescription")}</p></div>
            <Status tone="warning">{t("approvals.pendingCount", { count: count(approvals.length) })}</Status>
          </header>
          <TableShell label={t("approvals.pendingTitle")}>
            <table>
              <thead><tr><th scope="col">{t("approvals.id")}</th><th scope="col">{t("approvals.action")}</th><th scope="col">{t("common.exposure")}</th><th scope="col">{t("common.evidence")}</th><th scope="col">{t("approvals.age")}</th><th scope="col">{t("approvals.state")}</th></tr></thead>
              <tbody>
                {approvals.map((approval, index) => (
                  <tr key={`${textOf(approval.id)}:${index}`} data-selected={approval.id === selected?.id}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={approval.id === selected?.id ? "true" : undefined}
                        onClick={() => {
                          operationVersion.current += 1;
                          setSelected(approval);
                          setPreview(undefined);
                          setPreviewState("idle");
                          setChallenge(undefined);
                          setVerificationCode("");
                          setStepUpState("idle");
                        }}
                      >
                        {textOf(approval.id)}
                      </button>
                    </td>
                    <td>{textOf(approval.action)}<small className="cell-note">{textOf(approval.maker)}</small></td>
                    <td className="numeric">{textOf(approval.exposure)}</td>
                    <td>{textOf(approval.evidence)}</td>
                    <td>{textOf(approval.age)}</td>
                    <td><Status tone={toneOf(approval.tone)}>{textOf(approval.state)}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && (
        <aside className="panel approval-detail">
          <header className="panel-heading">
            <div><h2>{textOf(selected.id)}</h2><p>{textOf(selected.action)}</p></div>
            <Status tone={toneOf(selected.tone)}>{textOf(selected.state)}</Status>
          </header>
          <dl className="detail-list">
            <div><dt>{t("approvals.maker")}</dt><dd>{textOf(selected.maker)}</dd></div>
            <div><dt>{t("common.exposure")}</dt><dd>{textOf(selected.exposure)}</dd></div>
            <div><dt>{t("approvals.evidenceReadiness")}</dt><dd>{textOf(selected.evidence)}</dd></div>
            <div><dt>{t("approvals.requiredApprovers")}</dt><dd>{safeCount(count, selected.completedApprovals)} / {safeCount(count, selected.requiredApprovals)}</dd></div>
          </dl>
          <div className="evidence-list">
            {rowsOf<EvidenceItem>(selected.evidenceItems).map((item, index) => (
              <div key={`${textOf(item.id)}:${index}`}>
                <span>
                  <strong>{textOf(item.label)}</strong>
                  <small>{textOf(item.digest)}</small>
                </span>
                <Status tone={item.status === "ready" ? "success" : "danger"}>{textOf(item.status)}</Status>
              </div>
            ))}
          </div>
          <div className="safe-action">
            <strong>{t("approvals.safeTitle")}</strong>
            <p>{t("approvals.safeNote")}</p>
          </div>
          {selected.stepUpRequired === true && (
            <section className="step-up-panel" aria-label={t("stepUp.title")}>
              <header>
                <div>
                  <strong>{t("stepUp.title")}</strong>
                  <small>{t("stepUp.notMfa")}</small>
                </div>
                <Status tone={stepUpState === "verified" ? "success" : "warning"}>
                  {stepUpState === "verified" ? t("stepUp.verified") : t("stepUp.required")}
                </Status>
              </header>
              {challenge ? (
                <>
                  <div className="dev-code">
                    <span>{t("stepUp.devCode")}</span>
                    <strong>{textOf(challenge.devVerificationCode)}</strong>
                    <small>
                      {t("stepUp.attemptsUntil", { attempts: textOf(intOf(challenge.attemptsRemaining)), time: time(textOf(challenge.expiresAt, "")) })}
                    </small>
                  </div>
                  <label className="step-up-input">
                    <span>{t("stepUp.enterCode")}</span>
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      aria-invalid={stepUpState === "retry"}
                      aria-describedby={stepUpState === "retry" ? stepUpErrorId : undefined}
                      maxLength={6}
                      value={verificationCode}
                      onChange={(event) => {
                        setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                      }}
                    />
                  </label>
                  {stepUpState === "retry" && (
                    <p className="step-up-result" data-state="failed" id={stepUpErrorId} role="alert">
                      {t("stepUp.codeRejected")}
                    </p>
                  )}
                  <button
                    className="button step-up-button"
                    type="button"
                    disabled={stepUpState === "verifying" || verificationCode.length !== 6}
                    onClick={() => void verifyStepUp()}
                  >
                    {stepUpState === "verifying" ? t("stepUp.verifying") : t("stepUp.verify")}
                  </button>
                </>
              ) : stepUpState === "verified" ? (
                <p className="step-up-result">
                  {t("stepUp.grantUsed")}
                </p>
              ) : (
                <>
                  {(stepUpState === "failed" || stepUpState === "locked") && (
                    <p className="step-up-result" data-state="failed" role="alert">
                      {stepUpState === "locked" ? t("stepUp.locked") : t("stepUp.failed")}
                    </p>
                  )}
                  <button
                    className="button step-up-button"
                    type="button"
                    disabled={!mayStepUp || stepUpState === "creating"}
                    onClick={() => void startStepUp()}
                  >
                    {stepUpState === "creating" ? t("stepUp.creating") : t("stepUp.start")}
                  </button>
                </>
              )}
            </section>
          )}
          <button
            className="button primary"
            type="button"
            disabled={!mayPreview || previewState === "loading"}
            aria-describedby={previewReasonId}
            onClick={() => void loadPreview()}
          >
            {previewState === "loading" ? t("approvals.previewLoading") : t("approvals.previewBuild")}
          </button>
          <small className="disabled-reason" id={previewReasonId}>
            {!mayPreview ? t("approvals.noPreviewCapability") : t("approvals.noCommand")}
          </small>
          {previewState === "failed" && (
            <div className="preview-error" role="alert">{t("approvals.previewFailed")}</div>
          )}
          {preview && <ApprovalPreviewPanel preview={preview} />}
          <LiveStatus
            message={
              previewState === "loading"
                ? t("approvals.livePreviewLoading")
                : stepUpState === "creating"
                  ? t("approvals.liveStepUpCreating")
                  : stepUpState === "verifying"
                    ? t("approvals.liveVerifying")
                    : preview
                      ? t("approvals.livePreviewReady")
                      : ""
            }
          />
        </aside>
        )}
      </section>
    </>
  );
}

export function ApprovalPreviewPanel({ preview }: { preview: ApprovalPreview }) {
  const { t, count } = useI18n();
  const policy = recordOf(preview.policy);
  const evidence = recordOf(preview.evidence);
  const auditAnchor = recordOf(preview.auditAnchor);
  function blockerLabel(blocker: unknown): string {
    const raw = textOf(blocker, "");
    const key = `blocker.${raw}`;
    return hasMessage(key) ? t(key) : raw || "—";
  }
  return (
    <section className="preview-panel" aria-label={t("preview.label")}>
      <header>
        <div><strong>{t("preview.policy")}</strong><small>{truncatedOf(recordOf(preview.command).digest, 16)}</small></div>
        <Status tone="warning">{t("preview.blocked")}</Status>
      </header>
      <dl className="preview-checks">
        <div>
          <dt>{t("preview.makerChecker")}</dt>
          <dd><Status tone={policy.independentApprover === true ? "success" : "danger"}>
            {policy.independentApprover === true ? t("preview.independent") : t("preview.conflict")}
          </Status></dd>
        </div>
        <div><dt>{t("preview.stepUpMfa")}</dt><dd><Status tone={policy.stepUpMfa === "verified" ? "success" : "warning"}>
          {textOf(policy.stepUpMfa)}
        </Status></dd></div>
        <div><dt>{t("common.evidence")}</dt><dd>{safeCount(count, evidence.ready)} / {safeCount(count, evidence.total)}</dd></div>
        <div><dt>{t("preview.auditAnchor")}</dt><dd>#{textOf(auditAnchor.sequence)} · {truncatedOf(auditAnchor.hash, 10)}</dd></div>
      </dl>
      <ul>
        {arrayOf(policy.blockers).map((blocker, index) => (
          <li key={index}>{blockerLabel(blocker)}</li>
        ))}
      </ul>
    </section>
  );
}

export function AuditView({ data, mayExport }: { data: AuditPayload; mayExport: boolean }) {
  const { t, count } = useI18n();
  const chain = recordOf(recordOf(data).chain);
  const events = rowsOf<AuditEvent>(recordOf(data).events);
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");

  async function downloadExport() {
    setExportState("loading");
    try {
      const envelope = await getAuditExport();
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `solidchange-audit-${textOf(recordOf(recordOf(envelope.payload).chain).headHash, "export").slice(0, 12)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportState("idle");
    } catch {
      setExportState("failed");
    }
  }

  return (
    <>
      <PageHeading title={t("screen.audit")} description={t("audit.description")} />
      <section className="audit-summary">
        <article className="metric">
          <div><span>{t("audit.integrity")}</span><i data-tone="success" /></div>
          <strong>{chain.verified === true ? t("audit.verified") : t("audit.invalid")}</strong>
          <small>{t("audit.eventCount", { count: safeCount(count, chain.length) })}</small>
        </article>
        <article className="metric audit-head">
          <div><span>{t("audit.headHash")}</span><i data-tone="info" /></div>
          <strong>{truncatedOf(chain.headHash, 16)}</strong>
          <small>{t("audit.headBound")}</small>
        </article>
        <article className="metric">
          <div><span>{t("audit.storage")}</span><i data-tone={chain.durable === true ? "success" : "warning"} /></div>
          <strong>{chain.durable === true ? t("audit.storagePostgres") : t("audit.storageMemory")}</strong>
          <small>{t("audit.retention", { days: safeCount(count, chain.retentionDays) })}</small>
        </article>
      </section>
      <article className="panel">
        <header className="panel-heading">
          <div><h2>{t("audit.eventsTitle")}</h2><p>{t("audit.eventsDescription")}</p></div>
          <div className="audit-actions">
            <Status tone="success">{t("audit.verifiedChain")}</Status>
            <button
              className="button"
              type="button"
              disabled={!mayExport || exportState === "loading"}
              onClick={() => void downloadExport()}
            >
              {exportState === "loading" ? t("common.exporting") : t("audit.export")}
            </button>
          </div>
        </header>
        {exportState === "failed" && (
          <div className="preview-error" role="alert">{t("audit.exportFailed")}</div>
        )}
        <LiveStatus message={exportState === "loading" ? t("audit.liveExporting") : ""} />
        <TableShell label={t("screen.audit")}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t("audit.sequence")}</th>
                <th scope="col">{t("audit.event")}</th>
                <th scope="col">{t("audit.actor")}</th>
                <th scope="col">{t("audit.resource")}</th>
                <th scope="col">{t("audit.outcome")}</th>
                <th scope="col">{t("common.evidence")}</th>
                <th scope="col">{t("audit.previousHash")}</th>
                <th scope="col">{t("audit.hash")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={`${textOf(event.eventId)}:${index}`}>
                  <td className="numeric">#{textOf(event.sequence)}</td>
                  <td>{textOf(event.action)}<small className="cell-note">{textOf(event.occurredAt)}</small></td>
                  <td>{textOf(event.actor)}</td>
                  <td>{textOf(event.resource)}</td>
                  <td><Status tone={toneOf(event.tone)}>{textOf(event.outcome)}</Status></td>
                  <td className="hash-cell">{textOf(event.evidenceDigest)}</td>
                  <td className="hash-cell">{truncatedOf(event.previousHash, 14)}</td>
                  <td className="hash-cell">{truncatedOf(event.hash, 14)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </article>
    </>
  );
}

export function ReportsView({ data }: { data: ReportListPayload }) {
  const { t, count, date } = useI18n();
  const draftLabel = t("reports.draftLabel");
  const reports = rowsOf<ReportDefinition>(recordOf(data).reports);
  const [selected, setSelected] = useState<ReportId | undefined>(
    typeof reports[0]?.id === "string" ? reports[0].id as ReportId : undefined
  );
  const [report, setReport] = useState<DraftReport | undefined>();
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed">("idle");
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setDetailState("loading");
    setReport(undefined);
    getReport(selected)
      .then((payload) => {
        if (!active) return;
        setReport(payload);
        setDetailState("idle");
      })
      .catch(() => {
        if (active) setDetailState("failed");
      });
    return () => {
      active = false;
    };
  }, [selected]);

  async function downloadCsv(id: ReportId) {
    setExportState("loading");
    try {
      const payload = await getReportExport(id);
      const blob = new Blob([textOf(payload.csv, "")], { type: textOf(payload.mediaType, "text/csv") });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = textOf(payload.filename, "report.csv");
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportState("idle");
    } catch {
      setExportState("failed");
    }
  }

  return (
    <>
      <PageHeading title={t("screen.reports")} description={t("reports.description")} />
      <section className="report-draft-banner" role="note">
        <strong>{draftLabel}</strong>
        <span>
          {t("reports.bannerDetail", {
            status: textOf(recordOf(data).status),
            marker: "not_for_submission",
            environment: textOf(recordOf(data).environment),
            from: date(textOf(recordOf(recordOf(data).period).from, ""))
          })}
        </span>
      </section>
      <section className="reports-layout">
        <article className="panel report-list">
          <header className="panel-heading">
            <div><h2>{t("reports.available")}</h2><p>{t("reports.count", { count: count(reports.length) })}</p></div>
          </header>
          <ul>
            {reports.map((item, index) => (
              <li key={`${textOf(item.id)}:${index}`}>
                <button
                  type="button"
                  aria-current={selected === item.id ? "true" : undefined}
                  onClick={() => setSelected(item.id as ReportId)}
                >
                  <strong>{textOf(item.title)}</strong>
                  <small>{textOf(item.description)}</small>
                  <Status tone="warning">{t("reports.draftChip")}</Status>
                </button>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel report-detail">
          {detailState === "loading" && <div className="empty">{t("reports.loading")}</div>}
          <LiveStatus
            message={detailState === "loading" ? t("reports.loading") : exportState === "loading" ? t("reports.liveCsvExporting") : ""}
          />
          {detailState === "failed" && (
            <div className="preview-error" role="alert">{t("reports.failed")}</div>
          )}
          {report && (
            <>
              <header className="panel-heading">
                <div>
                  <h2>{textOf(report.title)}</h2>
                  <p>{t("reports.digest", { draft: draftLabel, digest: textOf(report.contentDigest, "").slice(0, 12) })}</p>
                </div>
                <div className="audit-actions">
                  <Status tone="warning">{t("reports.draftStatus")}</Status>
                  <button
                    className="button"
                    type="button"
                    disabled={exportState === "loading" || typeof report.id !== "string"}
                    onClick={() => void downloadCsv(report.id)}
                  >
                    {exportState === "loading" ? t("common.exporting") : t("reports.downloadCsv")}
                  </button>
                </div>
              </header>
              {exportState === "failed" && (
                <div className="preview-error" role="alert">{t("reports.csvFailed")}</div>
              )}
              <div className="report-sections">
                {rowsOf<ReportSection>(recordOf(report).sections).map((item, sectionIndex) => (
                  <section key={`${textOf(item.id)}:${sectionIndex}`} className="report-section">
                    <h3>{textOf(item.title)}</h3>
                    <dl>
                      {rowsOf<ReportRow>(recordOf(item).rows).map((row, rowIndex) => (
                        <div key={`${textOf(row.key)}:${rowIndex}`}>
                          <dt>{textOf(row.key)}</dt>
                          <dd className="numeric">
                            {textOf(row.value)}
                            {row.unit !== "count" && <small> {textOf(row.unit, "")}</small>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
              {rowsOf<ReportTable>(recordOf(report).tables).map((table, tableIndex) => {
                const columns = arrayOf<unknown>(recordOf(table).columns);
                return (
                  <TableShell key={`${textOf(table.id)}:${tableIndex}`} label={textOf(table.title)}>
                    <table>
                      <thead>
                        <tr>{columns.map((column, columnIndex) => <th scope="col" key={columnIndex}>{textOf(column)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {arrayOf<unknown>(recordOf(table).rows).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {arrayOf<unknown>(row).map((cell, cellIndex) => <td key={cellIndex}>{textOf(cell)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableShell>
                );
              })}
            </>
          )}
        </article>
      </section>
    </>
  );
}

type CheckStatusFilter = CheckStatus | "all";

export function CheckDetail({ item }: { item: ChatCheck }) {
  const { t } = useI18n();
  return (
    <>
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{textOf(item.kind)} · {textOf(item.channel)}</p></div>
        <Status tone={toneOf(item.tone)}>{enumText(t, checkStatusKeyOf(item.status), item.status)}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("checks.sender")}</dt><dd>{textOf(item.sender)} · {textOf(item.senderCustomerId)}</dd></div>
        <div><dt>{t("checks.recipient")}</dt><dd>{textOf(item.recipient)}{item.recipientCustomerId ? ` · ${textOf(item.recipientCustomerId)}` : ""}</dd></div>
        <div><dt>{t("checks.amount")}</dt><dd className="numeric">{textOf(item.amount)} {textOf(item.asset)}</dd></div>
        <div><dt>{t("checks.fee")}</dt><dd className="numeric">{textOf(item.fee)} {textOf(item.asset)}</dd></div>
        {item.comment && <div><dt>{t("checks.comment")}</dt><dd>{textOf(item.comment)}</dd></div>}
        <div><dt>{t("checks.createdAt")}</dt><dd>{textOf(item.createdAt)}</dd></div>
        <div><dt>{t("checks.expiresAt")}</dt><dd>{textOf(item.expiresAt)}</dd></div>
        {item.resolvedAt && <div><dt>{t("checks.resolvedAt")}</dt><dd>{textOf(item.resolvedAt)}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("checks.monitoring")}</h3>
      <WorkflowChecks checks={arrayOf(item.monitoring)} />
      <h3 className="detail-section-title">{t("checks.timeline")}</h3>
      <div className="timeline-list">
        {rowsOf<CheckTimelineEvent>(item.timeline).map((event, index) => (
          <div key={`${textOf(event.id)}:${index}`}>
            <span />
            <div>
              <strong>{textOf(event.action)}</strong>
              <small>{textOf(event.occurredAt)} · {textOf(event.actor)}</small>
              <p>{textOf(event.outcome)}</p>
              <code>{textOf(event.evidenceDigest)}</code>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={arrayOf(item.evidenceItems)} />
      <div className="safe-action">
        <strong>{t("checks.readOnlyTitle")}</strong>
        <p>{t("checks.readOnlyNote")}</p>
      </div>
    </>
  );
}

export function ChecksView({ query, data, focusRef }: { query: string; data: ChecksPayload; focusRef?: string }) {
  const { t, count } = useI18n();
  const statuses = arrayOf<CheckStatus>(recordOf(data).statuses).filter((status) => checkStatusOf(status) !== undefined);
  const [statusFilter, setStatusFilter] = useState<CheckStatusFilter>("all");
  const [checks, setChecks] = useState<readonly ChatCheck[]>(rowsOf<ChatCheck>(recordOf(data).checks));
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");
  const [selectedId, setSelectedId] = useState(focusRef ?? textOf(checks[0]?.id, ""));
  const [detail, setDetail] = useState<ChatCheck | undefined>();
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed">("idle");

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return checks;
    return checks.filter((check) =>
      [check.id, check.sender, check.recipient, check.amount, check.asset, check.status]
        .some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [checks, query]);

  function applyFilter(next: CheckStatusFilter) {
    setStatusFilter(next);
    setExportState("loading");
    getChecks(next === "all" ? undefined : next)
      .then((payload) => {
        const rows = rowsOf<ChatCheck>(recordOf(payload).checks);
        setChecks(rows);
        setSelectedId((current) =>
          rows.some((check) => check.id === current) ? current : textOf(rows[0]?.id, "")
        );
        setExportState("idle");
      })
      .catch(() => setExportState("failed"));
  }

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailState("loading");
    setDetail(undefined);
    getCheck(selectedId)
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
        setDetailState("idle");
      })
      .catch(() => {
        if (active) setDetailState("failed");
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  return (
    <>
      <PageHeading title={t("screen.checks")} description={t("checks.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("checks.queueTitle")}</h2><p>{t("checks.count", { count: count(visible.length) })}</p></div>
            <div className="audit-actions">
              <select
                className="check-filter"
                value={statusFilter}
                disabled={exportState === "loading"}
                onChange={(event) => applyFilter(event.target.value as CheckStatusFilter)}
                aria-label={t("checks.filterLabel")}
                title={t("checks.filterLabel")}
              >
                <option value="all">{t("checks.status.all")}</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{enumText(t, checkStatusKeyOf(status), status)}</option>
                ))}
              </select>
              <Status tone="info">{t("common.readOnly")}</Status>
            </div>
          </header>
          <LiveStatus
            message={exportState === "loading" ? t("checks.loadingList") : detailState === "loading" ? t("checks.loadingDetail") : ""}
          />
          {exportState === "failed" && (
            <div className="preview-error" role="alert">{t("checks.listFailed")}</div>
          )}
          <TableShell label={t("checks.queueTitle")}>
            <table>
              <thead><tr><th scope="col">{t("checks.check")}</th><th scope="col">{t("checks.parties")}</th><th scope="col">{t("checks.amount")}</th><th scope="col">{t("checks.status")}</th><th scope="col">{t("checks.expiresAt")}</th></tr></thead>
              <tbody>
                {visible.map((check, index) => (
                  <tr key={`${textOf(check.id)}:${index}`} data-selected={check.id === selectedId}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={check.id === selectedId ? "true" : undefined}
                        onClick={() => setSelectedId(textOf(check.id, ""))}
                      >
                        {textOf(check.id)}
                      </button>
                      <small className="cell-note">{textOf(check.channel)}</small>
                    </td>
                    <td>
                      {textOf(check.sender)} → {textOf(check.recipient)}
                      <small className="cell-note">
                        {textOf(check.senderCustomerId)}{check.recipientCustomerId ? ` → ${textOf(check.recipientCustomerId)}` : ""}
                      </small>
                    </td>
                    <td className="numeric">{textOf(check.amount)} {textOf(check.asset)}</td>
                    <td><Status tone={toneOf(check.tone)}>{enumText(t, checkStatusKeyOf(check.status), check.status)}</Status></td>
                    <td>{textOf(check.expiresAt)}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr><td colSpan={5}><div className="empty">{t("checks.empty")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        <aside className="panel case-detail">
          {detailState === "loading" && <div className="empty">{t("checks.loadingDetail")}</div>}
          {detailState === "failed" && (
            <div className="preview-error" role="alert">{t("checks.failed")}</div>
          )}
          {detail && <CheckDetail item={detail} />}
        </aside>
      </section>
    </>
  );
}

type TicketStatusFilter = SupportTicketStatus | "all";

export function TicketDetail({ item }: { item: SupportTicket }) {
  const { t } = useI18n();
  return (
    <>
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{enumText(t, ticketChannelKeyOf(item.channel), item.channel)} · {textOf(item.subject)}</p></div>
        <Status tone={toneOf(item.tone)}>{enumText(t, ticketStatusKeyOf(item.status), item.status)}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("support.customer")}</dt><dd>{textOf(item.customer)} · {textOf(item.customerId)}</dd></div>
        <div><dt>{t("support.subject")}</dt><dd>{textOf(item.subject)}</dd></div>
        <div><dt>{t("support.topic")}</dt><dd>{textOf(item.topic)}</dd></div>
        <div><dt>{t("support.priority")}</dt><dd>{enumText(t, ticketPriorityKeyOf(item.priority), item.priority)}</dd></div>
        <div><dt>{t("support.channel")}</dt><dd>{enumText(t, ticketChannelKeyOf(item.channel), item.channel)}</dd></div>
        <div><dt>{t("support.createdAt")}</dt><dd>{textOf(item.createdAt)}</dd></div>
        <div><dt>{t("support.updatedAt")}</dt><dd>{textOf(item.updatedAt)}</dd></div>
        {item.resolvedAt && <div><dt>{t("support.resolvedAt")}</dt><dd>{textOf(item.resolvedAt)}</dd></div>}
        {item.linkedCheckId && <div><dt>{t("support.linkedCheck")}</dt><dd>{textOf(item.linkedCheckId)}</dd></div>}
        {item.linkedKycCaseId && <div><dt>{t("support.linkedKycCase")}</dt><dd>{textOf(item.linkedKycCaseId)}</dd></div>}
        {item.linkedScreeningId && <div><dt>{t("support.linkedScreening")}</dt><dd>{textOf(item.linkedScreeningId)}</dd></div>}
        {item.disputedAmount && <div><dt>{t("support.disputedAmount")}</dt><dd className="numeric">{textOf(item.disputedAmount)} {textOf(item.asset)}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("support.messages")}</h3>
      <div className="timeline-list">
        {rowsOf<SupportTicketMessage>(item.messages).map((message, index) => (
          <div key={`${textOf(message.id)}:${index}`}>
            <span />
            <div>
              <strong>{enumText(t, supportAuthorKeyOf(message.author), message.author)}</strong>
              <small>{textOf(message.occurredAt)}</small>
              <p>{textOf(message.body)}</p>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("support.internalNotes")}</h3>
      <div className="timeline-list">
        {rowsOf<SupportTicketNote>(item.internalNotes).map((note, index) => (
          <div key={`${textOf(note.id)}:${index}`}>
            <span />
            <div>
              <strong>{textOf(note.author)}</strong>
              <small>{textOf(note.occurredAt)}</small>
              <p>{textOf(note.body)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="safe-action">
        <strong>{t("support.readOnlyTitle")}</strong>
        <p>{t("support.readOnlyNote")}</p>
        <div className="ticket-actions">
          <button className="button" type="button" disabled>{t("support.actionReply")}</button>
          <button className="button" type="button" disabled>{t("support.actionAssign")}</button>
          <button className="button" type="button" disabled>{t("support.actionClose")}</button>
        </div>
      </div>
    </>
  );
}

export function SupportView({ query, data, focusRef }: { query: string; data: SupportTicketsPayload; focusRef?: string }) {
  const { t, count } = useI18n();
  const statuses = arrayOf<SupportTicketStatus>(recordOf(data).statuses).filter((status) => ticketStatusOf(status) !== undefined);
  const [statusFilter, setStatusFilter] = useState<TicketStatusFilter>("all");
  const [tickets, setTickets] = useState<readonly SupportTicket[]>(rowsOf<SupportTicket>(recordOf(data).tickets));
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");
  const [selectedId, setSelectedId] = useState(focusRef ?? textOf(tickets[0]?.id, ""));
  const [detail, setDetail] = useState<SupportTicket | undefined>();
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed">("idle");

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return tickets;
    return tickets.filter((ticket) =>
      [ticket.id, ticket.customer, ticket.subject, ticket.topic, ticket.priority, ticket.status]
        .some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [tickets, query]);

  function applyFilter(next: TicketStatusFilter) {
    setStatusFilter(next);
    setExportState("loading");
    getSupportTickets(next === "all" ? undefined : next)
      .then((payload) => {
        const rows = rowsOf<SupportTicket>(recordOf(payload).tickets);
        setTickets(rows);
        setSelectedId((current) =>
          rows.some((ticket) => ticket.id === current) ? current : textOf(rows[0]?.id, "")
        );
        setExportState("idle");
      })
      .catch(() => setExportState("failed"));
  }

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailState("loading");
    setDetail(undefined);
    getSupportTicket(selectedId)
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
        setDetailState("idle");
      })
      .catch(() => {
        if (active) setDetailState("failed");
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  return (
    <>
      <PageHeading title={t("screen.support")} description={t("support.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("support.queueTitle")}</h2><p>{t("support.count", { count: count(visible.length) })}</p></div>
            <div className="audit-actions">
              <select
                className="ticket-filter"
                value={statusFilter}
                disabled={exportState === "loading"}
                onChange={(event) => applyFilter(event.target.value as TicketStatusFilter)}
                aria-label={t("support.filterLabel")}
                title={t("support.filterLabel")}
              >
                <option value="all">{t("support.status.all")}</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{enumText(t, ticketStatusKeyOf(status), status)}</option>
                ))}
              </select>
              <Status tone="info">{t("common.readOnly")}</Status>
            </div>
          </header>
          <LiveStatus
            message={exportState === "loading" ? t("support.loadingList") : detailState === "loading" ? t("support.loadingDetail") : ""}
          />
          {exportState === "failed" && (
            <div className="preview-error" role="alert">{t("support.listFailed")}</div>
          )}
          <TableShell label={t("support.queueTitle")}>
            <table>
              <thead><tr><th scope="col">{t("support.ticket")}</th><th scope="col">{t("support.customer")}</th><th scope="col">{t("support.topic")}</th><th scope="col">{t("support.priority")}</th><th scope="col">{t("support.status")}</th><th scope="col">{t("support.updatedAt")}</th></tr></thead>
              <tbody>
                {visible.map((ticket, index) => (
                  <tr key={`${textOf(ticket.id)}:${index}`} data-selected={ticket.id === selectedId}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={ticket.id === selectedId ? "true" : undefined}
                        onClick={() => setSelectedId(textOf(ticket.id, ""))}
                      >
                        {textOf(ticket.id)}
                      </button>
                      <small className="cell-note">{enumText(t, ticketChannelKeyOf(ticket.channel), ticket.channel)}</small>
                    </td>
                    <td>
                      {textOf(ticket.customer)}
                      <small className="cell-note">{textOf(ticket.subject)} · {textOf(ticket.customerId)}</small>
                    </td>
                    <td>{textOf(ticket.topic)}</td>
                    <td>{enumText(t, ticketPriorityKeyOf(ticket.priority), ticket.priority)}</td>
                    <td><Status tone={toneOf(ticket.tone)}>{enumText(t, ticketStatusKeyOf(ticket.status), ticket.status)}</Status></td>
                    <td>{textOf(ticket.updatedAt)}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr><td colSpan={6}><div className="empty">{t("support.empty")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        <aside className="panel case-detail">
          {detailState === "loading" && <div className="empty">{t("support.loadingDetail")}</div>}
          {detailState === "failed" && (
            <div className="preview-error" role="alert">{t("support.failed")}</div>
          )}
          {detail && <TicketDetail item={detail} />}
        </aside>
      </section>
    </>
  );
}

type WithdrawalStatusFilter = WithdrawalIntentStatus | "all";

export function WithdrawalDetail({ item }: { item: WithdrawalIntent }) {
  const { t, count } = useI18n();
  return (
    <>
      <header className="panel-heading">
        <div><h2>{textOf(item.id)}</h2><p>{textOf(item.intentId)}</p></div>
        <Status tone={toneOf(item.tone)}>{enumText(t, withdrawalStatusKeyOf(item.status), item.status)}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("withdrawals.customer")}</dt><dd>{textOf(item.customer)} · {textOf(item.customerId)}</dd></div>
        <div><dt>{t("withdrawals.subject")}</dt><dd>{textOf(item.subject)}</dd></div>
        <div><dt>{t("withdrawals.amount")}</dt><dd className="numeric">{textOf(item.amount)} {textOf(item.asset)}</dd></div>
        <div><dt>{t("withdrawals.destination")}</dt><dd className="hash-value">{textOf(item.destination)}</dd></div>
        <div><dt>{t("withdrawals.destinationRef")}</dt><dd>{textOf(item.destinationReference)}</dd></div>
        <div><dt>{t("withdrawals.network")}</dt><dd>{textOf(item.network)}</dd></div>
        <div><dt>{t("withdrawals.policyVersion")}</dt><dd>{textOf(item.policyVersion)}</dd></div>
        <div><dt>{t("withdrawals.runtimeBoundary")}</dt><dd>{textOf(item.runtimeBoundary)}</dd></div>
        <div><dt>{t("withdrawals.guardrails")}</dt><dd>{t("withdrawals.guardrailsValue")}</dd></div>
        <div><dt>{t("withdrawals.idempotencyKey")}</dt><dd>{textOf(item.idempotencyKey)}</dd></div>
        <div><dt>{t("withdrawals.correlationId")}</dt><dd>{textOf(item.correlationId)}</dd></div>
        <div><dt>{t("withdrawals.intentDigest")}</dt><dd className="hash-value">{textOf(item.intentDigest)}</dd></div>
        <div><dt>{t("withdrawals.policyDigest")}</dt><dd className="hash-value">{textOf(item.policyDigest)}</dd></div>
        {item.approvalEvidenceDigest && <div><dt>{t("withdrawals.approvalEvidence")}</dt><dd className="hash-value">{textOf(item.approvalEvidenceDigest)}</dd></div>}
        {item.linkedKytCaseId && <div><dt>{t("withdrawals.linkedKytCase")}</dt><dd>{textOf(item.linkedKytCaseId)}</dd></div>}
        {item.linkedApprovalId && <div><dt>{t("withdrawals.linkedApproval")}</dt><dd>{textOf(item.linkedApprovalId)}</dd></div>}
        <div><dt>{t("withdrawals.createdAt")}</dt><dd>{textOf(item.createdAt)}</dd></div>
        <div><dt>{t("withdrawals.updatedAt")}</dt><dd>{textOf(item.updatedAt)}</dd></div>
        <div><dt>{t("withdrawals.expiresAt")}</dt><dd>{textOf(item.expiresAt)}</dd></div>
        {item.resolvedAt && <div><dt>{t("withdrawals.resolvedAt")}</dt><dd>{textOf(item.resolvedAt)}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{textOf(item.auditEvidenceDigest)}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("withdrawals.screening")}</h3>
      <WorkflowChecks checks={arrayOf(item.screening)} />
      <h3 className="detail-section-title">{t("withdrawals.approvalSteps")}</h3>
      <div className="timeline-list">
        {rowsOf<WithdrawalApprovalStep>(item.approvalSteps).map((step, index) => (
          <div key={`${textOf(step.id)}:${index}`}>
            <span />
            <div>
              <strong>{enumText(t, withdrawalRoleKeyOf(step.role), step.role)} · {enumText(t, withdrawalDecisionKeyOf(step.decision), step.decision)}</strong>
              <small>{textOf(step.id)}{step.decidedAt ? ` · ${textOf(step.decidedAt)}` : ""}</small>
              <p>{textOf(step.subjectReference)}{step.stepUpGrantId ? ` · ${textOf(step.stepUpGrantId)}` : ""}</p>
              {step.evidenceDigest && <code>{textOf(step.evidenceDigest)}</code>}
            </div>
          </div>
        ))}
      </div>
      <p className="cell-note">{t("withdrawals.requiredApprovals", { count: safeCount(count, item.requiredApprovals) })}</p>
      <h3 className="detail-section-title">{t("withdrawals.timeline")}</h3>
      <div className="timeline-list">
        {rowsOf<WithdrawalTimelineEvent>(item.timeline).map((event, index) => (
          <div key={`${textOf(event.id)}:${index}`}>
            <span />
            <div>
              <strong>{textOf(event.action)}</strong>
              <small>{textOf(event.occurredAt)} · {textOf(event.actor)}</small>
              <p>{textOf(event.outcome)}</p>
              <code>{textOf(event.evidenceDigest)}</code>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={arrayOf(item.evidenceItems)} />
      <div className="safe-action">
        <strong>{t("withdrawals.readOnlyTitle")}</strong>
        <p>{t("withdrawals.readOnlyNote")}</p>
        <div className="ticket-actions">
          <button className="button" type="button" disabled>{t("withdrawals.actionApprove")}</button>
          <button className="button" type="button" disabled>{t("withdrawals.actionBroadcast")}</button>
          <button className="button" type="button" disabled>{t("withdrawals.actionCancel")}</button>
        </div>
      </div>
    </>
  );
}

export function WithdrawalsView({ query, data, focusRef }: { query: string; data: WithdrawalsPayload; focusRef?: string }) {
  const { t, count } = useI18n();
  const statuses = arrayOf<WithdrawalIntentStatus>(recordOf(data).statuses).filter((status) => withdrawalStatusOf(status) !== undefined);
  const [statusFilter, setStatusFilter] = useState<WithdrawalStatusFilter>("all");
  const [intents, setIntents] = useState<readonly WithdrawalIntent[]>(rowsOf<WithdrawalIntent>(recordOf(data).intents));
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");
  const [selectedId, setSelectedId] = useState(focusRef ?? textOf(intents[0]?.id, ""));
  const [detail, setDetail] = useState<WithdrawalIntent | undefined>();
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed">("idle");

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return intents;
    return intents.filter((intent) =>
      [intent.id, intent.customer, intent.subject, intent.destination, intent.amount, intent.asset, intent.network, intent.status]
        .some((value) => textOf(value, "").toLocaleLowerCase("ru").includes(normalized))
    );
  }, [intents, query]);

  function applyFilter(next: WithdrawalStatusFilter) {
    setStatusFilter(next);
    setExportState("loading");
    getWithdrawals(next === "all" ? undefined : next)
      .then((payload) => {
        const rows = rowsOf<WithdrawalIntent>(recordOf(payload).intents);
        setIntents(rows);
        setSelectedId((current) =>
          rows.some((intent) => intent.id === current) ? current : textOf(rows[0]?.id, "")
        );
        setExportState("idle");
      })
      .catch(() => setExportState("failed"));
  }

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setDetailState("loading");
    setDetail(undefined);
    getWithdrawal(selectedId)
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
        setDetailState("idle");
      })
      .catch(() => {
        if (active) setDetailState("failed");
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  return (
    <>
      <PageHeading title={t("screen.withdrawal")} description={t("withdrawals.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("withdrawals.queueTitle")}</h2><p>{t("withdrawals.count", { count: count(visible.length) })}</p></div>
            <div className="audit-actions">
              <select
                className="check-filter"
                value={statusFilter}
                disabled={exportState === "loading"}
                onChange={(event) => applyFilter(event.target.value as WithdrawalStatusFilter)}
                aria-label={t("withdrawals.filterLabel")}
                title={t("withdrawals.filterLabel")}
              >
                <option value="all">{t("withdrawals.status.all")}</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{enumText(t, withdrawalStatusKeyOf(status), status)}</option>
                ))}
              </select>
              <Status tone="info">{t("common.readOnly")}</Status>
            </div>
          </header>
          <LiveStatus
            message={exportState === "loading" ? t("withdrawals.loadingList") : detailState === "loading" ? t("withdrawals.loadingDetail") : ""}
          />
          {exportState === "failed" && (
            <div className="preview-error" role="alert">{t("withdrawals.listFailed")}</div>
          )}
          <TableShell label={t("withdrawals.queueTitle")}>
            <table>
              <thead><tr><th scope="col">{t("withdrawals.intent")}</th><th scope="col">{t("withdrawals.customer")}</th><th scope="col">{t("withdrawals.destination")}</th><th scope="col">{t("withdrawals.amount")}</th><th scope="col">{t("withdrawals.status")}</th><th scope="col">{t("withdrawals.updatedAt")}</th></tr></thead>
              <tbody>
                {visible.map((intent, index) => (
                  <tr key={`${textOf(intent.id)}:${index}`} data-selected={intent.id === selectedId}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={intent.id === selectedId ? "true" : undefined}
                        onClick={() => setSelectedId(textOf(intent.id, ""))}
                      >
                        {textOf(intent.id)}
                      </button>
                      <small className="cell-note">{textOf(intent.network)}</small>
                    </td>
                    <td>
                      {textOf(intent.customer)}
                      <small className="cell-note">{textOf(intent.subject)} · {textOf(intent.customerId)}</small>
                    </td>
                    <td className="hash-value">{textOf(intent.destination)}</td>
                    <td className="numeric">{textOf(intent.amount)} {textOf(intent.asset)}</td>
                    <td><Status tone={toneOf(intent.tone)}>{enumText(t, withdrawalStatusKeyOf(intent.status), intent.status)}</Status></td>
                    <td>{textOf(intent.updatedAt)}</td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr><td colSpan={6}><div className="empty">{t("withdrawals.empty")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        <aside className="panel case-detail">
          {detailState === "loading" && <div className="empty">{t("withdrawals.loadingDetail")}</div>}
          {detailState === "failed" && (
            <div className="preview-error" role="alert">{t("withdrawals.failed")}</div>
          )}
          {detail && <WithdrawalDetail item={detail} />}
        </aside>
      </section>
    </>
  );
}

// Timeline entries link into the detail views only where that entity kind has
// a dedicated screen and the operator can read it; everything else renders as
// a plain reference so the feed stays read-only and permission-aware.
export function SubjectsView({
  session,
  onOpen
}: {
  session: SessionPayload;
  onOpen: (screen: ScreenId, ref: string) => void;
}) {
  const { t, count, date, time } = useI18n();
  const [refInput, setRefInput] = useState("");
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed" | "invalid" | "not-found">("idle");
  const [timeline, setTimeline] = useState<SubjectTimelinePayload | undefined>();

  const entries = useMemo(() => rowsOf<SubjectTimelineEntry>(recordOf(timeline).entries), [timeline]);

  const groups = useMemo(() => {
    const byDay = new Map<string, SubjectTimelineEntry[]>();
    for (const entry of entries) {
      const day = textOf(entry.at, "").slice(0, 10);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(entry);
      else byDay.set(day, [entry]);
    }
    return [...byDay.entries()];
  }, [entries]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ref = refInput.trim();
    if (!ref || detailState === "loading") return;
    setDetailState("loading");
    setTimeline(undefined);
    getSubjectTimeline(ref)
      .then((payload) => {
        setTimeline(payload);
        setDetailState("idle");
      })
      .catch((error: unknown) => {
        setTimeline(undefined);
        if (error instanceof ApiError && error.status === 404) setDetailState("not-found");
        else if (error instanceof ApiError && error.status === 400) setDetailState("invalid");
        else setDetailState("failed");
      });
  }

  function linkTarget(entry: SubjectTimelineEntry): ScreenId | undefined {
    const target = subjectEntryLinkOf(entry.kind);
    return target && hasCapability(session, target.capability) ? target.screen : undefined;
  }

  return (
    <>
      <PageHeading title={t("screen.subjects")} description={t("subjects.description")} />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>{t("subjects.lookupTitle")}</h2><p>{t("subjects.lookupHint")}</p></div>
            <Status tone="info">{t("common.readOnly")}</Status>
          </header>
          <form className="subject-lookup" onSubmit={submit}>
            <input
              type="text"
              value={refInput}
              onChange={(event) => setRefInput(event.target.value)}
              placeholder={t("subjects.refPlaceholder")}
              aria-label={t("subjects.refLabel")}
              autoComplete="off"
            />
            <button
              className="button primary"
              type="submit"
              disabled={detailState === "loading" || !refInput.trim()}
            >
              {detailState === "loading" ? t("subjects.searching") : t("subjects.submit")}
            </button>
          </form>
          <LiveStatus message={detailState === "loading" ? t("subjects.searching") : ""} />
          {detailState === "invalid" && <div className="preview-error" role="alert">{t("subjects.invalidRef")}</div>}
          {detailState === "not-found" && <div className="preview-error" role="alert">{t("subjects.notFound")}</div>}
          {detailState === "failed" && <div className="preview-error" role="alert">{t("subjects.failed")}</div>}
          {!timeline && detailState === "idle" && <p className="cell-note">{t("subjects.empty")}</p>}
          {timeline && (
            <>
              <dl className="detail-list">
                <div><dt>{t("subjects.subject")}</dt><dd className="hash-value">{textOf(recordOf(timeline).subject)}</dd></div>
                <div><dt>{t("subjects.entriesLabel")}</dt><dd>{t("subjects.count", { count: count(entries.length) })}</dd></div>
              </dl>
              {groups.map(([day, entries]) => (
                <section key={day} className="subject-day">
                  <h3>{date(textOf(entries[0]?.at, day))}</h3>
                  <div className="timeline-list">
                    {entries.map((entry, index) => {
                      const target = entry === undefined ? undefined : linkTarget(entry);
                      return (
                        <div key={`${textOf(entry.kind)}:${textOf(entry.ref)}:${index}`}>
                          <span />
                          <div>
                            <strong>
                              <Status tone="info">{enumText(t, subjectKindKeyOf(entry.kind), entry.kind)}</Status>{" "}
                              {target ? (
                                <button
                                  type="button"
                                  className="table-link"
                                  onClick={() => onOpen(target, textOf(entry.ref, ""))}
                                >
                                  {textOf(entry.ref)}
                                </button>
                              ) : (
                                <code>{textOf(entry.ref)}</code>
                              )}
                            </strong>
                            <small>{time(textOf(entry.at, ""))}</small>
                            <p>{textOf(entry.summary)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </>
          )}
          <div className="safe-action">
            <strong>{t("subjects.readOnlyTitle")}</strong>
            <p>{t("subjects.readOnlyNote")}</p>
          </div>
        </article>
      </section>
    </>
  );
}

function PlaceholderView({ item }: { item: NavigationItem }) {
  const { t, intlTag } = useI18n();
  const label = t(screenKey(item.id));
  return (
    <>
      <PageHeading title={label} description={t("placeholder.description")} />
      <section className="panel placeholder">
        <span>{label.slice(0, 2).toLocaleUpperCase(intlTag)}</span>
        <h2>{t("placeholder.title")}</h2>
        <p>{t("placeholder.note")}</p>
      </section>
    </>
  );
}

function PageHeading({ title, description }: { title: string; description: string }) {
  const { t } = useI18n();
  return (
    <header className="page-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      <div className="page-actions">
        <Status tone="success">{t("common.dev")}</Status>
        <Status>{t("common.dryRun")}</Status>
      </div>
    </header>
  );
}

interface WorkspaceData {
  session: SessionPayload;
  dashboard: DashboardPayload;
  customers: CustomersPayload;
  checks?: ChecksPayload;
  support?: SupportTicketsPayload;
  withdrawals?: WithdrawalsPayload;
  kyc?: KycPayload;
  aml?: AmlPayload;
  investigations?: InvestigationsPayload;
  fraud?: FraudPayload;
  approvals?: ApprovalsPayload;
  audit?: AuditPayload;
  reports?: ReportListPayload;
}

type AccessState =
  | { status: "loading" }
  | { status: "signed-out"; health: HealthPayload }
  | { status: "failed"; reason: MessageKey; detail?: string }
  | { status: "ready"; health: HealthPayload; data: WorkspaceData };

function hasCapability(session: SessionPayload, capability: Capability): boolean {
  return capabilitiesOf(session?.operator).includes(capability);
}

function AccessGate({
  state,
  theme,
  onDevLogin
}: {
  state: Exclude<AccessState, { status: "ready" }>;
  theme: Theme;
  onDevLogin: (role: OperatorRole) => Promise<void>;
}) {
  const { t } = useI18n();
  const [role, setRole] = useState<OperatorRole>("compliance-lead");
  const [submitting, setSubmitting] = useState(false);

  async function submitDevLogin() {
    setSubmitting(true);
    try {
      await onDevLogin(role);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="access-shell" data-theme={theme}>
      <Backdrop />
      <main className="access-card">
        <div className="brand access-brand">
          <span>S</span>
          <div>
            <strong>SOLID</strong>
            <small className="access-subtitle">{t("app.brandSubtitle")}</small>
          </div>
        </div>
        {state.status === "loading" && (
          <>
            <h1 className="access-title">{t("access.loadingTitle")}</h1>
            <p className="access-copy">{t("access.loadingCopy")}</p>
            <Status tone="info">{t("access.sessionCheck")}</Status>
          </>
        )}
        {state.status === "failed" && (
          <>
            <h1 className="access-title">{t("access.failedTitle")}</h1>
            <p className="access-copy" role="alert">
              {t(state.reason)}
              {state.detail ? ` ${t("access.errorDetail", { detail: state.detail })}` : ""}
            </p>
            <Status tone="danger">{t("access.failClosed")}</Status>
          </>
        )}
        {state.status === "signed-out" && (
          <>
            <h1 className="access-title">{t("access.signedOutTitle")}</h1>
            <p className="access-copy">{t("access.signedOutCopy")}</p>
            {state.health.oidcConfigured && (
              <a className="button primary access-action access-button" href="/bff/auth/login">{t("access.ssoLogin")}</a>
            )}
            {state.health.devLoginEnabled && (
              <div className="dev-login">
                <label>
                  <span>{t("access.devRole")}</span>
                  <select
                    className="dev-role-select"
                    value={role}
                    onChange={(event) => setRole(event.target.value as OperatorRole)}
                  >
                    {roleProfiles.map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>{t(`role.${candidate.id}`)}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="button primary access-button"
                  type="button"
                  disabled={submitting}
                  onClick={submitDevLogin}
                >
                  {t("access.openWorkspace")}
                </button>
              </div>
            )}
            {!state.health.oidcConfigured && !state.health.devLoginEnabled && (
              <Status tone="warning">{t("access.oidcNotConfigured")}</Status>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export function App() {
  const { t, locale, setLocale, longDate } = useI18n();
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [screen, setScreen] = useState<ScreenId>(initialScreen);
  const [entityFocus, setEntityFocus] = useState<{ screen: ScreenId; ref: string } | undefined>();
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  const [density, setDensity] = useState<Density>("compact");
  const [railExpanded, setRailExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number }>();
  const mainRef = useRef<HTMLElement>(null);
  const navigationId = useId();

  useEffect(() => {
    if (!tooltip) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setTooltip(undefined);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tooltip]);

  const loadWorkspace = useCallback(async () => {
    try {
      const [health, authStatus] = await Promise.all([getHealth(), getAuthStatus()]);
      if (!authStatus.authenticated) {
        setAccess({ status: "signed-out", health });
        return;
      }
      let session: SessionPayload;
      try {
        session = await getSession();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setAccess({ status: "signed-out", health });
          return;
        }
        throw error;
      }

      const [dashboard, customers, checks, support, withdrawals, kyc, aml, investigations, fraud, approvals, audit, reports] = await Promise.all([
        getDashboard(),
        getCustomers(),
        hasCapability(session, "checks:read") ? getChecks() : Promise.resolve(undefined),
        hasCapability(session, "support:read") ? getSupportTickets() : Promise.resolve(undefined),
        hasCapability(session, "custody:read") ? getWithdrawals() : Promise.resolve(undefined),
        hasCapability(session, "kyc:read") ? getKycCases() : Promise.resolve(undefined),
        hasCapability(session, "aml:read") ? getAmlCases() : Promise.resolve(undefined),
        hasCapability(session, "investigations:read") ? getInvestigations() : Promise.resolve(undefined),
        hasCapability(session, "fraud:read") ? getFraudAlerts() : Promise.resolve(undefined),
        hasCapability(session, "approvals:read") ? getApprovals() : Promise.resolve(undefined),
        hasCapability(session, "audit:read") ? getAudit() : Promise.resolve(undefined),
        hasCapability(session, "reports:read") ? getReports() : Promise.resolve(undefined)
      ]);
      setAccess({
        status: "ready",
        health,
        data: { session, dashboard, customers, checks, support, withdrawals, kyc, aml, investigations, fraud, approvals, audit, reports }
      });
    } catch (error) {
      setAccess({
        status: "failed",
        reason: "access.errorBoundary",
        detail: error instanceof Error ? error.message : undefined
      });
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  async function switchDevRole(role: OperatorRole) {
    setAccess({ status: "loading" });
    try {
      await createDevSession(role);
      await loadWorkspace();
    } catch (error) {
      setAccess({
        status: "failed",
        reason: "access.errorDevSession",
        detail: error instanceof Error ? error.message : undefined
      });
    }
  }

  async function endSession() {
    setAccess({ status: "loading" });
    try {
      await logout();
      setScreen("dashboard");
      window.history.replaceState(null, "", "#dashboard");
      await loadWorkspace();
    } catch (error) {
      setAccess({
        status: "failed",
        reason: "access.errorLogout",
        detail: error instanceof Error ? error.message : undefined
      });
    }
  }

  useEffect(() => {
    const onHashChange = () => setScreen(initialScreen());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (access.status !== "ready") return;
    const active = navigation.find((item) => item.id === screen);
    if (active?.capability && !hasCapability(access.data.session, active.capability)) {
      setScreen("dashboard");
      window.history.replaceState(null, "", "#dashboard");
    }
  }, [access, screen]);

  if (access.status !== "ready") {
    return <AccessGate state={access} theme={theme} onDevLogin={switchDevRole} />;
  }

  const { session } = access.data;
  const operator = recordOf(session?.operator);
  const profile = {
    name: textOf(operator.name),
    initials: textOf(operator.initials),
    role: operatorRoleOf(operator.role)
  };
  const operatorCapabilities = capabilitiesOf(session?.operator);

  function selectScreen(item: NavigationItem) {
    if (item.capability && !hasCapability(session, item.capability)) return;
    setEntityFocus(undefined);
    setScreen(item.id);
    window.history.replaceState(null, "", `#${item.id}`);
  }

  function openEntityDetail(target: ScreenId, ref: string) {
    setEntityFocus({ screen: target, ref });
    setScreen(target);
    window.history.replaceState(null, "", `#${target}`);
  }

  const activeItem = navigation.find((item) => item.id === screen) ?? navigation[0];
  const isDenied = (item: NavigationItem) =>
    Boolean(item.capability && !hasCapability(session, item.capability));
  const label = t(screenKey(activeItem.id));
  const today = longDate(new Date());

  function showTooltip(target: HTMLElement, label: string) {
    const rect = target.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 12 });
  }

  return (
    <div className="app" data-theme={theme} data-density={density} data-rail={railExpanded ? "expanded" : "collapsed"}>
      <button className="skip-link" type="button" onClick={() => mainRef.current?.focus()}>
        {t("app.skipToContent")}
      </button>
      <Backdrop />
      <aside className="sidebar">
        <div className="brand"><span>S</span><div><strong>SOLID</strong><small>{t("app.brandSubtitle")}</small></div></div>
        <button
          className="rail-toggle"
          type="button"
          aria-expanded={railExpanded}
          aria-controls={navigationId}
          aria-label={railExpanded ? t("app.collapseNavigation") : t("app.expandNavigation")}
          onClick={() => {
            setTooltip(undefined);
            setRailExpanded(!railExpanded);
          }}
        >
          <UiIcon name={railExpanded ? "collapse" : "expand"} />
        </button>
        <nav id={navigationId} aria-label={t("app.navigationLabel")} onScroll={() => setTooltip(undefined)}>
          {navigationGroups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{t(`group.${group}`)}</p>
              {navigation.filter((item) => item.group === group).map((item) => {
                const denied = isDenied(item);
                const itemLabel = t(screenKey(item.id));
                const hint = denied
                  ? t("nav.deniedHint", { label: itemLabel })
                  : !item.implemented
                    ? t("nav.soonHint", { label: itemLabel })
                    : itemLabel;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={screen === item.id ? "page" : undefined}
                    aria-disabled={denied}
                    onClick={() => selectScreen(item)}
                    title={!item.implemented ? t("nav.nextSlice") : denied ? t("nav.denied") : ""}
                    onMouseEnter={(event) => showTooltip(event.currentTarget, hint)}
                    onMouseLeave={() => setTooltip(undefined)}
                    onFocus={(event) => showTooltip(event.currentTarget, hint)}
                    onBlur={() => setTooltip(undefined)}
                  >
                    <span><ScreenIcon id={item.id} /></span>
                    <strong>{itemLabel}</strong>
                    {!item.implemented && <small>{t("nav.soon")}</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="session-note" title={`${t("app.protectedTitle")} · ${t("app.protectedDetail")}`}>
          <UiIcon name="shield" />
          <strong>{t("app.protectedTitle")}</strong>
          <span>{t("app.protectedDetail")}</span>
        </div>
      </aside>
      {!railExpanded && tooltip && (
        <span className="rail-tooltip" role="tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
          {tooltip.label}
        </span>
      )}

      <div className="workspace">
        <header className="topbar">
          <div className="greeting">
            <strong>{t("app.greeting", { name: enumText(t, operatorRoleKeyOf(operator.role), operator.role) })}</strong>
            <small>{today}</small>
          </div>
          <label className="search">
            <span aria-hidden="true"><UiIcon name="search" /></span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("app.searchPlaceholder")}
              aria-label={t("app.searchLabel")}
            />
          </label>
          <div className="topbar-spacer" />
          <span className="environment"><i />{t("app.environment")}</span>
          <select
            className="locale-select"
            value={locale}
            onChange={(event) => {
              if (isLocale(event.target.value)) setLocale(event.target.value);
            }}
            aria-label={t("app.languageLabel")}
            title={t("app.languageLabel")}
          >
            {locales.map((candidate) => (
              <option value={candidate} key={candidate} lang={candidate}>{localeNames[candidate]}</option>
            ))}
          </select>
          <button
            className="icon-button density-button"
            type="button"
            onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            aria-label={density === "compact" ? t("app.switchToComfortable") : t("app.switchToCompact")}
            title={density === "compact" ? t("app.comfortableDensity") : t("app.compactDensity")}
          >
            <UiIcon name={density === "compact" ? "density" : "comfortable"} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? t("app.switchToDark") : t("app.switchToLight")}
            title={theme === "light" ? t("app.darkTheme") : t("app.lightTheme")}
          >
            <UiIcon name={theme === "light" ? "moon" : "sun"} />
          </button>
          <span className="avatar" aria-hidden="true">{profile.initials}</span>
          {access.health.devLoginEnabled ? (
            <label className="role">
              <span>{profile.name}</span>
              <select
                value={profile.role ?? ""}
                onChange={(event) => void switchDevRole(event.target.value as OperatorRole)}
                aria-label={t("app.devRoleLabel")}
              >
                {roleProfiles.map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>{t(`role.${candidate.id}`)}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="role">
              <span>{profile.name}</span>
              <small>{enumText(t, operatorRoleKeyOf(operator.role), operator.role)}</small>
            </div>
          )}
          <button className="icon-button" type="button" onClick={() => void endSession()} aria-label={t("app.endSession")} title={t("app.endSession")}>
            <UiIcon name="logout" />
          </button>
        </header>

        <main ref={mainRef} tabIndex={-1}>
          <LiveStatus message={t("app.currentSection", { label })} />
          <nav className="segmented" aria-label={t("app.sectionGroupsLabel")}>
            {navigationGroups.map((group) => {
              const target = navigation.find((item) => item.group === group && !isDenied(item));
              return (
                <button
                  key={group}
                  type="button"
                  aria-current={activeItem.group === group ? "true" : undefined}
                  disabled={!target}
                  onClick={() => {
                    if (target) selectScreen(target);
                  }}
                >
                  {t(`group.${group}`)}
                </button>
              );
            })}
          </nav>
          {screen === "dashboard" && <DashboardView data={access.data.dashboard} />}
          {screen === "customers" && (
            <CustomersView query={query} data={access.data.customers} />
          )}
          {screen === "checks" && access.data.checks && (
            <ChecksView
              query={query}
              data={access.data.checks}
              focusRef={entityFocus?.screen === "checks" ? entityFocus.ref : undefined}
            />
          )}
          {screen === "support" && access.data.support && (
            <SupportView
              query={query}
              data={access.data.support}
              focusRef={entityFocus?.screen === "support" ? entityFocus.ref : undefined}
            />
          )}
          {screen === "withdrawal" && access.data.withdrawals && (
            <WithdrawalsView
              query={query}
              data={access.data.withdrawals}
              focusRef={entityFocus?.screen === "withdrawal" ? entityFocus.ref : undefined}
            />
          )}
          {screen === "subjects" && (
            <SubjectsView session={access.data.session} onOpen={openEntityDetail} />
          )}
          {screen === "kyc" && access.data.kyc && (
            <KycView query={query} data={access.data.kyc} />
          )}
          {screen === "aml" && access.data.aml && (
            <AmlView query={query} data={access.data.aml} />
          )}
          {screen === "investigations" && access.data.investigations && (
            <InvestigationsView query={query} data={access.data.investigations} />
          )}
          {screen === "fraud" && access.data.fraud && (
            <FraudView query={query} data={access.data.fraud} />
          )}
          {screen === "approvals" && access.data.approvals && (
            <ApprovalsView
              capabilities={operatorCapabilities}
              data={access.data.approvals}
            />
          )}
          {screen === "audit" && access.data.audit && (
            <AuditView
              data={access.data.audit}
              mayExport={hasCapability(access.data.session, "audit:export")}
            />
          )}
          {screen === "reports" && access.data.reports && <ReportsView data={access.data.reports} />}
          {!activeItem.implemented && <PlaceholderView item={activeItem} />}
        </main>
      </div>
    </div>
  );
}
