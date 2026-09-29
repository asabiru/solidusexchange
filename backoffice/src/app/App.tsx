import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getCustomers,
  getDashboard,
  getFraudAlerts,
  getHealth,
  getInvestigations,
  getKycCases,
  getSession,
  logout,
  previewApproval,
  verifyStepUpChallenge,
  type AmlPayload,
  type ApprovalsPayload,
  type AuditPayload,
  type CustomersPayload,
  type DashboardPayload,
  type FraudPayload,
  type HealthPayload,
  type InvestigationsPayload,
  type KycPayload,
  type SessionPayload,
  type StepUpChallengePayload
} from "../data/client";
import type {
  AmlCase,
  ApprovalPreview,
  ApprovalSummary,
  EvidenceItem,
  FraudAlert,
  InvestigationCase,
  KycCase,
  Tone,
  WorkflowCheck
} from "../data/demo";
import { navigation, navigationGroups, type NavigationItem, type ScreenId } from "./navigation";
import { runtime } from "./runtime";

type Theme = "light" | "dark";
type Density = "compact" | "comfortable";

function initialScreen(): ScreenId {
  const candidate = window.location.hash.slice(1);
  const item = navigation.find((entry) => entry.id === candidate);
  return item?.id ?? "dashboard";
}

function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className="status" data-tone={tone}>{children}</span>;
}

function TableShell({ children, label }: { children: React.ReactNode; label: string }) {
  return <section className="table-scroll" aria-label={label}>{children}</section>;
}

function DashboardView({ data }: { data: DashboardPayload }) {
  return (
    <>
      <PageHeading
        title="Operations center"
        description="Синтетическая dev-only сводка · команды и live-провайдеры отключены"
      />
      <section className="metrics" aria-label="Операционные показатели">
        {data.metrics.map((metric) => (
          <article className="metric" key={metric.label}>
            <div><span>{metric.label}</span><i data-tone={metric.tone} /></div>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>
      <section className="grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>Приоритетные очереди</h2><p>Риск, SLA и сумма раньше технических деталей</p></div>
          </header>
          <TableShell label="Приоритетные очереди">
            <table>
              <thead><tr><th>Очередь</th><th>Критично</th><th>Всего</th><th>Старейшая</th><th>SLA</th></tr></thead>
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
        <aside className="panel health-panel">
          <header className="panel-heading">
            <div><h2>System readiness</h2><p>Fail-closed foundation state</p></div>
          </header>
          <dl className="health-list">
            <div><dt>Runtime</dt><dd><Status tone="success">{runtime.mode}</Status></dd></div>
            <div><dt>Data source</dt><dd>{runtime.dataSource}</dd></div>
            <div><dt>Command clients</dt><dd><Status tone="warning">Not installed</Status></dd></div>
            <div><dt>Customer systems</dt><dd><Status>Disconnected</Status></dd></div>
          </dl>
        </aside>
      </section>
    </>
  );
}

function CustomersView({ query, data }: { query: string; data: CustomersPayload }) {
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
      <PageHeading
        title="Customers 360"
        description="Masked risk projection · case links only · документы и PII не загружаются"
      />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>Клиенты</h2><p>{customers.length} synthetic masked profiles</p></div>
            <Status tone="info">No raw PII</Status>
          </header>
          <TableShell label="Список клиентов">
            <table>
              <thead><tr><th>Клиент</th><th>KYC / KYB</th><th>Risk</th><th>30d volume</th><th>Next action</th></tr></thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} data-selected={customer.id === selected?.id}>
                    <td>
                      <button
                        className="person"
                        type="button"
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
                  <tr><td colSpan={5}><div className="empty">Совпадений не найдено</div></td></tr>
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
              <span>Risk score</span>
              <strong>{selected.riskScore}</strong>
              <p>{selected.riskReason}</p>
            </div>
            <dl className="detail-list">
              <div><dt>KYC / KYB case</dt><dd>{selected.kycCaseId}</dd></div>
              <div><dt>Open AML cases</dt><dd>{selected.openAmlCases}</dd></div>
              <div><dt>Restriction</dt><dd>{selected.restriction}</dd></div>
              <div><dt>Last reviewed</dt><dd>{selected.lastReviewedAt}</dd></div>
            </dl>
            <div className="safe-action">
              <strong>Read-only customer projection</strong>
              <p>Документы, полные идентификаторы и provider payloads отсутствуют; решения связаны с отдельными case и approval records.</p>
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

function KycView({ query, data }: { query: string; data: KycPayload }) {
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
      <PageHeading
        title="KYC / KYB"
        description="Signed case projection · evidence readiness · approval-linked decisions"
      />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>Identity cases</h2><p>{cases.length} synthetic cases · no provider calls</p></div>
            <Status tone="info">Read-only</Status>
          </header>
          <TableShell label="KYC и KYB cases">
            <table>
              <thead><tr><th>Case</th><th>Subject</th><th>Stage</th><th>Risk</th><th>SLA</th></tr></thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" onClick={() => setSelectedId(item.id)}>
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
                  <tr><td colSpan={5}><div className="empty">Совпадений не найдено</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <KycCaseDetail item={selected} />}
      </section>
    </>
  );
}

function KycCaseDetail({ item }: { item: KycCase }) {
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.jurisdiction}</p></div>
        <Status tone={item.tone}>{item.status}</Status>
      </header>
      <div className="risk-score">
        <span>Risk score</span>
        <strong>{item.riskScore}</strong>
        <p>{item.stage} · owner: {item.owner}</p>
      </div>
      <dl className="detail-list">
        <div><dt>Opened</dt><dd>{item.openedAt}</dd></div>
        <div><dt>SLA</dt><dd>{item.sla}</dd></div>
        {item.uboSummary && <div><dt>UBO</dt><dd>{item.uboSummary}</dd></div>}
        <div><dt>Audit evidence</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">Evidence</h3>
      <EvidenceList items={item.evidenceItems} />
      <h3 className="detail-section-title">Checks</h3>
      <WorkflowChecks checks={item.checks} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? `Linked approval · ${item.linkedApprovalId}` : "Approval not requested"}</strong>
        <p>Case decision cannot be executed here; this view exposes only signed evidence and policy references.</p>
      </div>
    </aside>
  );
}

