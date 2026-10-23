import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `pnpm dev` serves the UI on :5173 and forwards /api to the Simha server
 * (`pnpm start`, :8787). `pnpm build` writes dist/, which the server serves.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env["SIMHA_API"] ?? process.env["SIMRS_API"] ?? "http://127.0.0.1:8787", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 1500 },
});
