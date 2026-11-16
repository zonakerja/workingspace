import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { canonicalHost } from "@workingspace/ui/vite-canonical-host";
import { defineConfig } from "vite";

// Akai web. Dev dibuka di http://akai.workingspace.localhost:5177 (satu situs dengan SSO dev). /api diteruskan ke Akai API
// (4400) dengan Host asli, sehingga callback SSO & cookie sesi sama dengan produksi (docs/AKAI.md §2).
export default defineConfig({
  plugins: [react(), tailwindcss(), canonicalHost("akai.workingspace.localhost:5177")],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // Mermaid (diagram artifact, elk ± 1,4 MB) hanya dimuat saat ada diagram; chunk utama tetap kecil (sama dengan Akasha)
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5177,
    strictPort: true,
    proxy: { "/api": { target: "http://localhost:4400", changeOrigin: false, xfwd: true } },
  },
});