function AmlView({ query, data }: { query: string; data: AmlPayload }) {
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
      <PageHeading
        title="AML / KYT"
        description="Sanctions, PEP and KYT review · evidence-linked · no disposition mutation"
      />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>AML cases</h2><p>{cases.length} synthetic cases · provider payloads absent</p></div>
            <Status tone="warning">Decision gated</Status>
          </header>
          <TableShell label="AML cases">
            <table>
              <thead><tr><th>Case</th><th>Subject</th><th>Source</th><th>Severity</th><th>Exposure</th><th>SLA</th></tr></thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" onClick={() => setSelectedId(item.id)}>
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
                  <tr><td colSpan={6}><div className="empty">Совпадений не найдено</div></td></tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </article>
        {selected && <AmlCaseDetail item={selected} />}
      </section>
    </>
  );
}

function AmlCaseDetail({ item }: { item: AmlCase }) {
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.source}</p></div>
        <Status tone={item.tone}>{item.state}</Status>
      </header>
      <dl className="detail-list">
        <div><dt>Owner</dt><dd>{item.owner}</dd></div>
        <div><dt>Opened</dt><dd>{item.openedAt}</dd></div>
        <div><dt>Exposure</dt><dd>{item.exposure}</dd></div>
        <div><dt>Audit evidence</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">Screening</h3>
      <WorkflowChecks checks={item.screenings} />
      <h3 className="detail-section-title">Risk factors</h3>
      <ul className="factor-list">
        {item.riskFactors.map((factor) => <li key={factor}>{factor}</li>)}
      </ul>
      <h3 className="detail-section-title">Evidence</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? `Linked approval · ${item.linkedApprovalId}` : "Approval not requested"}</strong>
        <p>Sanctions, PEP and KYT outcomes are synthetic; disposition and restriction commands are not installed.</p>
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
      <PageHeading
        title="Investigations"
        description="Cross-control case timeline · evidence links · no enforcement or customer mutation"
      />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>Investigation cases</h2><p>{cases.length} synthetic cases · signed read-only projection</p></div>
            <Status tone="warning">Decision gated</Status>
          </header>
          <TableShell label="Investigation cases">
            <table>
              <thead><tr><th>Case</th><th>Subject</th><th>Category</th><th>Priority</th><th>Exposure</th><th>SLA</th></tr></thead>
              <tbody>
                {cases.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" onClick={() => setSelectedId(item.id)}>
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
                  <tr><td colSpan={6}><div className="empty">Совпадений не найдено</div></td></tr>
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
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.category}</p></div>
        <Status tone={item.tone}>{item.state}</Status>
      </header>
      <div className="case-summary">
        <strong>{item.priority} priority</strong>
        <p>{item.summary}</p>
      </div>
      <dl className="detail-list">
        <div><dt>Owner</dt><dd>{item.owner}</dd></div>
        <div><dt>Opened</dt><dd>{item.openedAt}</dd></div>
        <div><dt>Exposure</dt><dd>{item.exposure}</dd></div>
        <div><dt>Audit evidence</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">Related records</h3>
      <LinkedRecords values={[...item.relatedAlertIds, ...item.relatedCaseIds]} />
      <h3 className="detail-section-title">Hypotheses</h3>
      <ul className="factor-list">
        {item.hypotheses.map((hypothesis) => <li key={hypothesis}>{hypothesis}</li>)}
      </ul>
      <h3 className="detail-section-title">Timeline</h3>
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
      <h3 className="detail-section-title">Evidence</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? `Linked approval · ${item.linkedApprovalId}` : "Approval not requested"}</strong>
        <p>Escalation and restriction commands are absent; the case exposes only signed evidence, hypotheses and immutable audit references.</p>
      </div>
    </aside>
  );
}

