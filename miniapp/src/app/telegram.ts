import { languageCodeFromInitData } from "./i18n";

type ColorScheme = "light" | "dark";

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { user?: { language_code?: unknown } };
  colorScheme?: ColorScheme;
  ready?: () => void;
  expand?: () => void;
  onEvent?: (event: "themeChanged", handler: () => void) => void;
  offEvent?: (event: "themeChanged", handler: () => void) => void;
}

export function telegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

function launchParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.slice(1));
}

export function readInitData(): string | undefined {
  const fromSdk = telegramWebApp()?.initData;
  if (fromSdk) return fromSdk;
  return launchParams().get("tgWebAppData") || undefined;
}

/** Telegram user language; only picks the UI locale and is never trusted for access decisions. */
export function telegramLanguageCode(): string | undefined {
  const fromSdk = telegramWebApp()?.initDataUnsafe?.user?.language_code;
  if (typeof fromSdk === "string") return fromSdk;
  return languageCodeFromInitData(readInitData());
}

export function telegramColorScheme(): ColorScheme | undefined {
  const fromSdk = telegramWebApp()?.colorScheme;
  if (fromSdk === "light" || fromSdk === "dark") return fromSdk;
  const raw = launchParams().get("tgWebAppThemeParams");
  if (!raw) return undefined;
  try {
    const params = JSON.parse(raw) as { bg_color?: unknown };
    const match = typeof params.bg_color === "string" ? /^#([0-9a-f]{6})$/i.exec(params.bg_color) : null;
    if (!match) return undefined;
    const rgb = Number.parseInt(match[1], 16);
    const luminance = 0.2126 * (rgb >> 16) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255);
    return luminance < 128 ? "dark" : "light";
  } catch {
    return undefined;
  }
}

export function onTelegramThemeChange(handler: (scheme: ColorScheme) => void): () => void {
  const webApp = telegramWebApp();
  if (!webApp?.onEvent) return () => undefined;
  const listener = () => {
    // colorScheme is live SDK state: only known schemes drive the theme.
    if (webApp.colorScheme === "light" || webApp.colorScheme === "dark") handler(webApp.colorScheme);
  };
  webApp.onEvent("themeChanged", listener);
  return () => webApp.offEvent?.("themeChanged", listener);
}
