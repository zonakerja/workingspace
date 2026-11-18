// Siapkan env DEVELOPMENT Akai API (docs/AKAI.md). Aman dijalankan ulang:
//  1. apps/akai/api/.env dibuat bila belum ada (kunci enkripsi & secret klien "akasha" acak).
//  2. AKAI_* di apps/akasha/api/.env diisi bila belum ada (secret klien "akasha" diambil dari langkah 1) — Akasha memakai
//     gateway Akai untuk tugas yang diatur di Akai web (langkah 6a.4).
// Production TIDAK memakai skrip ini.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV = resolve(import.meta.dirname, "../.env");
const AKASHA_ENV = resolve(import.meta.dirname, "../../../akasha/api/.env");

if (existsSync(ENV)) {
  console.log("apps/akai/api/.env sudah ada — tidak diubah.");
} else {
  const clients = [{ client_id: "akasha", client_secret: randomBytes(32).toString("base64url") }];
  writeFileSync(
    ENV,
    `NODE_ENV=development
PORT=4400
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/akai?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/akai_shadow?schema=public"
# Kunci enkripsi API key sumber model (dibuat acak)
AKAI_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}
# Aplikasi ekosistem yang boleh memanggil Akai
AKAI_CLIENTS='${JSON.stringify(clients)}'
# Konektor Akasha (MCP Akasha, 6b.5)
AKASHA_MCP_URL="http://localhost:4000/api/v1/mcp"
# Alamat Akai web (callback OAuth konektor & tautan email tugas terjadwal; tanpa SSO tidak bisa diturunkan dari SSO_REDIRECT_URI)
AKAI_WEB_URL="http://akai.workingspace.localhost:5177"
`,
  );
  console.log("apps/akai/api/.env dibuat (kunci acak baru).");
}

const clientsLine = readFileSync(ENV, "utf8").match(/^AKAI_CLIENTS='(.*)'$/m);
const akasha = clientsLine && JSON.parse(clientsLine[1]).find((c) => c.client_id === "akasha");
if (!akasha) {
  console.log("Klien 'akasha' tidak ada di AKAI_CLIENTS — AKAI_* Akasha tidak diisi.");
} else if (!existsSync(AKASHA_ENV)) {
  console.log("apps/akasha/api/.env belum ada — AKAI_* Akasha tidak diisi.");
} else {
  let env = readFileSync(AKASHA_ENV, "utf8");
  if (/^AKAI_CLIENT_SECRET=\S/m.test(env)) console.log("AKAI_* di apps/akasha/api/.env sudah terisi — tidak diubah.");
  else {
    const values = {
      AKAI_URL: '"http://localhost:4400"',
      AKAI_CLIENT_ID: "akasha",
      AKAI_CLIENT_SECRET: `"${akasha.client_secret}"`,
      AKAI_WEB_URL: '"http://akai.workingspace.localhost:5177"',
    };
    for (const [key, value] of Object.entries(values)) {
      const line = `${key}=${value}`;
      const pattern = new RegExp(`^${key}=.*$`, "m");
      env = pattern.test(env) ? env.replace(pattern, () => line) : `${env.replace(/\s*$/, "\n")}${line}\n`;
    }
    writeFileSync(AKASHA_ENV, env);
    console.log("AKAI_* di apps/akasha/api/.env diisi (restart backend Akasha agar terbaca).");
  }
}
