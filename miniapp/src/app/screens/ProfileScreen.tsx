import type { CustomerApiAccess, KycStatus, ProfileView, SessionView } from "../../shared/api";
import { Icon, type IconName } from "../Icon";
import type { SheetRequest } from "../navigation";
import { ScreenTitle, Switch } from "../ui";

interface Props {
  session: SessionView;
  profile: ProfileView;
  openSheet: (sheet: SheetRequest) => void;
  switchScenario: (kyc: KycStatus) => void;
  logout: () => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

function MenuRow({ icon, title, detail, onClick }: { icon: IconName; title: string; detail: string; onClick?: () => void }) {
  return (
    <button type="button" className="row" onClick={onClick} disabled={!onClick} aria-disabled={!onClick}>
      <span className="coin coin--menu" aria-hidden="true"><Icon name={icon} size="sm" /></span>
      <span className="row__main">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {onClick ? <Icon name="chevron-right" size="sm" /> : <span className="pill pill--muted">Скоро</span>}
    </button>
  );
}

const capabilityLabels: Readonly<Record<string, string>> = {
  "customer.session.read": "сессия",
  "customer.capabilities.read": "права доступа"
};

function apiAccessDetail(access: CustomerApiAccess): string {
  if (access.status === "not-configured") return "Не подключён · локальные тестовые данные";
  if (access.status === "unavailable") return "Недоступен · проверьте тестовый сервер";
  const granted = access.granted.map((capability) => capabilityLabels[capability] ?? capability).join(", ");
  return `Подключён · только чтение: ${granted || "нет прав"} · операции с деньгами отключены`;
}

export function ProfileScreen({ session, profile, openSheet, switchScenario, logout, theme, setTheme }: Props) {
  const verified = profile.kyc.state === "verified";
  return (
    <section className="screen" aria-label="Профиль">
      <ScreenTitle>Профиль</ScreenTitle>
      <div className="profile-card">
        <span className="avatar avatar--lg" aria-hidden="true">Т</span>
        <div>
          <strong>{profile.displayName}</strong>
          <span className="num">{profile.customerRef} · {profile.kyc.level}</span>
          <span className="pill pill--muted">{session.source === "telegram" ? "Сессия Telegram" : "Синтетическая dev-сессия"}</span>
        </div>
      </div>
      <div className="list">
        <MenuRow
          icon={verified ? "shield-check" : "id-card"}
          title="Идентификация"
          detail={verified ? "Пройдена · синтетический сценарий" : "Не пройдена · Пройти проверку (тест)"}
          onClick={() => openSheet({ kind: verified ? "kyc" : "kyc-required" })}
        />
        <MenuRow
          icon="percent"
          title="Лимиты и комиссии"
          detail="Лимиты не настроены (D-014)"
          onClick={() => openSheet({ kind: "limits" })}
        />
        <MenuRow
          icon="shield"
          title="Безопасность"
          detail="Центр безопасности · заглушки"
          onClick={() => openSheet({ kind: "security" })}
        />
        <div className="row row--static">
          <span className="coin coin--menu" aria-hidden="true"><Icon name="shield" size="sm" /></span>
          <span className="row__main">
            <strong>Клиентский API</strong>
            <span>{apiAccessDetail(profile.apiAccess)}</span>
          </span>
        </div>
        <MenuRow icon="bank" title="Реквизиты и адреса" detail="Банковский счёт · whitelist адресов" />
        <MenuRow icon="file" title="Документы" detail="Чеки, выписки и соглашения" />
        <MenuRow icon="help" title="Поддержка" detail="Открыть обращение или FAQ" onClick={() => openSheet({ kind: "support" })} />
      </div>

      <span className="section-label">Оформление</span>
      <div className="list">
        <div className="row row--static">
          <span className="coin coin--menu" aria-hidden="true"><Icon name="moon" size="sm" /></span>
          <span className="row__main">
            <strong>Тёмная тема</strong>
            <span>По умолчанию — как в Telegram</span>
          </span>
          <Switch label="Тёмная тема" checked={theme === "dark"} onChange={(dark) => setTheme(dark ? "dark" : "light")} />
        </div>
      </div>

      {session.source === "dev-synthetic" ? (
        <div className="dev-panel">
          <span className="section-label">Тестовый сценарий</span>
          <fieldset className="segment segment--compact" aria-label="Сценарий KYC">
            <button type="button" aria-pressed={verified} onClick={() => switchScenario("verified")}>Проверка пройдена</button>
            <button type="button" aria-pressed={!verified} onClick={() => switchScenario("kyc-gated")}>Без KYC</button>
          </fieldset>
        </div>
      ) : null}

      <button type="button" className="cta cta--ghost" onClick={logout}>Выйти</button>
    </section>
  );
}
