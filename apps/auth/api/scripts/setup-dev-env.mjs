// Siapkan env DEVELOPMENT SSO workingspace.id (docs/SETUP.md §3 langkah 5). Aman dijalankan ulang:
//  1. apps/auth/api/.env dibuat bila belum ada (kunci JWKS, kunci cookie, secret klien "akasha" dibuat acak);
//     bila sudah ada, tidak diubah.
//  2. Variabel SSO_* di apps/akasha/api/.env diisi bila belum ada (secret klien diambil dari langkah 1).
//  2b. Klien OIDC "akai" ditambahkan bila belum ada; SSO_* di apps/akai/api/.env diisi bila belum ada.
//  3. .env lama dinaikkan ke pengaturan terbaru tanpa mengubah rahasia: host dev auth.workingspace.localhost (dulu
//     auth.localhost), alamat back-channel logout klien Akasha, LANDING_URL halaman depan.
// Production TIDAK memakai skrip ini (docs/DEPLOYMENT.md, rahasia diisi pemilik di VPS).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AUTH_DIR = resolve(import.meta.dirname, "..");
const AUTH_ENV = resolve(AUTH_DIR, ".env");
const AKASHA_ENV = resolve(AUTH_DIR, "../../akasha/api/.env");
const secret = () => randomBytes(32).toString("base64url");
// Logout token dikirim server SSO langsung ke backend Akasha (bukan lewat browser)
const BACKCHANNEL = "http://localhost:4000/api/v1/auth/sso/backchannel-logout";
const LANDING_URL = "http://workingspace.localhost:5176";
const OLD_HOST = "http://auth.localhost:5175";
const NEW_HOST = "http://auth.workingspace.localhost:5175";

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
      backchannel_logout_uri: BACKCHANNEL,
    },
  ];
  return `NODE_ENV=development
PORT=4300
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workingspace_auth?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/workingspace_auth_shadow?schema=public"
# Alamat publik halaman SSO (dev: Vite auth web 5175 meneruskan /api, /oidc, /interaction ke port 4300)
PUBLIC_URL="http://auth.workingspace.localhost:5175"
# Kunci privat penanda tangan token (dibuat acak oleh scripts/setup-dev-env.mjs)
OIDC_JWKS='${JSON.stringify({ keys: [jwk] })}'
OIDC_COOKIE_KEYS="${secret()},${secret()}"
# Klien OIDC per aplikasi (client_id = kunci aplikasi). Secret Akasha sama dengan SSO_CLIENT_SECRET di apps/akasha/api/.env
OIDC_CLIENTS='${JSON.stringify(clients)}'
# Halaman depan yang boleh membaca status masuk (GET /api/auth/status, CORS + cookie). Pisahkan dengan koma
LANDING_URL="${LANDING_URL}"
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

// Naikkan .env lama: host baru, back-channel logout klien akasha, LANDING_URL
let authEnv = readFileSync(AUTH_ENV, "utf8");
const upgraded = authEnv.replaceAll(OLD_HOST, NEW_HOST).replace(/^OIDC_CLIENTS='(.*)'$/m, (_line, json) => {
  const list = JSON.parse(json).map((c) =>
    c.client_id === "akasha" && !c.backchannel_logout_uri ? { ...c, backchannel_logout_uri: BACKCHANNEL } : c,
  );
  return `OIDC_CLIENTS='${JSON.stringify(list)}'`;
});
const withLanding = /^LANDING_URL=/m.test(upgraded)
  ? upgraded
  : `${upgraded.replace(/\s*$/, "\n")}# Halaman depan yang boleh membaca status masuk (GET /api/auth/status)\nLANDING_URL="${LANDING_URL}"\n`;
