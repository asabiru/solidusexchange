import { Server } from "node:http";
import { type Plugin, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  devDocumentSecurityHeaders,
  devServerPort,
  documentSecurityHeaders,
  guardRawResponses
} from "./src/server/security-headers";

// Dev metrics stay on the BFF's own loopback port, never via the app origin,
// including dot-segment, %2e or backslash spellings that normalize to the path.
function isMetricsPath(url: string | undefined): boolean {
  const raw = url ?? "/";
  try {
    return raw.startsWith("/bff/metrics") || new URL(raw, "http://127.0.0.1").pathname.startsWith("/bff/metrics");
  } catch {
    return true;
  }
}

// server.headers and preview.headers miss Vite's own 403, 404, 500 and CORS
// preflight replies, so the header set is applied before Vite handles anything.
function securityHeaders(): Plugin {
  const install = (headers: Readonly<Record<string, string>>) => ({ httpServer }: { httpServer: unknown }) => {
    if (!(httpServer instanceof Server)) return;
    httpServer.prependListener("request", (_request, response) => {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    });
    guardRawResponses(httpServer, headers);
  };
  return {
    name: "solid-security-headers",
    configureServer: install(devDocumentSecurityHeaders),
    configurePreviewServer: install(documentSecurityHeaders)
  };
}

export default defineConfig({
  plugins: [react(), securityHeaders()],
  build: {
    sourcemap: false
  },
  server: {
    host: "127.0.0.1",
    port: devServerPort,
    strictPort: true,
    headers: { ...devDocumentSecurityHeaders },
    proxy: {
      "/bff": { target: "http://127.0.0.1:4174", bypass: (request) => (isMetricsPath(request.url) ? false : undefined) }
    }
  },
  preview: {
    headers: { ...documentSecurityHeaders }
  }
});