function FraudView({ query, data }: { query: string; data: FraudPayload }) {
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
      <PageHeading
        title="Fraud controls"
        description="Detection signals in monitor-only mode · no blocking, freezing or customer mutation"
      />
      <section className="grid risk-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>Fraud alerts</h2><p>{alerts.length} synthetic alerts · control engine disconnected</p></div>
            <Status tone="info">Monitor-only</Status>
          </header>
          <TableShell label="Fraud alerts">
            <table>
              <thead><tr><th>Alert</th><th>Subject</th><th>Scenario</th><th>Score</th><th>Exposure</th><th>SLA</th></tr></thead>
              <tbody>
                {alerts.map((item) => (
                  <tr key={item.id} data-selected={item.id === selected?.id}>
                    <td>
                      <button className="table-link" type="button" onClick={() => setSelectedId(item.id)}>
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
                  <tr><td colSpan={6}><div className="empty">Совпадений не найдено</div></td></tr>
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
  return (
    <aside className="panel case-detail">
      <header className="panel-heading">
        <div><h2>{item.id}</h2><p>{item.subject} · {item.channel}</p></div>
        <Status tone={item.tone}>{item.severity}</Status>
      </header>
      <div className="risk-score">
        <span>Fraud score</span>
        <strong>{item.score}</strong>
        <p>{item.scenario} · detected {item.detectedAt}</p>
      </div>
      <dl className="detail-list">
        <div><dt>Control mode</dt><dd><Status tone="info">{item.controlMode}</Status></dd></div>
        <div><dt>Linked investigation</dt><dd>{item.linkedInvestigationId ?? "Not opened"}</dd></div>
        <div><dt>Exposure</dt><dd>{item.exposure}</dd></div>
        <div><dt>Audit evidence</dt><dd className="hash-value">{item.auditEvidenceDigest}</dd></div>
      </dl>
      <h3 className="detail-section-title">Signals</h3>
      <WorkflowChecks checks={item.signals} />
      <h3 className="detail-section-title">Evidence</h3>
      <EvidenceList items={item.evidenceItems} />
      <div className="safe-action">
        <strong>{item.linkedApprovalId ? `Linked approval · ${item.linkedApprovalId}` : "No protected decision requested"}</strong>
        <p>Rules are observable only. Blocking, freezing, notification and provider actions are not installed in this slice.</p>
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
  const approvals = data.approvals;
  const [selected, setSelected] = useState<ApprovalSummary>(approvals[0]);
  const [preview, setPreview] = useState<ApprovalPreview>();
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "failed">("idle");
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
      <PageHeading
        title="Approval inbox"
        description="Signed evidence и side-effect-free command preview · execution отсутствует"
      />
      <section className="grid approval-grid">
        <article className="panel">
          <header className="panel-heading">
            <div><h2>Pending approvals</h2><p>Maker-checker queue · synthetic data</p></div>
            <Status tone="warning">{approvals.length} pending</Status>
          </header>
          <TableShell label="Ожидающие approvals">
            <table>
              <thead><tr><th>ID</th><th>Action</th><th>Exposure</th><th>Evidence</th><th>Age</th><th>State</th></tr></thead>
              <tbody>
                {approvals.map((approval) => (
                  <tr key={approval.id} data-selected={approval.id === selected.id}>
                    <td>
                      <button
                        className="table-link"
                        type="button"
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
            <div><dt>Maker</dt><dd>{selected.maker}</dd></div>
            <div><dt>Exposure</dt><dd>{selected.exposure}</dd></div>
            <div><dt>Evidence readiness</dt><dd>{selected.evidence}</dd></div>
            <div><dt>Required approvers</dt><dd>{selected.completedApprovals} / {selected.requiredApprovals}</dd></div>
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
            <strong>Preview не выполняет команду</strong>
            <p>Сервер проверит maker-checker, evidence, step-up MFA и audit anchor, но command client отсутствует.</p>
          </div>
          {selected.stepUpRequired && (
            <section className="step-up-panel" aria-label="Synthetic dev-only step-up">
              <header>
                <div>
                  <strong>Synthetic step-up · dev-only</strong>
                  <small>Не является production MFA или вторым фактором.</small>
                </div>
                <Status tone={stepUpState === "verified" ? "success" : "warning"}>
                  {stepUpState === "verified" ? "verified" : "required"}
                </Status>
              </header>
              {challenge ? (
                <>
                  <div className="dev-code">
                    <span>Dev verification code</span>
                    <strong>{challenge.devVerificationCode}</strong>
                    <small>
                      {challenge.attemptsRemaining} attempts · до{" "}
                      {new Date(challenge.expiresAt).toLocaleTimeString("ru-RU")}
                    </small>
                  </div>
                  <label className="step-up-input">
                    <span>Введите 6-значный код</span>
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(event) => {
                        setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                      }}
                    />
                  </label>
                  {stepUpState === "retry" && (
                    <p className="step-up-result" data-state="failed">
                      Код отклонён. Challenge остаётся активным до лимита попыток.
                    </p>
                  )}
                  <button
                    className="button step-up-button"
                    type="button"
                    disabled={stepUpState === "verifying" || verificationCode.length !== 6}
                    onClick={() => void verifyStepUp()}
                  >
                    {stepUpState === "verifying"
                      ? "Проверяем и формируем preview…"
                      : "Проверить одноразовый код"}
                  </button>
                </>
              ) : stepUpState === "verified" ? (
                <p className="step-up-result">
                  Одноразовый grant использован для этого preview и больше не принимается.
                </p>
              ) : (
                <>
                  {(stepUpState === "failed" || stepUpState === "locked") && (
                    <p className="step-up-result" data-state="failed">
                      {stepUpState === "locked"
                        ? "Challenge заблокирован после исчерпания попыток."
                        : "Challenge отклонён или устарел. Запустите новый."}
                    </p>
                  )}
                  <button
                    className="button step-up-button"
                    type="button"
                    disabled={!mayStepUp || stepUpState === "creating"}
                    onClick={() => void startStepUp()}
                  >
                    {stepUpState === "creating"
                      ? "Создаём challenge…"
                      : "Начать synthetic step-up"}
                  </button>
                </>
              )}
            </section>
          )}
          <button
            className="button primary"
            type="button"
            disabled={!mayPreview || previewState === "loading"}
            onClick={() => void loadPreview()}
          >
            {previewState === "loading" ? "Формируем preview…" : "Сформировать безопасный preview"}
          </button>
          <small className="disabled-reason">
            {!mayPreview
              ? "Роль не имеет approvals:preview."
              : "Финансовая команда не создаётся и не отправляется."}
          </small>
          {previewState === "failed" && (
            <div className="preview-error">Preview отклонён BFF или устарел.</div>
          )}
          {preview && <ApprovalPreviewPanel preview={preview} />}
        </aside>
      </section>
    </>
  );
}

function ApprovalPreviewPanel({ preview }: { preview: ApprovalPreview }) {
  const blockerLabels: Readonly<Record<string, string>> = {
    maker_cannot_approve: "Maker не может быть approver",
    evidence_incomplete: "Evidence неполный",
    step_up_mfa_required: "Требуется step-up MFA",
    approvals_incomplete: "Недостаточно approvers",
    command_client_absent: "Command client отсутствует"
  };
  return (
    <section className="preview-panel" aria-label="Результат command preview">
      <header>
        <div><strong>Policy preview</strong><small>{preview.command.digest.slice(0, 16)}…</small></div>
        <Status tone="warning">Blocked</Status>
      </header>
      <dl className="preview-checks">
        <div>
          <dt>Maker-checker</dt>
          <dd><Status tone={preview.policy.independentApprover ? "success" : "danger"}>
            {preview.policy.independentApprover ? "independent" : "conflict"}
          </Status></dd>
        </div>
        <div><dt>Step-up MFA</dt><dd><Status tone={preview.policy.stepUpMfa === "verified" ? "success" : "warning"}>
          {preview.policy.stepUpMfa}
        </Status></dd></div>
        <div><dt>Evidence</dt><dd>{preview.evidence.ready} / {preview.evidence.total}</dd></div>
        <div><dt>Audit anchor</dt><dd>#{preview.auditAnchor.sequence} · {preview.auditAnchor.hash.slice(0, 10)}…</dd></div>
      </dl>
      <ul>
        {preview.policy.blockers.map((blocker) => (
          <li key={blocker}>{blockerLabels[blocker] ?? blocker}</li>
        ))}
      </ul>
    </section>
  );
}

function AuditView({ data, mayExport }: { data: AuditPayload; mayExport: boolean }) {
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
      <PageHeading
        title="Audit trail"
        description="Signed read-only evidence · SHA-256 hash chain · fail-closed verification"
      />
      <section className="audit-summary">
        <article className="metric">
          <div><span>Chain integrity</span><i data-tone="success" /></div>
          <strong>{data.chain.verified ? "Verified" : "Invalid"}</strong>
          <small>{data.chain.length} immutable events</small>
        </article>
        <article className="metric audit-head">
          <div><span>Head hash</span><i data-tone="info" /></div>
          <strong>{data.chain.headHash.slice(0, 16)}…</strong>
          <small>Bound to the latest event</small>
        </article>
        <article className="metric">
          <div><span>Evidence storage</span><i data-tone={data.chain.durable ? "success" : "warning"} /></div>
          <strong>{data.chain.durable ? "PostgreSQL" : "Synthetic memory"}</strong>
          <small>Minimum retention · {data.chain.retentionDays} days</small>
        </article>
      </section>
      <article className="panel">
        <header className="panel-heading">
          <div><h2>Append-only events</h2><p>Previous hash связывает каждую запись с предшествующей</p></div>
          <div className="audit-actions">
            <Status tone="success">Verified chain</Status>
            <button
              className="button"
              type="button"
              disabled={!mayExport || exportState === "loading"}
              onClick={() => void downloadExport()}
            >
              {exportState === "loading" ? "Экспорт…" : "Экспорт evidence"}
            </button>
          </div>
        </header>
        {exportState === "failed" && (
          <div className="preview-error">Экспорт отклонён или integrity verification недоступна.</div>
        )}
        <TableShell label="Audit trail">
          <table>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Event</th>
                <th>Actor</th>
                <th>Resource</th>
                <th>Outcome</th>
                <th>Evidence</th>
                <th>Previous hash</th>
                <th>Hash</th>
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

function PlaceholderView({ item }: { item: NavigationItem }) {
  return (
    <>
      <PageHeading title={item.label} description="Запланировано для следующего Wave 2 slice" />
      <section className="panel placeholder">
        <span>{item.label.slice(0, 2).toUpperCase()}</span>
        <h2>Контракт раздела зафиксирован</h2>
        <p>UI, query API, evidence model и role capabilities будут добавлены отдельным проверяемым vertical slice.</p>
      </section>
    </>
  );
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <header className="page-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      <div className="page-actions">
        <Status tone="success">DEV</Status>
        <Status>dry-run</Status>
      </div>
    </header>
  );
}

interface WorkspaceData {
  session: SessionPayload;
  dashboard: DashboardPayload;
  customers: CustomersPayload;
  kyc?: KycPayload;
  aml?: AmlPayload;
  investigations?: InvestigationsPayload;
  fraud?: FraudPayload;
  approvals?: ApprovalsPayload;
  audit?: AuditPayload;
}

type AccessState =
  | { status: "loading" }
  | { status: "signed-out"; health: HealthPayload }
  | { status: "failed"; message: string }
  | { status: "ready"; health: HealthPayload; data: WorkspaceData };

function hasCapability(session: SessionPayload, capability: Capability): boolean {
  return session.operator.capabilities.includes(capability);
}

function AccessGate({
  state,
  onDevLogin
}: {
  state: Exclude<AccessState, { status: "ready" }>;
  onDevLogin: (role: OperatorRole) => Promise<void>;
}) {
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
    <div className="access-shell">
      <section className="access-card">
        <div className="brand access-brand">
          <span>SC</span>
          <div>
            <strong>SolidChange</strong>
            <small className="access-subtitle">Operator backoffice</small>
          </div>
        </div>
        {state.status === "loading" && (
          <>
            <h1 className="access-title">Проверяем операторскую сессию</h1>
            <p className="access-copy">Доступ fail-closed: интерфейс не загрузит данные без BFF и подписанного ответа.</p>
            <Status tone="info">Session check</Status>
          </>
        )}
        {state.status === "failed" && (
          <>
            <h1 className="access-title">Backoffice недоступен</h1>
            <p className="access-copy">{state.message}</p>
            <Status tone="danger">Fail closed</Status>
          </>
        )}
        {state.status === "signed-out" && (
          <>
            <h1 className="access-title">Вход для оператора</h1>
            <p className="access-copy">OIDC/SSO токены обрабатываются только BFF и не передаются в браузерное приложение.</p>
            {state.health.oidcConfigured && (
              <a className="button primary access-action access-button" href="/bff/auth/login">Войти через SSO</a>
            )}
            {state.health.devLoginEnabled && (
              <div className="dev-login">
                <label>
                  <span>Dev-only роль</span>
                  <select
                    className="dev-role-select"
                    value={role}
                    onChange={(event) => setRole(event.target.value as OperatorRole)}
                  >
                    {roleProfiles.map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>{candidate.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="button primary access-button"
                  type="button"
                  disabled={submitting}
                  onClick={submitDevLogin}
                >
                  Открыть synthetic workspace
                </button>
              </div>
            )}
            {!state.health.oidcConfigured && !state.health.devLoginEnabled && (
              <Status tone="warning">OIDC not configured</Status>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function App() {
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [screen, setScreen] = useState<ScreenId>(initialScreen);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  const [density, setDensity] = useState<Density>("compact");

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

      const [dashboard, customers, kyc, aml, investigations, fraud, approvals, audit] = await Promise.all([
        getDashboard(),
        getCustomers(),
        hasCapability(session, "kyc:read") ? getKycCases() : Promise.resolve(undefined),
        hasCapability(session, "aml:read") ? getAmlCases() : Promise.resolve(undefined),
        hasCapability(session, "investigations:read") ? getInvestigations() : Promise.resolve(undefined),
        hasCapability(session, "fraud:read") ? getFraudAlerts() : Promise.resolve(undefined),
        hasCapability(session, "approvals:read") ? getApprovals() : Promise.resolve(undefined),
        hasCapability(session, "audit:read") ? getAudit() : Promise.resolve(undefined)
      ]);
      setAccess({
        status: "ready",
        health,
        data: { session, dashboard, customers, kyc, aml, investigations, fraud, approvals, audit }
      });
    } catch (error) {
      setAccess({
        status: "failed",
        message: error instanceof Error ? error.message : "Не удалось проверить границу доступа"
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
        message: error instanceof Error ? error.message : "Dev-only session rejected"
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
        message: error instanceof Error ? error.message : "Не удалось завершить сессию"
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
    return <AccessGate state={access} onDevLogin={switchDevRole} />;
  }

  const { session } = access.data;
  const profile = session.operator;

  function selectScreen(item: NavigationItem) {
    if (item.capability && !hasCapability(session, item.capability)) return;
    setScreen(item.id);
    window.history.replaceState(null, "", `#${item.id}`);
  }

  const activeItem = navigation.find((item) => item.id === screen) ?? navigation[0];

  return (
    <div className="app" data-theme={theme} data-density={density}>
      <aside className="sidebar">
        <div className="brand"><span>SC</span><div><strong>SolidChange</strong><small>Operator backoffice</small></div></div>
        <nav aria-label="Backoffice navigation">
          {navigationGroups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {navigation.filter((item) => item.group === group).map((item) => {
                const denied = Boolean(
                  item.capability && !hasCapability(session, item.capability)
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={screen === item.id ? "page" : undefined}
                    aria-disabled={denied}
                    onClick={() => selectScreen(item)}
                    title={!item.implemented ? "Следующий Wave 2 slice" : denied ? "Недоступно выбранной роли" : ""}
                  >
                    <span>{item.label.slice(0, 2).toUpperCase()}</span>
                    <strong>{item.label}</strong>
                    {!item.implemented && <small>Soon</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="session-note">
          <strong>Protected workspace</strong>
          <span>Signed queries · audit chain · preview only</span>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Клиент, case или operation ID"
              aria-label="Глобальный поиск"
            />
          </label>
          <div className="topbar-spacer" />
          <span className="environment"><i />DEV · dry-run</span>
          <button className="icon-button density-button" type="button" onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")} aria-label="Переключить плотность">
            {density === "compact" ? "≡" : "☰"}
          </button>
          <button className="icon-button" type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Переключить тему">
            {theme === "light" ? "◐" : "◑"}
          </button>
          <span className="avatar" aria-hidden="true">{profile.initials}</span>
          {access.health.devLoginEnabled ? (
            <label className="role">
              <span>{profile.name}</span>
              <select
                value={profile.role}
                onChange={(event) => void switchDevRole(event.target.value as OperatorRole)}
                aria-label="Dev-only серверная роль"
              >
                {roleProfiles.map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>{candidate.label}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="role">
              <span>{profile.name}</span>
              <small>{profile.label}</small>
            </div>
          )}
          <button className="icon-button" type="button" onClick={() => void endSession()} aria-label="Завершить сессию">
            ↪
          </button>
        </header>

        <main>
          {screen === "dashboard" && <DashboardView data={access.data.dashboard} />}
          {screen === "customers" && (
            <CustomersView query={query} data={access.data.customers} />
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
          {!activeItem.implemented && <PlaceholderView item={activeItem} />}
        </main>
      </div>
    </div>
  );
}
