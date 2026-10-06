import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false
  },
  server: {
    host: "127.0.0.1",
    port: 4183,
    strictPort: true,
    proxy: {
      // Dev metrics stay on the BFF's own loopback port, never via the app origin.
      "/bff/metrics": { target: "http://127.0.0.1:4184", bypass: () => false },
      "/bff": "http://127.0.0.1:4184"
    }
  }
});
