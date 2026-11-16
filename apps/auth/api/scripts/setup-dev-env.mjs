// Siapkan env DEVELOPMENT SSO workingspace.id (docs/SETUP.md §3 langkah 5). Aman dijalankan ulang:
//  1. apps/auth/api/.env dibuat bila belum ada (kunci JWKS, kunci cookie, secret klien "akasha" dibuat acak);
//     bila sudah ada, tidak diubah.
//  2. Variabel SSO_* di apps/akasha/api/.env diisi bila belum ada (secret klien diambil dari langkah 1).
// Production TIDAK memakai skrip ini (docs/DEPLOYMENT.md, rahasia diisi pemilik di VPS).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AUTH_DIR = resolve(import.meta.dirname, "..");
const AUTH_ENV = resolve(AUTH_DIR, ".env");
const AKASHA_ENV = resolve(AUTH_DIR, "../../akasha/api/.env");
const secret = () => randomBytes(32).toString("base64url");

function authEnvBody() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...privateKey.export({ format: "jwk" }),
    kid: `dev-${randomBytes(4).toString("hex")}`,
    use: "sig",
    alg: "RS256",
  };
  const clients = [
    {
      client_id: "akasha",
      client_secret: secret(),
      redirect_uris: ["http://localhost:5173/api/v1/auth/sso/callback"],
      post_logout_redirect_uris: ["http://localhost:5173/login"],
    },
  ];
  return `NODE_ENV=development
PORT=4300
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workingspace_auth?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workingspace_auth_shadow?schema=public"
# Alamat publik halaman SSO (dev: Vite auth web 5175 meneruskan /api, /oidc, /interaction ke port 4300)
PUBLIC_URL="http://auth.localhost:5175"
# Kunci privat penanda tangan token (dibuat acak oleh scripts/setup-dev-env.mjs)
OIDC_JWKS='${JSON.stringify({ keys: [jwk] })}'
OIDC_COOKIE_KEYS="${secret()},${secret()}"
# Klien OIDC per aplikasi (client_id = kunci aplikasi). Secret Akasha sama dengan SSO_CLIENT_SECRET di apps/akasha/api/.env
OIDC_CLIENTS='${JSON.stringify(clients)}'
# Email (Titan). Kosong = email ditulis ke folder MAIL_DIR (development)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM="Workingspace <noreply@workingspace.id>"
MAIL_DIR=".mail"
# Masuk dengan Google (kosong = tombol disembunyikan)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
`;
}

if (existsSync(AUTH_ENV)) console.log("apps/auth/api/.env sudah ada — tidak diubah.");
else {
  writeFileSync(AUTH_ENV, authEnvBody());
  console.log("apps/auth/api/.env dibuat (kunci acak baru).");
}

const authEnv = readFileSync(AUTH_ENV, "utf8");
const clientsLine = authEnv.match(/^OIDC_CLIENTS='(.*)'$/m);
const akashaClient = clientsLine && JSON.parse(clientsLine[1]).find((c) => c.client_id === "akasha");
if (!akashaClient) {
  console.error("Klien 'akasha' tidak ada di OIDC_CLIENTS apps/auth/api/.env — periksa berkasnya.");
  process.exit(1);
}

if (!existsSync(AKASHA_ENV)) {
  console.error("apps/akasha/api/.env belum ada. Salin dulu dari .env.example (docs/SETUP.md §3 langkah 4).");
  process.exit(1);
}
let akashaEnv = readFileSync(AKASHA_ENV, "utf8");
if (/^SSO_ISSUER=\S/m.test(akashaEnv) && /^SSO_CLIENT_SECRET=\S/m.test(akashaEnv)) {
  console.log("SSO_* di apps/akasha/api/.env sudah terisi — tidak diubah.");
} else {
  const values = {
    SSO_ISSUER: '"http://auth.localhost:5175/oidc"',
    SSO_CLIENT_ID: "akasha",
    SSO_CLIENT_SECRET: `"${akashaClient.client_secret}"`,
    SSO_REDIRECT_URI: `"${akashaClient.redirect_uris[0]}"`,
    SSO_POST_LOGOUT_URI: `"${akashaClient.post_logout_redirect_uris[0]}"`,
  };
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    akashaEnv = pattern.test(akashaEnv)
      ? akashaEnv.replace(pattern, () => line)
      : `${akashaEnv.replace(/\s*$/, "\n")}${line}\n`;
  }
  writeFileSync(AKASHA_ENV, akashaEnv);
  console.log("SSO_* di apps/akasha/api/.env diisi (restart backend Akasha agar terbaca).");
}