if (withLanding !== authEnv) {
  writeFileSync(AUTH_ENV, withLanding);
  authEnv = withLanding;
  console.log("apps/auth/api/.env dinaikkan (host baru / back-channel logout / LANDING_URL). Restart SSO API.");
}
// Klien Akai web (tahap 6a.3, docs/AKAI.md): ditambahkan bila belum ada, secret disalin ke apps/akai/api/.env
const AKAI_ENV = resolve(AUTH_DIR, "../../akai/api/.env");
const AKAI_WEB = "http://akai.workingspace.localhost:5177";
const withAkai = authEnv.replace(/^OIDC_CLIENTS='(.*)'$/m, (line, json) => {
  const list = JSON.parse(json);
  if (list.some((c) => c.client_id === "akai")) return line;
  list.push({
    client_id: "akai",
    client_secret: secret(),
    redirect_uris: [`${AKAI_WEB}/api/auth/sso/callback`],
    post_logout_redirect_uris: [`${AKAI_WEB}/login`],
    backchannel_logout_uri: "http://localhost:4400/api/auth/sso/backchannel-logout",
  });
  return `OIDC_CLIENTS='${JSON.stringify(list)}'`;
});
if (withAkai !== authEnv) {
  writeFileSync(AUTH_ENV, withAkai);
  authEnv = withAkai;
  console.log("Klien OIDC 'akai' ditambahkan ke apps/auth/api/.env (restart SSO API).");
}

const clientsLine = authEnv.match(/^OIDC_CLIENTS='(.*)'$/m);
const akashaClient = clientsLine && JSON.parse(clientsLine[1]).find((c) => c.client_id === "akasha");
const akaiClient = clientsLine && JSON.parse(clientsLine[1]).find((c) => c.client_id === "akai");
if (akaiClient && existsSync(AKAI_ENV)) {
  let akaiEnv = readFileSync(AKAI_ENV, "utf8");
  if (/^SSO_CLIENT_SECRET=\S/m.test(akaiEnv)) console.log("SSO_* di apps/akai/api/.env sudah terisi — tidak diubah.");
  else {
    const values = {
      SSO_ISSUER: '"http://auth.workingspace.localhost:5175/oidc"',
      SSO_CLIENT_ID: "akai",
      SSO_CLIENT_SECRET: `"${akaiClient.client_secret}"`,
      SSO_REDIRECT_URI: `"${akaiClient.redirect_uris[0]}"`,
      SSO_POST_LOGOUT_URI: `"${akaiClient.post_logout_redirect_uris[0]}"`,
    };
    for (const [key, value] of Object.entries(values)) {
      const line = `${key}=${value}`;
      const pattern = new RegExp(`^${key}=.*$`, "m");
      akaiEnv = pattern.test(akaiEnv)
        ? akaiEnv.replace(pattern, () => line)
        : `${akaiEnv.replace(/\s*$/, "\n")}${line}\n`;
    }
    writeFileSync(AKAI_ENV, akaiEnv);
    console.log("SSO_* di apps/akai/api/.env diisi (restart Akai API agar terbaca).");
  }
} else if (akaiClient)
  console.log("apps/akai/api/.env belum ada — jalankan dulu: npm run setup:dev -w @akai/api, lalu ulangi.");
if (!akashaClient) {
  console.error("Klien 'akasha' tidak ada di OIDC_CLIENTS apps/auth/api/.env — periksa berkasnya.");
  process.exit(1);
}

if (!existsSync(AKASHA_ENV)) {
  console.error("apps/akasha/api/.env belum ada. Salin dulu dari .env.example (docs/SETUP.md §3 langkah 4).");
  process.exit(1);
}
let akashaEnv = readFileSync(AKASHA_ENV, "utf8");
if (akashaEnv.includes(OLD_HOST)) {
  akashaEnv = akashaEnv.replaceAll(OLD_HOST, NEW_HOST);
  writeFileSync(AKASHA_ENV, akashaEnv);
  console.log("SSO_ISSUER di apps/akasha/api/.env dipindah ke host baru (restart backend Akasha).");
}
if (/^SSO_ISSUER=\S/m.test(akashaEnv) && /^SSO_CLIENT_SECRET=\S/m.test(akashaEnv)) {
  console.log("SSO_* di apps/akasha/api/.env sudah terisi — tidak diubah.");
} else {
  const values = {
    SSO_ISSUER: '"http://auth.workingspace.localhost:5175/oidc"',
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
