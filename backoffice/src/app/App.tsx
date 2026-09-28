import { useCallback, useEffect, useMemo, useState } from "react";
import { roleProfiles, type Capability, type OperatorRole } from "../auth/access";
import {
  ApiError,
  createDevSession,
  getApprovals,
  getCustomers,
  getDashboard,
  getHealth,
  getSession,
  logout,
  type ApprovalsPayload,
  type CustomersPayload,
  type DashboardPayload,
  type HealthPayload,
  type SessionPayload
} from "../data/client";
import type { ApprovalRow, Tone } from "../data/demo";
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
      [customer.id, customer.name, customer.country, customer.nextAction]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalized))
    );
  }, [data.customers, query]);

  return (
    <>
      <PageHeading
        title="Customers 360"
        description="Read-only customer risk projection · документы и PII не загружаются"
      />
      <article className="panel">
        <header className="panel-heading">
          <div><h2>Клиенты</h2><p>{customers.length} synthetic profiles</p></div>
          <Status tone="info">Masked data</Status>
        </header>
        <TableShell label="Список клиентов">
          <table>
            <thead><tr><th>Клиент</th><th>KYC</th><th>Risk</th><th>30d volume</th><th>Next action</th></tr></thead>
            <tbody>
              {customers.map((customer, index) => (
                <tr key={customer.id} data-selected={index === 0}>
                  <td>
                    <button className="person" type="button">
                      <span>{customer.initials}</span>
                      <span><strong>{customer.name}</strong><small>{customer.id} · {customer.country}</small></span>
                    </button>
                  </td>
                  <td><Status tone={customer.kyc === "Verified" ? "success" : "warning"}>{customer.kyc}</Status></td>
                  <td><Status tone={customer.tone}>{customer.risk}</Status></td>
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
    </>
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
  const [selected, setSelected] = useState<ApprovalRow>(approvals[0]);
  const mayReview = capabilities.includes("approvals:review");

  return (
    <>
      <PageHeading
        title="Approval inbox"
        description="Evidence review only · command execution отсутствует в foundation slice"
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
                    <td><button className="table-link" type="button" onClick={() => setSelected(approval)}>{approval.id}</button></td>
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
            <div><dt>Command state</dt><dd>Unavailable</dd></div>
          </dl>
          <div className="safe-action">
            <strong>Protected action boundary</strong>
            <p>Step-up MFA, second approver, immutable audit envelope and idempotent command API are required before enablement.</p>
          </div>
          <button className="button primary" type="button" disabled={!mayReview || !runtime.commandsEnabled}>
            Подтвердить действие
          </button>
          <small className="disabled-reason">
            {!mayReview ? "Роль не имеет approvals:review." : "Command client намеренно отсутствует."}
          </small>
        </aside>
      </section>
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
  approvals?: ApprovalsPayload;
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
      const health = await getHealth();
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

      const [dashboard, customers, approvals] = await Promise.all([
        getDashboard(),
        getCustomers(),
        hasCapability(session, "approvals:read") ? getApprovals() : Promise.resolve(undefined)
      ]);
      setAccess({
        status: "ready",
        health,
        data: { session, dashboard, customers, approvals }
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
          <span>Server session · signed queries · no command clients</span>
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
          {screen === "approvals" && access.data.approvals && (
            <ApprovalsView
              capabilities={session.operator.capabilities}
              data={access.data.approvals}
            />
          )}
          {!activeItem.implemented && <PlaceholderView item={activeItem} />}
        </main>
      </div>
    </div>
  );
}
