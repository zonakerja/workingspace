import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { canonicalHost } from "@workingspace/ui/vite-canonical-host";
import { defineConfig } from "vite";

// Halaman depan workingspace.id: statis, tanpa backend. Alamat SSO & aplikasi dari env build (src/config.ts).
export default defineConfig({
  plugins: [react(), tailwindcss(), canonicalHost("workingspace.localhost:5176")],
  server: { port: 5176, strictPort: true },
  preview: { port: 4176, strictPort: true },
});
