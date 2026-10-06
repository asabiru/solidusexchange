export type CspDirectives = Readonly<Record<string, readonly string[]>>;

export const devServerPort = 4173;

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

export const apiSecurityHeaders: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": serializeCsp(apiCspDirectives),
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": permissionsPolicy,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});

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
  "frame-ancestors": ["'none'"]
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
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": permissionsPolicy,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  });
}

export const documentSecurityHeaders = documentHeaders(documentCspDirectives);
export const devDocumentSecurityHeaders = documentHeaders(devDocumentCspDirectives);
