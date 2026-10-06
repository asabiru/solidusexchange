export type CspDirectives = Readonly<Record<string, readonly string[]>>;

export const devServerPort = 4183;

export const permissionsPolicy = [
  "accelerometer",
  "bluetooth",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "hid",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "serial",
  "usb",
  "xr-spatial-tracking"
].map((feature) => `${feature}=()`).join(", ");

function freezeDirectives(directives: Record<string, string[]>): CspDirectives {
  return Object.freeze(Object.fromEntries(
    Object.entries(directives).map(([name, sources]) => [name, Object.freeze(sources)])
  ));
}

export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

export const apiCspDirectives = freezeDirectives({
  "default-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
  "frame-ancestors": ["'none'"]
});

/** JSON from the BFF is never a document, so it may not be framed even by Telegram. */
export const apiSecurityHeaders: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": serializeCsp(apiCspDirectives),
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": permissionsPolicy,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});

// Telegram Web (web.telegram.org and its *.telegram.org variants) embeds the
// Mini App document in an iframe; mobile and desktop clients use a webview
// that does not frame it. X-Frame-Options cannot express an allowlist, so the
// document relies on CSP frame-ancestors alone.
export const telegramFrameAncestors: readonly string[] = Object.freeze([
  "https://web.telegram.org",
  "https://*.telegram.org"
]);

// The Telegram WebApp SDK script is not loaded (index.html has no external
// script; telegram.ts reads window.Telegram.WebApp or the launch hash), so
// script-src needs no Telegram origin.
export const documentCspDirectives = freezeDirectives({
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "font-src": ["'self'"],
  "connect-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'self'"],
  "frame-ancestors": [...telegramFrameAncestors]
});

// Vite dev only: the React Refresh preamble is an inline module script, CSS
// imports are injected as <style> elements, and the HMR client connects over
// ws to the dev server. Preview and build keep documentCspDirectives.
export const devDocumentCspDirectives = freezeDirectives({
  ...Object.fromEntries(Object.entries(documentCspDirectives).map(([name, sources]) => [name, [...sources]])),
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "connect-src": ["'self'", `ws://127.0.0.1:${devServerPort}`, `ws://localhost:${devServerPort}`]
});

function documentHeaders(directives: CspDirectives): Readonly<Record<string, string>> {
  return Object.freeze({
    "content-security-policy": serializeCsp(directives),
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": permissionsPolicy,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
}

export const documentSecurityHeaders = documentHeaders(documentCspDirectives);
export const devDocumentSecurityHeaders = documentHeaders(devDocumentCspDirectives);
