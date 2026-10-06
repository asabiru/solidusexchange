import { useCallback, useEffect, useState } from "react";
import type {
  HealthView,
  KycStatus,
  NotificationsView,
  OperationSummary,
  ProfileView,
  SessionView,
  WalletView
} from "../shared/api";
import { ApiError, api } from "./api";
import { applyDocumentLocale, initialLocale, type Locale, type LocaleStorage, type MessageKey, storeLocale, translate } from "./i18n";
import { I18nProvider } from "./i18n-context";
import { Icon, type IconName } from "./Icon";
import type { SheetRequest, Tab } from "./navigation";
import { ExchangeScreen } from "./screens/ExchangeScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { OperationsScreen } from "./screens/OperationsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { QrScreen } from "./screens/QrScreen";
import { SheetHost } from "./sheets";
import { onTelegramThemeChange, readInitData, telegramColorScheme, telegramLanguageCode, telegramWebApp } from "./telegram";

type Theme = "light" | "dark";

interface CustomerData {
  wallet: WalletView;
  operations: readonly OperationSummary[];
  profile: ProfileView;
  notifications: NotificationsView;
}

type Launch =
  | { state: "loading" }
  | { state: "signed-out"; health?: HealthView; message?: MessageKey }
  | { state: "ready"; session: SessionView; data: CustomerData };

const tabs: readonly { id: Tab; label: MessageKey; icon: IconName }[] = [
  { id: "home", label: "tab.home", icon: "home" },
  { id: "exchange", label: "tab.exchange", icon: "swap" },
  { id: "qr", label: "tab.qr", icon: "qr" },
  { id: "activity", label: "tab.activity", icon: "clock" },
  { id: "profile", label: "tab.profile", icon: "user" }
];

const rejectionMessages: Readonly<Record<string, MessageKey>> = {
  stale_auth_date: "launch.errorStaleAuthDate",
  invalid_hash: "launch.errorInvalidHash",
  telegram_verification_not_configured: "launch.errorTelegramNotConfigured"
};

function localeStorage(): LocaleStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function detectLocale(): Locale {
  return initialLocale({ storage: localeStorage(), languageCode: telegramLanguageCode() });
}

