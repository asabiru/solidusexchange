import type { CustomerApiAccess, KycStatus, ProfileView, SessionView } from "../../shared/api";
import { type Locale, localeNames, locales, type MessageKey, messageKeyFor } from "../i18n";
import { useI18n } from "../i18n-context";
import { Icon, type IconName } from "../Icon";
import type { SheetRequest } from "../navigation";
import { arrayOf } from "../server-fields";
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
  const { t } = useI18n();
  return (
    <button type="button" className="row" onClick={onClick} disabled={!onClick} aria-disabled={!onClick}>
      <span className="coin coin--menu" aria-hidden="true"><Icon name={icon} size="sm" /></span>
      <span className="row__main">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {onClick ? <Icon name="chevron-right" size="sm" /> : <span className="pill pill--muted">{t("common.soon")}</span>}
    </button>
  );
}

const capabilityLabels: Readonly<Record<string, MessageKey>> = {
  "customer.session.read": "profile.capSession",
  "customer.capabilities.read": "profile.capCapabilities"
};

function apiAccessDetail(access: CustomerApiAccess, t: (key: MessageKey, params?: Readonly<Record<string, string>>) => string): string {
  if (access.status === "not-configured") return t("profile.apiNotConfigured");
  if (access.status === "unavailable") return t("profile.apiUnavailable");
  const granted = arrayOf<string>(access.granted).map((capability) => {
    const key = messageKeyFor(capabilityLabels, capability);
    return key ? t(key) : capability;
  }).join(", ");
  return t("profile.apiConnected", { granted: granted || t("profile.apiNoRights") });
}

export function ProfileScreen({ session, profile, openSheet, switchScenario, logout, theme, setTheme }: Props) {
  const verified = profile.kyc?.state === "verified";
  const { t, locale, setLocale } = useI18n();
  return (
    <section className="screen" aria-label={t("tab.profile")}>
      <ScreenTitle>{t("tab.profile")}</ScreenTitle>
      <div className="profile-card">
        <span className="avatar avatar--lg" aria-hidden="true">{String(profile.displayName ?? "—").slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{profile.displayName ?? "—"}</strong>
          <span className="num">{profile.customerRef} · {profile.kyc?.level ?? "—"}</span>
          <span className="pill pill--muted">{t(session.source === "telegram" ? "profile.sessionTelegram" : "profile.sessionDev")}</span>
        </div>
      </div>
      <div className="list">
        <MenuRow
          icon={verified ? "shield-check" : "id-card"}
          title={t("kyc.title")}
          detail={t(verified ? "profile.kycVerified" : "profile.kycNotVerified")}
          onClick={() => openSheet({ kind: verified ? "kyc" : "kyc-required" })}
        />
        <MenuRow
          icon="percent"
          title={t("profile.limitsTitle")}
          detail={t("profile.limitsDetail")}
          onClick={() => openSheet({ kind: "limits" })}
        />
        <MenuRow
          icon="shield"
          title={t("profile.securityTitle")}
          detail={t("profile.securityDetail")}
          onClick={() => openSheet({ kind: "security" })}
        />
        <MenuRow
          icon="device"
          title={t("profile.sessionsTitle")}
          detail={t("profile.sessionsDetail")}
          onClick={() => openSheet({ kind: "sessions" })}
        />
        <div className="row row--static">
          <span className="coin coin--menu" aria-hidden="true"><Icon name="shield" size="sm" /></span>
          <span className="row__main">
            <strong>{t("profile.apiTitle")}</strong>
            <span>{apiAccessDetail(profile.apiAccess, t)}</span>
          </span>
        </div>
        <MenuRow icon="bank" title={t("profile.requisitesTitle")} detail={t("profile.requisitesDetail")} />
        <MenuRow icon="file" title={t("profile.documentsTitle")} detail={t("profile.documentsDetail")} />
        <MenuRow icon="help" title={t("common.support")} detail={t("profile.supportDetail")} onClick={() => openSheet({ kind: "support" })} />
      </div>

      <h2 className="section-label">{t("profile.appearance")}</h2>
      <div className="list">
        <div className="row row--static">
          <span className="coin coin--menu" aria-hidden="true"><Icon name="moon" size="sm" /></span>
          <span className="row__main">
            <strong>{t("app.themeDark")}</strong>
            <span>{t("profile.darkThemeDetail")}</span>
          </span>
          <Switch label={t("app.themeDark")} checked={theme === "dark"} onChange={(dark) => setTheme(dark ? "dark" : "light")} />
        </div>
      </div>

      <h2 className="section-label">{t("profile.language")}</h2>
      <fieldset className="segment segment--compact" aria-label={t("profile.languagePicker")}>
        {locales.map((value: Locale) => (
          <button type="button" key={value} lang={value} aria-pressed={locale === value} onClick={() => setLocale(value)}>
            {localeNames[value]}
          </button>
        ))}
      </fieldset>
      <p className="note">{t("profile.languageNote")}</p>

      {session.source === "dev-synthetic" ? (
        <div className="dev-panel">
          <h2 className="section-label">{t("profile.devScenario")}</h2>
          <fieldset className="segment segment--compact" aria-label={t("profile.devScenarioLabel")}>
            <button type="button" aria-pressed={verified} onClick={() => switchScenario("verified")}>{t("profile.scenarioVerified")}</button>
            <button type="button" aria-pressed={!verified} onClick={() => switchScenario("kyc-gated")}>{t("profile.scenarioGated")}</button>
          </fieldset>
        </div>
      ) : null}

      <button type="button" className="cta cta--ghost" onClick={logout}>{t("profile.logout")}</button>
    </section>
  );
}
