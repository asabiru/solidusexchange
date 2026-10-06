import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devDocumentSecurityHeaders, devServerPort, documentSecurityHeaders } from "./src/server/security-headers";

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

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false
  },
  server: {
    host: "127.0.0.1",
    port: devServerPort,
    strictPort: true,
    headers: { ...devDocumentSecurityHeaders },
    proxy: {
      "/bff": { target: "http://127.0.0.1:4184", bypass: (request) => (isMetricsPath(request.url) ? false : undefined) }
    }
  },
  preview: {
    headers: { ...documentSecurityHeaders }
  }
});
