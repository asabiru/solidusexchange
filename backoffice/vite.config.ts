import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    port: 4173,
    strictPort: true,
    proxy: {
      "/bff": { target: "http://127.0.0.1:4174", bypass: (request) => (isMetricsPath(request.url) ? false : undefined) }
    }
  }
});
