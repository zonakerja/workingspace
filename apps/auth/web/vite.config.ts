import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { canonicalHost } from "@workingspace/ui/vite-canonical-host";
import { defineConfig } from "vite";

// Halaman SSO workingspace.id. Dev dibuka di http://auth.workingspace.localhost:5175 (asal berbeda dari Akasha seperti produksi).
// /api, /oidc, /interaction diteruskan ke layanan SSO (4300) dengan Host asli agar alamat & cookie sama dengan produksi.
const sso = { target: "http://localhost:4300", changeOrigin: false, xfwd: true };

export default defineConfig({
  plugins: [react(), tailwindcss(), canonicalHost("auth.workingspace.localhost:5175")],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: { "/api": sso, "/oidc": sso, "/interaction": sso },
  },
});
