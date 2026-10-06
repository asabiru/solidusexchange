import { type IncomingMessage, type Server, type ServerResponse, STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";

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

type HeaderSet = Readonly<Record<string, string>>;

const clientErrorStatuses: ReadonlyMap<string, number> = new Map([
  ["ERR_HTTP_REQUEST_TIMEOUT", 408],
  ["HPE_HEADER_OVERFLOW", 431]
]);

// Node (and Vite's own clientError listener) answer malformed requests and
// unmet Expect headers before any request handler or middleware runs, so
// those replies need the set too.
export function guardRawResponses(server: Server, headers: HeaderSet): void {
  server.prependListener("clientError", (error: NodeJS.ErrnoException, socket: Duplex) => {
    const pending = (socket as Duplex & { _httpMessage?: { headersSent?: boolean } })._httpMessage;
    if (error.code === "ECONNRESET" || !socket.writable || pending?.headersSent) {
      socket.destroy();
      return;
    }
    const status = clientErrorStatuses.get(error.code ?? "") ?? 400;
    const head = [
      `HTTP/1.1 ${status} ${STATUS_CODES[status]}`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      "content-length: 0",
      "connection: close"
    ];
    socket.end(`${head.join("\r\n")}\r\n\r\n`);
  });
  server.on("checkExpectation", (_request: IncomingMessage, response: ServerResponse) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    response.setHeader("connection", "close");
    response.writeHead(417).end();
  });
}
