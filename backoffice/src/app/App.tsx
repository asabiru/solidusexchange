import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { roleProfiles, type Capability, type OperatorRole } from "../auth/access";
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
  getSupportTicket,
  getSupportTickets,
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
  type SupportTicketsPayload
} from "../data/client";
import type { DraftReport, ReportId, ReportListPayload } from "../data/reports";
import type {
  AmlCase,
  ApprovalPreview,
  ApprovalSummary,
  ChatCheck,
  CheckStatus,
  EvidenceItem,
  FraudAlert,
  InvestigationCase,
  KycCase,
  QueueRow,
  SupportTicket,
  SupportTicketStatus,
  Tone,
  WorkflowCheck
} from "../data/demo";
import type {
  KycProviderEvidence,
  KytProviderEvidence,
  ProviderCallbackRecord,
  ProviderEvidenceFeed
} from "../data/provider-evidence";
import { navigation, navigationGroups, type NavigationItem, type ScreenId } from "./navigation";
import { runtime } from "./runtime";
import { ScreenIcon, UiIcon } from "./icons";
import { hasMessage, isLocale, localeNames, locales, type MessageKey } from "./i18n";
import { useI18n } from "./i18n-context";

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
  return <span className="status" data-tone={tone}>{children}</span>;
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
  const width = 300;
  const height = 132;
  const pad = 14;
  const max = Math.max(1, ...queues.map((row) => row.total));
  const x = (index: number) => pad + (index * (width - pad * 2)) / Math.max(1, queues.length - 1);
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const line = (key: "total" | "critical") =>
    queues.map((row, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(row[key]).toFixed(1)}`).join(" ");
  const area = `${line("total")} L${x(queues.length - 1).toFixed(1)} ${height - pad} L${x(0).toFixed(1)} ${height - pad} Z`;
  return (
    <figure className="queue-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("dashboard.chartLabel")}>
        <path className="queue-chart-area" d={area} />
        <path className="queue-chart-total" d={line("total")} />
        <path className="queue-chart-critical" d={line("critical")} />
        {queues.map((row, index) => (
          <circle key={row.queue} cx={x(index)} cy={y(row.total)} r="3.5" />
        ))}
      </svg>
      <figcaption>
        {queues.map((row) => (
          <span key={row.queue}><strong>{row.total}</strong>{row.queue}</span>
        ))}
      </figcaption>
    </figure>
  );
}

function DisabledSwitch({ label }: { label: string }) {
  return <input className="switch" type="checkbox" role="switch" aria-checked={false} checked={false} disabled readOnly aria-label={label} />;
}

function DashboardView({ data }: { data: DashboardPayload }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeading title={t("screen.dashboard")} description={t("dashboard.description")} />
      <section className="metrics" aria-label={t("dashboard.metricsLabel")}>
        {data.metrics.map((metric, index) => (
          <article className="metric" data-accent={index === 0 ? "true" : undefined} key={metric.label}>
            <div><span>{metric.label}</span><i data-tone={metric.tone} /></div>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
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
                {data.queues.map((row) => (
                  <tr key={row.queue}>
                    <td><button className="table-link" type="button">{row.queue}</button></td>
                    <td>{row.critical}</td>
                    <td>{row.total}</td>
                    <td>{row.oldest}</td>
                    <td><Status tone={row.tone}>{row.sla}</Status></td>
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
          <QueueChart queues={data.queues} />
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

function CustomersView({ query, data }: { query: string; data: CustomersPayload }) {
  const { t, count } = useI18n();
  const customers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return data.customers;
    return data.customers.filter((customer) =>
      [
        customer.id,
        customer.name,
        customer.country,
        customer.segment,
        customer.nextAction,
        customer.kycCaseId
      ]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [data.customers, query]);
  const [selectedId, setSelectedId] = useState(data.customers[0]?.id ?? "");
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
                {customers.map((customer) => (
                  <tr key={customer.id} data-selected={customer.id === selected?.id}>
                    <td>
                      <button
                        className="person"
                        type="button"
                        aria-current={customer.id === selected?.id ? "true" : undefined}
                        onClick={() => setSelectedId(customer.id)}
                      >
                        <span>{customer.initials}</span>
                        <span>
                          <strong>{customer.name}</strong>
                          <small>{customer.id} · {customer.country} · {customer.segment}</small>
                        </span>
                      </button>
                    </td>
                    <td><Status tone={customer.kyc === "Verified" ? "success" : "warning"}>{customer.kyc}</Status></td>
                    <td><Status tone={customer.tone}>{customer.risk} · {customer.riskScore}</Status></td>
                    <td className="numeric">{customer.volume}</td>
                    <td>{customer.nextAction}</td>
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
              <div><h2>{selected.name}</h2><p>{selected.id} · {selected.kind}</p></div>
              <Status tone={selected.tone}>{selected.risk}</Status>
            </header>
            <div className="risk-score">
              <span>{t("common.riskScore")}</span>
              <strong>{selected.riskScore}</strong>
              <p>{selected.riskReason}</p>
            </div>
            <dl className="detail-list">
              <div><dt>{t("customers.kycCase")}</dt><dd>{selected.kycCaseId}</dd></div>
              <div><dt>{t("customers.openAmlCases")}</dt><dd>{selected.openAmlCases}</dd></div>
              <div><dt>{t("customers.restriction")}</dt><dd>{selected.restriction}</dd></div>
              <div><dt>{t("customers.lastReviewed")}</dt><dd>{selected.lastReviewedAt}</dd></div>
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

function EvidenceList({ items }: { items: readonly EvidenceItem[] }) {
  return (
    <div className="evidence-list">
      {items.map((item) => (
        <div key={item.id}>
          <span>
            <strong>{item.label}</strong>
            <small>{item.digest}</small>
          </span>
          <Status tone={item.status === "ready" ? "success" : "danger"}>{item.status}</Status>
        </div>
      ))}
    </div>
  );
}

function WorkflowChecks({ checks }: { checks: readonly WorkflowCheck[] }) {
  return (
    <div className="check-list">
      {checks.map((check) => (
        <div key={check.id}>
          <span>
            <strong>{check.label}</strong>
            <small>{check.detail}</small>
          </span>
          <Status tone={check.tone}>{check.status}</Status>
        </div>
      ))}
    </div>
  );
}

function linkedEvidence<T extends KycProviderEvidence | KytProviderEvidence>(
  feed: ProviderEvidenceFeed<T>,
  caseId: string
): string {
  const ids = feed.cases.filter((item) => item.linkedCaseId === caseId).map((item) => item.id);
  return ids.join(", ");
}

function CallbackList({ records }: { records: readonly ProviderCallbackRecord[] }) {
  const { t } = useI18n();
  if (!records.length) return <div className="empty">{t("evidence.noCallbacks")}</div>;
  return (
    <div className="check-list">
      {records.map((record) => (
        <div key={record.deliveryId}>
          <span>
            <strong>
              {record.deliveryId}
              {record.sequence !== null ? ` · ${t("evidence.callbackSequence", { sequence: record.sequence })}` : ""}
              {record.status ? ` · ${record.status}` : ""}
            </strong>
            <small>
              {record.deliveredAt} · {record.origin}
              {record.probe ? ` (${record.probe})` : ""}
              {record.verificationReason ? ` · ${record.verificationReason}` : ""}
            </small>
          </span>
          <Status tone={record.verification === "rejected" ? "danger" : record.accepted ? "success" : "warning"}>
            {record.verification === "rejected" ? t("common.callbackRejected") : record.inboxAction ?? t("common.callbackVerified")}
          </Status>
        </div>
      ))}
    </div>
  );
}

function ProviderEvidencePanel<T extends KycProviderEvidence | KytProviderEvidence>({
  title,
  feed
}: {
  title: string;
  feed: ProviderEvidenceFeed<T>;
}) {
  const { t, count } = useI18n();
  const [selectedId, setSelectedId] = useState(feed.cases[0]?.id ?? "");
  const selected = feed.cases.find((item) => item.id === selectedId) ?? feed.cases[0];

  return (
    <section className="grid risk-grid">
      <article className="panel">
        <header className="panel-heading">
          <div><h2>{title}</h2><p>{t("evidence.count", { count: count(feed.cases.length) })}</p></div>
          <Status tone="info">{t("evidence.only")}</Status>
        </header>
        <TableShell label={title}>
          <table>
            <thead><tr><th scope="col">{t("evidence.run")}</th><th scope="col">{t("common.scenario")}</th><th scope="col">{t("evidence.providerClaim")}</th><th scope="col">{t("evidence.projection")}</th><th scope="col">{t("evidence.sequence")}</th><th scope="col">{t("evidence.callbacks")}</th></tr></thead>
            <tbody>
              {feed.cases.map((item) => (
                <tr key={item.id} data-selected={item.id === selected?.id}>
                  <td>
                    <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
                      {item.id}
                    </button>
                    <small className="cell-note">{item.linkedCaseId ?? t("evidence.unlinked")}</small>
                  </td>
                  <td>{item.label}<small className="cell-note">{item.scenario}</small></td>
                  <td>{item.providerStatus}</td>
                  <td><Status tone={item.tone}>{item.projectedStatus}</Status></td>
                  <td className="numeric">{item.sequence}</td>
                  <td>
                    {t("evidence.verifiedCount", { verified: item.verification.verified, delivered: item.verification.delivered })}
                    <small className="cell-note">{t("evidence.rejectedHeld", { rejected: item.verification.rejected, held: item.verification.heldForReview })}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </article>
      {selected && (
        <aside className="panel case-detail">
          <header className="panel-heading">
            <div><h2>{selected.id}</h2><p>{selected.source} · {selected.environment}</p></div>
            <Status tone={selected.tone}>{selected.projectedStatus}</Status>
          </header>
          <dl className="detail-list">
            <div><dt>{t("evidence.providerReference")}</dt><dd className="hash-value">{selected.providerReference ?? "—"}</dd></div>
            {selected.domain === "kyc" ? (
              <div><dt>{t("evidence.applicant")}</dt><dd>{selected.applicantRef} · {selected.level}</dd></div>
            ) : (
              <>
                <div><dt>{t("evidence.binding")}</dt><dd>{selected.asset} · {selected.network} · {selected.direction}</dd></div>
                <div><dt>{t("common.risk")}</dt><dd>{selected.riskLevel ?? "—"} · {selected.riskScore ?? "—"}{selected.sanctionsHit ? ` · ${t("evidence.sanctionsHit")}` : ""}</dd></div>
              </>
            )}
            <div><dt>{t("evidence.reasonCodes")}</dt><dd>{selected.reasonCodes.length ? selected.reasonCodes.join(", ") : "—"}</dd></div>
            {selected.domain === "kyc" && selected.requestedItems.length > 0 && (
              <div><dt>{t("evidence.requestedItems")}</dt><dd>{selected.requestedItems.join(", ")}</dd></div>
            )}
            <div><dt>{t("evidence.verification")}</dt><dd>{selected.verification.result}</dd></div>
            <div><dt>{t("evidence.deadline")}</dt><dd>{selected.deadline ?? "—"}{selected.timedOut ? ` · ${t("evidence.timedOut")}` : ""}</dd></div>
            {selected.outage && <div><dt>{t("evidence.outage")}</dt><dd>{selected.outage.code}{selected.outage.retryable ? ` · ${t("evidence.retryable")}` : ""}</dd></div>}
          </dl>
          <h3 className="detail-section-title">{t("evidence.receivedCallbacks")}</h3>
          <CallbackList records={selected.receivedCallbacks} />
          <h3 className="detail-section-title">{t("evidence.rejectedCallbacks")}</h3>
          <CallbackList records={selected.rejectedCallbacks} />
          <div className="safe-action">
            <strong>{t("evidence.decisionTitle")}</strong>
            <p>{t("evidence.decisionNote")}</p>
          </div>
        </aside>
      )}
    </section>
  );
}

function KycView({ query, data }: { query: string; data: KycPayload }) {
  const { t, count } = useI18n();
  const cases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return data.cases;
    return data.cases.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.type,
        item.status,
        item.stage,
        item.jurisdiction
      ].some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [data.cases, query]);
  const [selectedId, setSelectedId] = useState(data.cases[0]?.id ?? "");
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
                {cases.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
                        {item.id}
                      </button>
                      <small className="cell-note">{item.type} · {item.status}</small>
                    </td>
                    <td>{item.subject}<small className="cell-note">{item.customerId}</small></td>
                    <td>{item.stage}</td>
                    <td><Status tone={item.tone}>{item.riskRating} · {item.riskScore}</Status></td>
                    <td>{item.sla}</td>
                  </tr>
                ))}
                {!cases.length && (
                  <tr><td colSpan={5}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <KycCaseDetail item={selected} providerEvidence={linkedEvidence(data.providerEvidence, selected.id)} />}
      </section>
      <ProviderEvidencePanel title={t("kyc.providerEvidence")} feed={data.providerEvidence} />
    </>
  );
}

function KycCaseDetail({ item, providerEvidence }: { item: KycCase; providerEvidence: string }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.jurisdiction}</p></div>
        <Status tone={item.tone}>{item.status}</Status>
      </header>
      <div className="risk-score">
        <span>{t("common.riskScore")}</span>
        <strong>{item.riskScore}</strong>
        <p>{t("kyc.stageOwner", { stage: item.stage, owner: item.owner })}</p>
      </div>
      <dl className="detail-list">
        <div><dt>{t("common.opened")}</dt><dd>{item.openedAt}</dd></div>
        <div><dt>{t("common.sla")}</dt><dd>{item.sla}</dd></div>
        {item.uboSummary && <div><dt>{t("kyc.ubo")}</dt><dd>{item.uboSummary}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
        <div><dt>{t("common.providerEvidence")}</dt><dd>{providerEvidence || t("common.notLinked")}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={item.evidenceItems} />
      <h3 className="detail-section-title">{t("common.checks")}</h3>
      <WorkflowChecks checks={item.checks} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: item.linkedApprovalId }) : t("common.approvalNotRequested")}</strong>
        <p>{t("kyc.decisionNote")}</p>
      </div>
    </aside>
  );
}

function AmlView({ query, data }: { query: string; data: AmlPayload }) {
  const { t, count } = useI18n();
  const cases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return data.cases;
    return data.cases.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.source,
        item.severity,
        item.state
      ].some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [data.cases, query]);
  const [selectedId, setSelectedId] = useState(data.cases[0]?.id ?? "");
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
                {cases.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
                        {item.id}
                      </button>
                      <small className="cell-note">{item.state}</small>
                    </td>
                    <td>{item.subject}<small className="cell-note">{item.customerId}</small></td>
                    <td>{item.source}</td>
                    <td><Status tone={item.tone}>{item.severity}</Status></td>
                    <td className="numeric">{item.exposure}</td>
                    <td>{item.sla}</td>
                  </tr>
                ))}
                {!cases.length && (
                  <tr><td colSpan={6}><div className="empty">{t("common.noMatches")}</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <AmlCaseDetail item={selected} providerEvidence={linkedEvidence(data.providerEvidence, selected.id)} />}
      </section>
      <ProviderEvidencePanel title={t("aml.providerEvidence")} feed={data.providerEvidence} />
    </>
  );
}

function AmlCaseDetail({ item, providerEvidence }: { item: AmlCase; providerEvidence: string }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.source}</p></div>
        <Status tone={item.tone}>{item.state}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("common.owner")}</dt><dd>{item.owner}</dd></div>
        <div><dt>{t("common.opened")}</dt><dd>{item.openedAt}</dd></div>
        <div><dt>{t("common.exposure")}</dt><dd>{item.exposure}</dd></div>
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
        <div><dt>{t("common.providerEvidence")}</dt><dd>{providerEvidence || t("common.notLinked")}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("aml.screening")}</h3>
      <WorkflowChecks checks={item.screenings} />
      <h3 className="detail-section-title">{t("aml.riskFactors")}</h3>
      <ul className="factor-list">
        {item.riskFactors.map((factor) => <li key={factor}>{factor}</li>)}
      </ul>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: item.linkedApprovalId }) : t("common.approvalNotRequested")}</strong>
        <p>{t("aml.decisionNote")}</p>
      </div>
    </aside>
  );
}

function LinkedRecords({ values }: { values: readonly string[] }) {
  return (
    <div className="linked-records">
      {values.map((value) => <span key={value}>{value}</span>)}
    </div>
  );
}

function InvestigationsView({
  query,
  data
}: {
  query: string;
  data: InvestigationsPayload;
}) {
  const { t, count } = useI18n();
  const cases = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return data.cases;
    return data.cases.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.category,
        item.priority,
        item.state,
        item.owner,
        ...item.relatedAlertIds,
        ...item.relatedCaseIds
      ].some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [data.cases, query]);
  const [selectedId, setSelectedId] = useState(data.cases[0]?.id ?? "");
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
                {cases.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
                        {item.id}
                      </button>
                      <small className="cell-note">{item.state}</small>
                    </td>
                    <td>{item.subject}<small className="cell-note">{item.customerId}</small></td>
                    <td>{item.category}</td>
                    <td><Status tone={item.tone}>{item.priority}</Status></td>
                    <td className="numeric">{item.exposure}</td>
                    <td>{item.sla}</td>
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

function InvestigationDetail({ item }: { item: InvestigationCase }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.category}</p></div>
        <Status tone={item.tone}>{item.state}</Status>
      </header>
      <div className="case-summary">
        <strong>{t("investigations.priority", { priority: item.priority })}</strong>
        <p>{item.summary}</p>
      </div>
      <dl className="detail-list">
        <div><dt>{t("common.owner")}</dt><dd>{item.owner}</dd></div>
        <div><dt>{t("common.opened")}</dt><dd>{item.openedAt}</dd></div>
        <div><dt>{t("common.exposure")}</dt><dd>{item.exposure}</dd></div>
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("investigations.relatedRecords")}</h3>
      <LinkedRecords values={[...item.relatedAlertIds, ...item.relatedCaseIds]} />
      <h3 className="detail-section-title">{t("investigations.hypotheses")}</h3>
      <ul className="factor-list">
        {item.hypotheses.map((hypothesis) => <li key={hypothesis}>{hypothesis}</li>)}
      </ul>
      <h3 className="detail-section-title">{t("investigations.timeline")}</h3>
      <div className="timeline-list">
        {item.timeline.map((event) => (
          <div key={event.id}>
            <span />
            <div>
              <strong>{event.action}</strong>
              <small>{event.occurredAt} · {event.actor}</small>
              <p>{event.outcome}</p>
              <code>{event.evidenceDigest}</code>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: item.linkedApprovalId }) : t("common.approvalNotRequested")}</strong>
        <p>{t("investigations.decisionNote")}</p>
      </div>
    </aside>
  );
}

function FraudView({ query, data }: { query: string; data: FraudPayload }) {
  const { t, count } = useI18n();
  const alerts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return data.alerts;
    return data.alerts.filter((item) =>
      [
        item.id,
        item.customerId,
        item.subject,
        item.scenario,
        item.channel,
        item.severity,
        item.state,
        item.linkedInvestigationId ?? ""
      ].some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [data.alerts, query]);
  const [selectedId, setSelectedId] = useState(data.alerts[0]?.id ?? "");
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
                {alerts.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" aria-current={item.id === selected?.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
                        {item.id}
                      </button>
                      <small className="cell-note">{item.channel} · {item.state}</small>
                    </td>
                    <td>{item.subject}<small className="cell-note">{item.customerId}</small></td>
                    <td>{item.scenario}</td>
                    <td><Status tone={item.tone}>{item.score} · {item.severity}</Status></td>
                    <td className="numeric">{item.exposure}</td>
                    <td>{item.sla}</td>
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

function FraudDetail({ item }: { item: FraudAlert }) {
  const { t } = useI18n();
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.channel}</p></div>
        <Status tone={item.tone}>{item.severity}</Status>
      </header>
      <div className="risk-score">
        <span>{t("fraud.fraudScore")}</span>
        <strong>{item.score}</strong>
        <p>{t("fraud.detected", { scenario: item.scenario, detectedAt: item.detectedAt })}</p>
      </div>
      <dl className="detail-list">
        <div><dt>{t("fraud.controlMode")}</dt><dd><Status tone="info">{item.controlMode}</Status></dd></div>
        <div><dt>{t("fraud.linkedInvestigation")}</dt><dd>{item.linkedInvestigationId ?? t("fraud.notOpened")}</dd></div>
        <div><dt>{t("common.exposure")}</dt><dd>{item.exposure}</dd></div>
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("fraud.signals")}</h3>
      <WorkflowChecks checks={item.signals} />
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? t("common.linkedApproval", { id: item.linkedApprovalId }) : t("fraud.noDecision")}</strong>
        <p>{t("fraud.decisionNote")}</p>
      </div>
    </aside>
  );
}

function ApprovalsView({
  capabilities,
  data
}: {
  capabilities: readonly Capability[];
  data: ApprovalsPayload;
}) {
  const { t, count, time } = useI18n();
  const approvals = data.approvals;
  const [selected, setSelected] = useState<ApprovalSummary>(approvals[0]);
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
    const version = ++operationVersion.current;
    setPreview(undefined);
    setPreviewState("loading");
    setChallenge(undefined);
    setVerificationCode("");
    setStepUpState("idle");
    try {
      const nextPreview = await previewApproval(selected.id, selected.commandDigest);
      if (version !== operationVersion.current) return;
      setPreview(nextPreview);
      setPreviewState("idle");
    } catch {
      if (version !== operationVersion.current) return;
      setPreviewState("failed");
    }
  }

  async function startStepUp() {
    const version = ++operationVersion.current;
    setPreview(undefined);
    setChallenge(undefined);
    setVerificationCode("");
    setStepUpState("creating");
    try {
      const created = await createStepUpChallenge(selected.id, selected.commandDigest);
      if (version !== operationVersion.current) return;
      setChallenge(created);
      setStepUpState("challenge");
    } catch {
      if (version !== operationVersion.current) return;
      setStepUpState("failed");
    }
  }

  async function verifyStepUp() {
    if (!challenge || !/^\d{6}$/.test(verificationCode)) return;
    const version = ++operationVersion.current;
    setStepUpState("verifying");
    try {
      const verification = await verifyStepUpChallenge(
        selected.id,
        selected.commandDigest,
        challenge.challengeId,
        verificationCode
      );
      if (version !== operationVersion.current) return;
      const nextPreview = await previewApproval(
        selected.id,
        selected.commandDigest,
        verification.grant
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
                {approvals.map((approval) => (
                  <tr key={approval.id} data-selected={approval.id === selected.id}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={approval.id === selected.id ? "true" : undefined}
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
                        {approval.id}
                      </button>
                    </td>
                    <td>{approval.action}<small className="cell-note">{approval.maker}</small></td>
                    <td className="numeric">{approval.exposure}</td>
                    <td>{approval.evidence}</td>
                    <td>{approval.age}</td>
                    <td><Status tone={approval.tone}>{approval.state}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </article>
        <aside className="panel approval-detail">
          <header className="panel-heading">
            <div><h2>{selected.id}</h2><p>{selected.action}</p></div>
            <Status tone={selected.tone}>{selected.state}</Status>
          </header>
          <dl className="detail-list">
            <div><dt>{t("approvals.maker")}</dt><dd>{selected.maker}</dd></div>
            <div><dt>{t("common.exposure")}</dt><dd>{selected.exposure}</dd></div>
            <div><dt>{t("approvals.evidenceReadiness")}</dt><dd>{selected.evidence}</dd></div>
            <div><dt>{t("approvals.requiredApprovers")}</dt><dd>{selected.completedApprovals} / {selected.requiredApprovals}</dd></div>
          </dl>
          <div className="evidence-list">
            {selected.evidenceItems.map((item) => (
              <div key={item.id}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.digest}</small>
                </span>
                <Status tone={item.status === "ready" ? "success" : "danger"}>{item.status}</Status>
              </div>
            ))}
          </div>
          <div className="safe-action">
            <strong>{t("approvals.safeTitle")}</strong>
            <p>{t("approvals.safeNote")}</p>
          </div>
          {selected.stepUpRequired && (
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
                    <strong>{challenge.devVerificationCode}</strong>
                    <small>
                      {t("stepUp.attemptsUntil", { attempts: challenge.attemptsRemaining, time: time(challenge.expiresAt) })}
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
      </section>
    </>
  );
}

function ApprovalPreviewPanel({ preview }: { preview: ApprovalPreview }) {
  const { t } = useI18n();
  function blockerLabel(blocker: string): string {
    const key = `blocker.${blocker}`;
    return hasMessage(key) ? t(key) : blocker;
  }
  return (
    <section className="preview-panel" aria-label={t("preview.label")}>
      <header>
        <div><strong>{t("preview.policy")}</strong><small>{preview.command.digest.slice(0, 16)}…</small></div>
        <Status tone="warning">{t("preview.blocked")}</Status>
      </header>
      <dl className="preview-checks">
        <div>
          <dt>{t("preview.makerChecker")}</dt>
          <dd><Status tone={preview.policy.independentApprover ? "success" : "danger"}>
            {preview.policy.independentApprover ? t("preview.independent") : t("preview.conflict")}
          </Status></dd>
        </div>
        <div><dt>{t("preview.stepUpMfa")}</dt><dd><Status tone={preview.policy.stepUpMfa === "verified" ? "success" : "warning"}>
          {preview.policy.stepUpMfa}
        </Status></dd></div>
        <div><dt>{t("common.evidence")}</dt><dd>{preview.evidence.ready} / {preview.evidence.total}</dd></div>
        <div><dt>{t("preview.auditAnchor")}</dt><dd>#{preview.auditAnchor.sequence} · {preview.auditAnchor.hash.slice(0, 10)}…</dd></div>
      </dl>
      <ul>
        {preview.policy.blockers.map((blocker) => (
          <li key={blocker}>{blockerLabel(blocker)}</li>
        ))}
      </ul>
    </section>
  );
}

function AuditView({ data, mayExport }: { data: AuditPayload; mayExport: boolean }) {
  const { t, count } = useI18n();
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
      link.download = `solidchange-audit-${envelope.payload.chain.headHash.slice(0, 12)}.json`;
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
          <strong>{data.chain.verified ? t("audit.verified") : t("audit.invalid")}</strong>
          <small>{t("audit.eventCount", { count: count(data.chain.length) })}</small>
        </article>
        <article className="metric audit-head">
          <div><span>{t("audit.headHash")}</span><i data-tone="info" /></div>
          <strong>{data.chain.headHash.slice(0, 16)}…</strong>
          <small>{t("audit.headBound")}</small>
        </article>
        <article className="metric">
          <div><span>{t("audit.storage")}</span><i data-tone={data.chain.durable ? "success" : "warning"} /></div>
          <strong>{data.chain.durable ? t("audit.storagePostgres") : t("audit.storageMemory")}</strong>
          <small>{t("audit.retention", { days: count(data.chain.retentionDays) })}</small>
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
              {data.events.map((event) => (
                <tr key={event.eventId}>
                  <td className="numeric">#{event.sequence}</td>
                  <td>{event.action}<small className="cell-note">{event.occurredAt}</small></td>
                  <td>{event.actor}</td>
                  <td>{event.resource}</td>
                  <td><Status tone={event.tone}>{event.outcome}</Status></td>
                  <td className="hash-cell">{event.evidenceDigest}</td>
                  <td className="hash-cell">{event.previousHash.slice(0, 14)}…</td>
                  <td className="hash-cell">{event.hash.slice(0, 14)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      </article>
    </>
  );
}

function ReportsView({ data }: { data: ReportListPayload }) {
  const { t, count, date } = useI18n();
  const draftLabel = t("reports.draftLabel");
  const [selected, setSelected] = useState<ReportId | undefined>(data.reports[0]?.id);
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
      const blob = new Blob([payload.csv], { type: payload.mediaType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = payload.filename;
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
            status: data.status,
            marker: "not_for_submission",
            environment: data.environment,
            from: date(data.period.from)
          })}
        </span>
      </section>
      <section className="reports-layout">
        <article className="panel report-list">
          <header className="panel-heading">
            <div><h2>{t("reports.available")}</h2><p>{t("reports.count", { count: count(data.reports.length) })}</p></div>
          </header>
          <ul>
            {data.reports.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={selected === item.id ? "true" : undefined}
                  onClick={() => setSelected(item.id)}
                >
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
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
                  <h2>{report.title}</h2>
                  <p>{t("reports.digest", { draft: draftLabel, digest: report.contentDigest.slice(0, 12) })}</p>
                </div>
                <div className="audit-actions">
                  <Status tone="warning">{t("reports.draftStatus")}</Status>
                  <button
                    className="button"
                    type="button"
                    disabled={exportState === "loading"}
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
                {report.sections.map((item) => (
                  <section key={item.id} className="report-section">
                    <h3>{item.title}</h3>
                    <dl>
                      {item.rows.map((row) => (
                        <div key={row.key}>
                          <dt>{row.key}</dt>
                          <dd className="numeric">
                            {row.value}
                            {row.unit !== "count" && <small> {row.unit}</small>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
              {report.tables.map((table) => (
                <TableShell key={table.id} label={table.title}>
                  <table>
                    <thead>
                      <tr>{table.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, index) => <td key={table.columns[index]}>{cell}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              ))}
            </>
          )}
        </article>
      </section>
    </>
  );
}

type CheckStatusFilter = CheckStatus | "all";

function CheckDetail({ item }: { item: ChatCheck }) {
  const { t } = useI18n();
  return (
    <>
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.kind} · {item.channel}</p></div>
        <Status tone={item.tone}>{t(`checks.status.${item.status}`)}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("checks.sender")}</dt><dd>{item.sender} · {item.senderCustomerId}</dd></div>
        <div><dt>{t("checks.recipient")}</dt><dd>{item.recipient}{item.recipientCustomerId ? ` · ${item.recipientCustomerId}` : ""}</dd></div>
        <div><dt>{t("checks.amount")}</dt><dd className="numeric">{item.amount} {item.asset}</dd></div>
        <div><dt>{t("checks.fee")}</dt><dd className="numeric">{item.fee} {item.asset}</dd></div>
        {item.comment && <div><dt>{t("checks.comment")}</dt><dd>{item.comment}</dd></div>}
        <div><dt>{t("checks.createdAt")}</dt><dd>{item.createdAt}</dd></div>
        <div><dt>{t("checks.expiresAt")}</dt><dd>{item.expiresAt}</dd></div>
        {item.resolvedAt && <div><dt>{t("checks.resolvedAt")}</dt><dd>{item.resolvedAt}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("checks.monitoring")}</h3>
      <WorkflowChecks checks={item.monitoring} />
      <h3 className="detail-section-title">{t("checks.timeline")}</h3>
      <div className="timeline-list">
        {item.timeline.map((event) => (
          <div key={event.id}>
            <span />
            <div>
              <strong>{event.action}</strong>
              <small>{event.occurredAt} · {event.actor}</small>
              <p>{event.outcome}</p>
              <code>{event.evidenceDigest}</code>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("common.evidence")}</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{t("checks.readOnlyTitle")}</strong>
        <p>{t("checks.readOnlyNote")}</p>
      </div>
    </>
  );
}

function ChecksView({ query, data }: { query: string; data: ChecksPayload }) {
  const { t, count } = useI18n();
  const [statusFilter, setStatusFilter] = useState<CheckStatusFilter>("all");
  const [checks, setChecks] = useState<readonly ChatCheck[]>(data.checks);
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");
  const [selectedId, setSelectedId] = useState(data.checks[0]?.id ?? "");
  const [detail, setDetail] = useState<ChatCheck | undefined>();
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed">("idle");

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return checks;
    return checks.filter((check) =>
      [check.id, check.sender, check.recipient, check.amount, check.asset, check.status]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [checks, query]);

  function applyFilter(next: CheckStatusFilter) {
    setStatusFilter(next);
    setExportState("loading");
    getChecks(next === "all" ? undefined : next)
      .then((payload) => {
        setChecks(payload.checks);
        setSelectedId((current) =>
          payload.checks.some((check) => check.id === current) ? current : payload.checks[0]?.id ?? ""
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
                {data.statuses.map((status) => (
                  <option key={status} value={status}>{t(`checks.status.${status}`)}</option>
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
                {visible.map((check) => (
                  <tr key={check.id} data-selected={check.id === selectedId}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={check.id === selectedId ? "true" : undefined}
                        onClick={() => setSelectedId(check.id)}
                      >
                        {check.id}
                      </button>
                      <small className="cell-note">{check.channel}</small>
                    </td>
                    <td>
                      {check.sender} → {check.recipient}
                      <small className="cell-note">
                        {check.senderCustomerId}{check.recipientCustomerId ? ` → ${check.recipientCustomerId}` : ""}
                      </small>
                    </td>
                    <td className="numeric">{check.amount} {check.asset}</td>
                    <td><Status tone={check.tone}>{t(`checks.status.${check.status}`)}</Status></td>
                    <td>{check.expiresAt}</td>
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

function TicketDetail({ item }: { item: SupportTicket }) {
  const { t } = useI18n();
  return (
    <>
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{t(`support.channel.${item.channel}`)} · {item.subject}</p></div>
        <Status tone={item.tone}>{t(`support.status.${item.status}`)}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>{t("support.customer")}</dt><dd>{item.customer} · {item.customerId}</dd></div>
        <div><dt>{t("support.subject")}</dt><dd>{item.subject}</dd></div>
        <div><dt>{t("support.topic")}</dt><dd>{item.topic}</dd></div>
        <div><dt>{t("support.priority")}</dt><dd>{t(`support.priority.${item.priority}`)}</dd></div>
        <div><dt>{t("support.channel")}</dt><dd>{t(`support.channel.${item.channel}`)}</dd></div>
        <div><dt>{t("support.createdAt")}</dt><dd>{item.createdAt}</dd></div>
        <div><dt>{t("support.updatedAt")}</dt><dd>{item.updatedAt}</dd></div>
        {item.resolvedAt && <div><dt>{t("support.resolvedAt")}</dt><dd>{item.resolvedAt}</dd></div>}
        {item.linkedCheckId && <div><dt>{t("support.linkedCheck")}</dt><dd>{item.linkedCheckId}</dd></div>}
        {item.linkedKycCaseId && <div><dt>{t("support.linkedKycCase")}</dt><dd>{item.linkedKycCaseId}</dd></div>}
        {item.linkedScreeningId && <div><dt>{t("support.linkedScreening")}</dt><dd>{item.linkedScreeningId}</dd></div>}
        {item.disputedAmount && <div><dt>{t("support.disputedAmount")}</dt><dd className="numeric">{item.disputedAmount} {item.asset}</dd></div>}
        <div><dt>{t("common.auditEvidence")}</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">{t("support.messages")}</h3>
      <div className="timeline-list">
        {item.messages.map((message) => (
          <div key={message.id}>
            <span />
            <div>
              <strong>{t(`support.author.${message.author}`)}</strong>
              <small>{message.occurredAt}</small>
              <p>{message.body}</p>
            </div>
          </div>
        ))}
      </div>
      <h3 className="detail-section-title">{t("support.internalNotes")}</h3>
      <div className="timeline-list">
        {item.internalNotes.map((note) => (
          <div key={note.id}>
            <span />
            <div>
              <strong>{note.author}</strong>
              <small>{note.occurredAt}</small>
              <p>{note.body}</p>
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

function SupportView({ query, data }: { query: string; data: SupportTicketsPayload }) {
  const { t, count } = useI18n();
  const [statusFilter, setStatusFilter] = useState<TicketStatusFilter>("all");
  const [tickets, setTickets] = useState<readonly SupportTicket[]>(data.tickets);
  const [exportState, setExportState] = useState<"idle" | "loading" | "failed">("idle");
  const [selectedId, setSelectedId] = useState(data.tickets[0]?.id ?? "");
  const [detail, setDetail] = useState<SupportTicket | undefined>();
  const [detailState, setDetailState] = useState<"idle" | "loading" | "failed">("idle");

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    if (!normalized) return tickets;
    return tickets.filter((ticket) =>
      [ticket.id, ticket.customer, ticket.subject, ticket.topic, ticket.priority, ticket.status]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [tickets, query]);

  function applyFilter(next: TicketStatusFilter) {
    setStatusFilter(next);
    setExportState("loading");
    getSupportTickets(next === "all" ? undefined : next)
      .then((payload) => {
        setTickets(payload.tickets);
        setSelectedId((current) =>
          payload.tickets.some((ticket) => ticket.id === current) ? current : payload.tickets[0]?.id ?? ""
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
                {data.statuses.map((status) => (
                  <option key={status} value={status}>{t(`support.status.${status}`)}</option>
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
                {visible.map((ticket) => (
                  <tr key={ticket.id} data-selected={ticket.id === selectedId}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
                        aria-current={ticket.id === selectedId ? "true" : undefined}
                        onClick={() => setSelectedId(ticket.id)}
                      >
                        {ticket.id}
                      </button>
                      <small className="cell-note">{t(`support.channel.${ticket.channel}`)}</small>
                    </td>
                    <td>
                      {ticket.customer}
                      <small className="cell-note">{ticket.subject} · {ticket.customerId}</small>
                    </td>
                    <td>{ticket.topic}</td>
                    <td>{t(`support.priority.${ticket.priority}`)}</td>
                    <td><Status tone={ticket.tone}>{t(`support.status.${ticket.status}`)}</Status></td>
                    <td>{ticket.updatedAt}</td>
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
  return session.operator.capabilities.includes(capability);
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

      const [dashboard, customers, checks, support, kyc, aml, investigations, fraud, approvals, audit, reports] = await Promise.all([
        getDashboard(),
        getCustomers(),
        hasCapability(session, "checks:read") ? getChecks() : Promise.resolve(undefined),
        hasCapability(session, "support:read") ? getSupportTickets() : Promise.resolve(undefined),
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
        data: { session, dashboard, customers, checks, support, kyc, aml, investigations, fraud, approvals, audit, reports }
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
  const profile = session.operator;

  function selectScreen(item: NavigationItem) {
    if (item.capability && !hasCapability(session, item.capability)) return;
    setScreen(item.id);
    window.history.replaceState(null, "", `#${item.id}`);
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
            <strong>{t("app.greeting", { name: t(`role.${profile.role}`) })}</strong>
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
                value={profile.role}
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
              <small>{t(`role.${profile.role}`)}</small>
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
            <ChecksView query={query} data={access.data.checks} />
          )}
          {screen === "support" && access.data.support && (
            <SupportView query={query} data={access.data.support} />
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
              capabilities={session.operator.capabilities}
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