function initialTheme(): Theme {
  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "light" || requested === "dark") return requested;
  const telegram = telegramColorScheme();
  if (telegram) return telegram;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function loadCustomerData(): Promise<CustomerData> {
  const [wallet, operations, profile, notifications] = await Promise.all([
    api.wallet(),
    api.operations(),
    api.profile(),
    api.notifications()
  ]);
  return { wallet, operations: operations.operations, profile, notifications };
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const [launch, setLaunch] = useState<Launch>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("home");
  const [sheet, setSheet] = useState<SheetRequest | undefined>();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    applyDocumentLocale(document, locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    storeLocale(localeStorage(), next);
    setLocaleState(next);
  }, []);

  const t = useCallback((key: MessageKey) => translate(locale, key), [locale]);

  useEffect(() => onTelegramThemeChange(setTheme), []);

  useEffect(() => {
    const update = () => setCollapsed(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const openTab = useCallback((next: Tab) => {
    setSheet(undefined);
    setTab(next);
    window.scrollTo({ top: 0 });
  }, []);

  const enter = useCallback(async (session: SessionView) => {
    setLaunch({ state: "ready", session, data: await loadCustomerData() });
  }, []);

  useEffect(() => {
    let active = true;
    async function start() {
      telegramWebApp()?.ready?.();
      telegramWebApp()?.expand?.();
      try {
        const session = await api.session();
        if (active) await enter(session);
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      const health = await api.health();
      const initData = readInitData();
      if (initData) {
        try {
          const session = await api.telegramLogin(initData);
          if (active) await enter(session);
          return;
        } catch (error) {
          const code = error instanceof ApiError ? error.reason ?? error.code : "request_failed";
          if (active) setLaunch({ state: "signed-out", health, message: rejectionMessages[code] ?? "launch.errorTelegramFailed" });
          return;
        }
      }
      if (active) setLaunch({ state: "signed-out", health });
    }
    start().catch(() => {
      if (active) setLaunch({ state: "signed-out", message: "launch.errorBffUnavailable" });
    });
    return () => {
      active = false;
    };
  }, [enter]);

  const devLogin = useCallback(async (kyc: KycStatus) => {
    try {
      await enter(await api.devLogin(kyc));
      setSheet(undefined);
      setTab("home");
    } catch {
      setLaunch({ state: "signed-out", message: "launch.errorDevLoginUnavailable" });
    }
  }, [enter]);

  const refreshSession = useCallback(async () => {
    await enter(await api.session());
  }, [enter]);

  const setNotifications = useCallback((notifications: NotificationsView) => {
    setLaunch((current) => current.state === "ready"
      ? { ...current, data: { ...current.data, notifications } }
      : current);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(undefined);
    api.notifications().then(setNotifications).catch(() => undefined);
  }, [setNotifications]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSheet(undefined);
    setTab("home");
    setLaunch({ state: "signed-out", health: await api.health().catch(() => undefined) });
  }, []);

  const toggleTheme = (
    <button
      type="button"
      className="icon-btn"
      aria-label={t(theme === "dark" ? "app.themeLight" : "app.themeDark")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );

  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      <div className="app">
        <header className={collapsed && launch.state === "ready" ? "topbar is-collapsed" : "topbar"}>
          <span className="brand">
            <span className="brand__mark" aria-hidden="true">S</span>
            <span className="brand__text">
              <span className="brand__name serif">SolidChange</span>
              <span className="topbar__title" aria-hidden="true">{t(tabs.find((item) => item.id === tab)?.label ?? "tab.home")}</span>
            </span>
          </span>
          <span className="dev-badge">{t("app.devBadge")}</span>
          {toggleTheme}
        </header>

        {launch.state === "loading" ? <div className="launch"><p>{t("launch.checking")}</p></div> : null}

        {launch.state === "signed-out" ? (
          <main className="launch">
            <h1>{t("launch.welcome")}</h1>
            <p>{t("launch.intro")}</p>
            {launch.message ? <p className="form-error" role="alert">{t(launch.message)}</p> : null}
            {launch.health?.devLogin ? (
              <div className="launch__actions">
                <button type="button" className="cta" onClick={() => devLogin("verified")}>
                  {t("launch.devLoginVerified")}
                </button>
                <button type="button" className="cta cta--secondary" onClick={() => devLogin("kyc-gated")}>
                  {t("launch.devLoginGated")}
                </button>
                <span className="disabled-cta__hint">{t("launch.devLoginHint")}</span>
              </div>
            ) : (
              <p className="note">{t("launch.openFromTelegram")}</p>
            )}
          </main>
        ) : null}

        {launch.state === "ready" ? (
          <>
            <main className="content" key={tab}>
              {tab === "home" ? (
                <HomeScreen
                  session={launch.session}
                  wallet={launch.data.wallet}
                  operations={launch.data.operations}
                  unreadNotifications={launch.data.notifications.unread}
                  openSheet={setSheet}
                  openTab={openTab}
                />
              ) : null}
              {tab === "exchange" ? <ExchangeScreen wallet={launch.data.wallet} openSheet={setSheet} /> : null}
              {tab === "qr" ? <QrScreen wallet={launch.data.wallet} openSheet={setSheet} /> : null}
              {tab === "activity" ? <OperationsScreen /> : null}
              {tab === "profile" ? (
                <ProfileScreen
                  session={launch.session}
                  profile={launch.data.profile}
                  openSheet={setSheet}
                  switchScenario={devLogin}
                  logout={logout}
                  theme={theme}
                  setTheme={setTheme}
                />
              ) : null}
            </main>
            <nav className="bottom-nav" aria-label={t("app.navLabel")}>
              {tabs.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`nav${item.id === "qr" ? " nav--qr" : ""}`}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => openTab(item.id)}
                >
                  <span className="nav__icon"><Icon name={item.icon} /></span>
                  <span className="nav__label">{t(item.label)}</span>
                </button>
              ))}
            </nav>
            {sheet ? (
              <SheetHost
                sheet={sheet}
                wallet={launch.data.wallet}
                profile={launch.data.profile}
                close={closeSheet}
                open={setSheet}
                onKycVerified={refreshSession}
                onNotificationsRead={setNotifications}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </I18nProvider>
  );
}
