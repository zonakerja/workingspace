// Buat rahasia PRODUKSI SSO workingspace.id & Akai (docs/DEPLOYMENT.md §16). Hasil ditulis ke layar untuk ditempel ke
// `.env` di VPS (root repo) — tidak menulis berkas apa pun. Jalankan sekali:
//   node apps/auth/api/scripts/generate-prod-secrets.mjs
// Menjalankan ulang lalu mengganti nilai di .env = semua token/sesi lama tidak berlaku (semua orang masuk ulang).
import { generateKeyPairSync, randomBytes } from "node:crypto";

const secret = () => randomBytes(32).toString("base64url");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const jwk = {
  ...privateKey.export({ format: "jwk" }),
  kid: `prod-${stamp}-${randomBytes(3).toString("hex")}`,
  use: "sig",
  alg: "RS256",
};

console.log("# --- tempel ke .env (SSO workingspace.id) ---");
console.log(`OIDC_JWKS='${JSON.stringify({ keys: [jwk] })}'`);
console.log(`OIDC_COOKIE_KEYS=${secret()},${secret()}`);
console.log(`SSO_AKASHA_CLIENT_SECRET=${secret()}`);
console.log(`SSO_AKAI_CLIENT_SECRET=${secret()}`);
console.log("# --- Akai (gateway model, docs/AKAI.md) ---");
// Mengganti AKAI_ENCRYPTION_KEY = API key sumber model yang tersimpan di Akai tidak terbaca lagi (pemilik memasukkan ulang)
console.log(`AKAI_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
console.log(`AKAI_AKASHA_CLIENT_SECRET=${secret()}`);
