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
import { Icon, type IconName } from "./Icon";
import type { SheetRequest, Tab } from "./navigation";
import { ExchangeScreen } from "./screens/ExchangeScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { OperationsScreen } from "./screens/OperationsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { QrScreen } from "./screens/QrScreen";
import { SheetHost } from "./sheets";
import { onTelegramThemeChange, readInitData, telegramColorScheme, telegramWebApp } from "./telegram";

type Theme = "light" | "dark";

interface CustomerData {
  wallet: WalletView;
  operations: readonly OperationSummary[];
  profile: ProfileView;
  notifications: NotificationsView;
}

type Launch =
  | { state: "loading" }
  | { state: "signed-out"; health?: HealthView; message?: string }
  | { state: "ready"; session: SessionView; data: CustomerData };

const tabs: readonly { id: Tab; label: string; icon: IconName }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "exchange", label: "Обмен", icon: "swap" },
  { id: "qr", label: "QR", icon: "qr" },
  { id: "activity", label: "Операции", icon: "clock" },
  { id: "profile", label: "Профиль", icon: "user" }
];

const rejectionMessages: Readonly<Record<string, string>> = {
  stale_auth_date: "Данные запуска устарели. Откройте Mini App из Telegram ещё раз.",
  invalid_hash: "Подпись данных запуска не прошла проверку.",
  telegram_verification_not_configured: "Проверка Telegram не настроена в этой dev-среде."
};

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
  const [launch, setLaunch] = useState<Launch>({ state: "loading" });
  const [tab, setTab] = useState<Tab>("home");
  const [sheet, setSheet] = useState<SheetRequest | undefined>();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
          if (active) setLaunch({ state: "signed-out", health, message: rejectionMessages[code] ?? "Не удалось проверить данные запуска Telegram." });
          return;
        }
      }
      if (active) setLaunch({ state: "signed-out", health });
    }
    start().catch(() => {
      if (active) setLaunch({ state: "signed-out", message: "Dev BFF недоступен. Запустите npm run dev." });
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
      setLaunch({ state: "signed-out", message: "Тестовый вход недоступен." });
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
      aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );

  return (
    <div className="app">
      <header className={collapsed && launch.state === "ready" ? "topbar is-collapsed" : "topbar"}>
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">S</span>
          <span className="brand__text">
            <span className="brand__name serif">SolidChange</span>
            <span className="topbar__title" aria-hidden="true">{tabs.find((item) => item.id === tab)?.label}</span>
          </span>
        </span>
        <span className="dev-badge">Тестовая версия</span>
        {toggleTheme}
      </header>

      {launch.state === "loading" ? <div className="launch"><p>Проверяем сессию…</p></div> : null}

      {launch.state === "signed-out" ? (
        <main className="launch">
          <h1>Добро пожаловать</h1>
          <p>
            Тестовая версия Telegram Mini App. Все данные синтетические, деньги не двигаются, внешние
            провайдеры не подключены.
          </p>
          {launch.message ? <p className="form-error" role="alert">{launch.message}</p> : null}
          {launch.health?.devLogin ? (
            <div className="launch__actions">
              <button type="button" className="cta" onClick={() => devLogin("verified")}>
                Войти: проверка пройдена
              </button>
              <button type="button" className="cta cta--secondary" onClick={() => devLogin("kyc-gated")}>
                Войти: без KYC
              </button>
              <span className="disabled-cta__hint">Синтетический dev-вход доступен только на loopback.</span>
            </div>
          ) : (
            <p className="note">Откройте приложение из Telegram, чтобы продолжить.</p>
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
            {tab === "activity" ? <OperationsScreen operations={launch.data.operations} openSheet={setSheet} /> : null}
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
          <nav className="bottom-nav" aria-label="Основная навигация">
            {tabs.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`nav${item.id === "qr" ? " nav--qr" : ""}`}
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => openTab(item.id)}
              >
                <span className="nav__icon"><Icon name={item.icon} /></span>
                <span className="nav__label">{item.label}</span>
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
  );
}
