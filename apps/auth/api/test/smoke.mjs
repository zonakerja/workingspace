// Smoke test layanan SSO (jalankan saat API menyala): node test/smoke.mjs
// Env: AUTH_URL (bawaan http://localhost:4300), AUTH_ENV (bawaan .env di folder ini; dibaca untuk secret klien Akasha &
// PUBLIC_URL), MAIL_DIR (bawaan .mail). Membuat akun sementara smoke-*@example.test lalu menghapusnya lewat database.
import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const HERE = resolve(import.meta.dirname, "..");
const BASE = (process.env.AUTH_URL ?? "http://localhost:4300").replace(/\/+$/, "");
const env = Object.fromEntries(
  readFileSync(process.env.AUTH_ENV ?? join(HERE, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^(['"])(.*)\1$/, "$2")];
    }),
);
let redirectUriGlobal = "";
const PUBLIC = env.PUBLIC_URL.replace(/\/+$/, "");
const MAIL_DIR = resolve(HERE, process.env.MAIL_DIR ?? env.MAIL_DIR ?? ".mail");
const client = JSON.parse(env.OIDC_CLIENTS).find((c) => c.client_id === "akasha");

let failed = 0;
const ok = (name, cond, info) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`, info === undefined ? "" : JSON.stringify(info).slice(0, 600));
  }
};

/** Browser kecil: menyimpan cookie (tanpa memperhatikan path), alamat publik diarahkan ke BASE. */
class Browser {
  /** Ikuti 303 di dalam SSO (resume, persetujuan otomatis) sampai keluar ke aplikasi. */
  async follow(url) {
    let r = await this.get(url);
    for (
      let i = 0;
      i < 6 &&
      r.s === 303 &&
      r.location &&
      !r.location.startsWith(redirectUriGlobal) &&
      !r.location.startsWith("/login");
      i++
    )
      r = await this.get(r.location);
    return r;
  }
  jar = new Map();
  local = (url) => (url.startsWith(PUBLIC) ? BASE + url.slice(PUBLIC.length) : url.startsWith("/") ? BASE + url : url);
  async req(method, url, body) {
    const res = await fetch(this.local(url), {
      method,
      redirect: "manual",
      headers: {
        ...(body !== undefined
          ? { "Content-Type": typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json" }
          : {}),
        Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { s: res.status, d: data, location: res.headers.get("location") };
  }
  /** Masuk; bila kena batas 10/menit (429) tunggu lalu coba lagi (maks. ± 70 dtk). */
  async login(email, password) {
    for (let i = 0; i < 15; i++) {
      const r = await this.post("/api/auth/login", { email, password });
      if (r.s !== 429) return r;
      await new Promise((res) => setTimeout(res, 5000));
    }
    return { s: 429 };
  }
  get = (url) => this.req("GET", url);
  post = (url, body = {}) => this.req("POST", url, body);
}

const latestMailNow = (to, after) => {
  const files = readdirSync(MAIL_DIR)
    .filter((f) => f.includes(to.replace(/[^a-z0-9@.]/gi, "_")))
    .sort();
  const file = files.at(-1);
  if (!file || file <= after) return null;
  return readFileSync(join(MAIL_DIR, file), "utf8");
};
const latestMail = async (to, after) => {
  for (let i = 0; i < 30; i++) {
    const mail = latestMailNow(to, after);
    if (mail) return mail;
    await sleep(100);
  }
  return null;
};
const tokenFrom = (mail) => mail?.match(/token=([A-Za-z0-9_-]+)/)?.[1];
const mailMark = () => new Date(Date.now() - 1).toISOString().replace(/[:.]/g, "-");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function verifyJwt(jwt, jwks) {
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url"));
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  const valid = createVerify("RSA-SHA256")
    .update(`${h}.${p}`)
    .verify(createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
  return { valid, header, claims: JSON.parse(Buffer.from(p, "base64url")) };
}

const stamp = Date.now();
const email = `smoke-${stamp}@example.test`;
const unverified = `smoke-${stamp}-b@example.test`;
const password = "Ruang-Kerja-Smoke-1";

// ---------------------------------------------------------------- dasar
let r = await fetch(`${BASE}/api/health`).then((x) => x.json());
ok("health", r.status === "ok", r);
const disc = await new Browser().get("/oidc/.well-known/openid-configuration");
ok(
  "discovery issuer",
  disc.d.issuer === `${PUBLIC}/oidc` && disc.d.code_challenge_methods_supported.includes("S256"),
  disc.d,
);
const jwks = (await new Browser().get("/oidc/jwks")).d;
ok("jwks public only", jwks.keys.length > 0 && jwks.keys.every((k) => !k.d), jwks);

// ---------------------------------------------------------------- daftar & verifikasi
const PROFILE = { phone: "0812 3456 7890", occupation: "Analis", workplace: "Kantor Uji Smoke" };
const a = new Browser();
r = await a.post("/api/auth/register", { name: "Smoke", email, password: "123", ...PROFILE });
ok("register weak password 400", r.s === 400, r);
let mark = mailMark();
r = await a.post("/api/auth/register", { name: "Smoke", email, password });
ok("register without profile 400", r.s === 400, r);
r = await a.post("/api/auth/register", { name: "Smoke", email, password, ...PROFILE, phone: "12" });
ok("register invalid phone 400", r.s === 400, r);
r = await a.post("/api/auth/register", { name: "Smoke", email, password, ...PROFILE });
ok("register 202", r.s === 202, r);
await sleep(200);
const verifyMail = await latestMail(email, mark);
ok("verification mail written", !!tokenFrom(verifyMail), verifyMail);
r = await a.post("/api/auth/login", { email, password });
ok("login before verify 403", r.s === 403 && r.d.code === "EMAIL_UNVERIFIED", r);
r = await a.post("/api/auth/verify", { token: tokenFrom(verifyMail) });
ok("verify → signed in", r.s === 200 && r.d.email === email && r.d.emailVerified && a.jar.has("ws_sid"), r);
r = await a.post("/api/auth/verify", { token: tokenFrom(verifyMail) });
ok("verify token single use", r.s === 400, r);
r = await a.get("/api/auth/me");
ok(
  "me (profile from registration)",
  r.s === 200 && r.d.apps.length === 0 && !r.d.superAdmin && r.d.phone === "+6281234567890" && r.d.workplace === "Kantor Uji Smoke",
  r,
);
const memberId = r.d.id;
mark = mailMark();
r = await new Browser().post("/api/auth/register", { name: "Lain", email, password, ...PROFILE });
ok("register existing email = same generic answer", r.s === 202, r);
await sleep(200);
ok("register existing verified email sends nothing", latestMailNow(email, mark) === null);
r = await new Browser().post("/api/auth/register", {
  name: "Belum",
  email: unverified,
  password,
  ...PROFILE,
  requests: [{ appKey: "akai", purpose: "Mencoba asisten AI untuk menyusun konsep surat dinas." }],
});
ok("register second account", r.s === 202, r);

// ---------------------------------------------------------------- masuk, keluar, lupa kata sandi
const b = new Browser();
r = await b.post("/api/auth/login", { email, password: "salah-sekali-123" });
ok("login wrong password 401", r.s === 401, r);
r = await b.post("/api/auth/login", { email: "tidak-ada@example.test", password });
ok("login unknown email same 401", r.s === 401 && r.d.message === "Email atau kata sandi salah.", r);
r = await b.post("/api/auth/login", { email: email.toUpperCase(), password });
ok("login (email case-insensitive)", r.s === 200 && b.jar.has("ws_sid"), r);
r = await b.post("/api/auth/logout");
ok("logout", r.s === 204 && !b.jar.has("ws_sid"), r);
r = await b.get("/api/auth/me");
ok("me after logout 401", r.s === 401, r);
mark = mailMark();
r = await b.post("/api/auth/forgot-password", { email: "tidak-ada@example.test" });
ok("forgot unknown email = generic 202", r.s === 202, r);
r = await b.post("/api/auth/forgot-password", { email });
ok("forgot 202", r.s === 202, r);
await sleep(200);
const resetToken = tokenFrom(await latestMail(email, mark));
ok("reset mail written", !!resetToken);
r = await b.post("/api/auth/reset-password", { token: resetToken, password: "password" });
ok("reset weak password 400", r.s === 400, r);
r = await b.post("/api/auth/reset-password", { token: resetToken, password: `${password}-baru` });
ok("reset used token after failed attempt 400 (single use)", r.s === 400, r);
mark = mailMark();
await b.post("/api/auth/forgot-password", { email });
await sleep(200);
r = await b.post("/api/auth/reset-password", {
  token: tokenFrom(await latestMail(email, mark)),
  password: `${password}-baru`,
});
ok("reset password", r.s === 204, r);
r = await a.get("/api/auth/me");
ok("reset signs out other sessions", r.s === 401, r);
r = await b.post("/api/auth/login", { email, password });
ok("old password rejected", r.s === 401, r);
r = await b.post("/api/auth/login", { email, password: `${password}-baru` });
ok("new password works", r.s === 200, r);

// ---------------------------------------------------------------- OIDC: kode otorisasi + PKCE
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const redirectUri = client.redirect_uris[0];
redirectUriGlobal = redirectUri;
const authorize = (extra = {}) =>
  `/oidc/auth?${new URLSearchParams({
    client_id: "akasha",
    response_type: "code",
    scope: "openid email profile apps offline_access",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
    nonce: "no-1",
    prompt: "consent",
    ...extra,
  })}`;
const basic = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`;
const token = (body) =>
  fetch(`${BASE}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic },
    body: new URLSearchParams(body),
  }).then(async (x) => ({ s: x.status, d: await x.json() }));

r = await new Browser().get(authorize({ code_challenge_method: "plain", code_challenge: verifier }));
ok("authorize rejects plain PKCE", r.s >= 300 && /error=/.test(r.location ?? ""), r.location);
r = await new Browser().get(authorize({ redirect_uri: "https://evil.example/cb" }));
ok("authorize rejects unknown redirect_uri", r.s === 400, r.s);

// Akun tanpa akses Akasha → ditolak di halaman masuk
const c = new Browser();
r = await c.get(authorize());
const interaction = r.location;
ok("authorize → interaction", r.s === 303 && /\/interaction\/[\w-]+$/.test(interaction ?? ""), r);
const uid = interaction.split("/").pop();
r = await c.get(interaction);
ok("interaction without session → login page", r.s === 303 && r.location === `/login?uid=${uid}`, r);
r = await c.get(`/interaction/${uid}/details`);
ok("interaction details", r.s === 200 && r.d.app.name === "Akasha" && r.d.account === null, r);
r = await c.post(`/interaction/${uid}/login`, { email, password: `${password}-baru` });
ok("account without app access 403", r.s === 403 && r.d.code === "APP_FORBIDDEN", r);
r = await c.post(`/interaction/${uid}/login`, { email: unverified, password });
ok("unverified account 403", r.s === 403 && r.d.code === "EMAIL_UNVERIFIED", r);

// Super admin (seed dev) → kode → token
r = await c.post(`/interaction/${uid}/login`, { email: "noreply@workingspace.id", password: "123" });
ok("interaction login", r.s === 200 && typeof r.d.redirectTo === "string", r);
r = await c.follow(r.d.redirectTo);
ok("resume → redirect to app with code", r.s === 303 && (r.location ?? "").startsWith(redirectUri), r);
let cb = new URL(r.location);
ok(
  "callback carries state & iss",
  cb.searchParams.get("state") === "st-1" && cb.searchParams.get("iss") === `${PUBLIC}/oidc`,
  cb.search,
);
r = await token({
  grant_type: "authorization_code",
  code: cb.searchParams.get("code"),
  redirect_uri: redirectUri,
  code_verifier: "salah".repeat(10),
});
ok("token wrong code_verifier 400", r.s === 400, r);

r = await c.get(authorize());
r = await c.get(r.location);
ok(
  "second authorize with SSO session → straight back (no login)",
  r.s === 303 && /\/oidc\/auth\//.test(r.location ?? ""),
  r,
);
r = await c.get(r.location);
cb = new URL(r.location);
r = await token({
  grant_type: "authorization_code",
  code: cb.searchParams.get("code"),
  redirect_uri: redirectUri,
  code_verifier: verifier,
});
ok("token exchange", r.s === 200 && r.d.id_token && r.d.access_token && r.d.refresh_token, r);
const id = verifyJwt(r.d.id_token, jwks);
ok("id_token signature valid", id.valid && id.header.alg === "RS256", id.header);
ok(
  "id_token claims",
  id.claims.iss === `${PUBLIC}/oidc` &&
    id.claims.aud === "akasha" &&
    id.claims.nonce === "no-1" &&
    id.claims.email === "noreply@workingspace.id" &&
    id.claims.apps?.akasha === "admin" &&
    id.claims.super_admin === true,
  id.claims,
);
const idToken = r.d.id_token;
const refresh = r.d.refresh_token;
r = await token({ grant_type: "refresh_token", refresh_token: refresh });
ok("refresh token grant", r.s === 200 && r.d.access_token && r.d.id_token, r);
const rotated = r.d.refresh_token;
r = await token({
  grant_type: "authorization_code",
  code: cb.searchParams.get("code"),
  redirect_uri: redirectUri,
  code_verifier: verifier,
});
ok("authorization code single use", r.s === 400, r);
r = await token({ grant_type: "refresh_token", refresh_token: rotated ?? refresh });
ok("code replay revokes the grant (refresh rejected)", r.s === 400, r);
r = await fetch(`${BASE}/oidc/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from("akasha:salah").toString("base64")}`,
  },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
}).then((x) => x.status);
ok("token with wrong client secret 401", r === 401, r);

// prompt=login memaksa masuk ulang walau sesi ada
r = await c.get(authorize({ prompt: "login" }));
r = await c.get(r.location);
ok("prompt=login forces login page", r.s === 303 && r.location?.startsWith("/login?uid="), r);

// Keluar dari halaman SSO → aplikasi berikutnya meminta masuk lagi
r = await c.post("/api/auth/logout");
r = await c.get(authorize());
r = await c.get(r.location);
ok("after SSO logout → login required again", r.s === 303 && r.location?.startsWith("/login?uid="), r);

// Keluar dari aplikasi (RP-initiated logout) → sesi SSO ikut berakhir
const d = new Browser();
r = await d.get(authorize());
const uid2 = r.location.split("/").pop();
r = await d.post(`/interaction/${uid2}/login`, { email: "noreply@workingspace.id", password: "123" });
r = await d.follow(r.d.redirectTo);
cb = new URL(r.location);
r = await token({
  grant_type: "authorization_code",
  code: cb.searchParams.get("code"),
  redirect_uri: redirectUri,
  code_verifier: verifier,
});
const logoutUri = client.post_logout_redirect_uris[0];
r = await d.get(
  `/oidc/session/end?${new URLSearchParams({ id_token_hint: r.d.id_token, post_logout_redirect_uri: logoutUri })}`,
);
const xsrf = String(r.d).match(/name="xsrf" value="([^"]+)"/)?.[1];
ok(
  "end_session from registered app auto-submits (no confirmation)",
  r.s === 200 && !!xsrf && String(r.d).includes('getElementById("op.logoutForm").submit()'),
  String(r.d).slice(0, 200),
);
r = await d.req("POST", "/oidc/session/end/confirm", new URLSearchParams({ xsrf, logout: "yes" }).toString());
ok("end_session → back to app", r.s === 303 && r.location === logoutUri, r);
ok("end_session clears ws_sid", !d.jar.has("ws_sid"), [...d.jar.keys()]);
r = await d.get("/api/auth/me");
ok("me after app logout 401", r.s === 401, r);
ok("old id_token kept for test", !!idToken);

// ---------------------------------------------------------------- admin (super admin ekosistem)
const adm = new Browser();
r = await adm.login("noreply@workingspace.id", "123");
ok("admin login", r.s === 200 && r.d.superAdmin, r);
const plain = new Browser();
await plain.login("user@workingspace.id", "123");
r = await plain.get("/api/admin/accounts");
ok("admin api forbidden for member 403", r.s === 403, r);
r = await new Browser().get("/api/admin/accounts");
ok("admin api without session 401", r.s === 401, r);
r = await adm.get("/api/admin/accounts?q=smoke-" + stamp);
ok(
  "admin search accounts",
  r.s === 200 && r.d.total >= 1 && r.d.items.every((a) => a.email.includes(String(stamp))),
  r.d,
);
const adminSelf = (await adm.get("/api/auth/me")).d;
r = await adm.req("PATCH", "/api/auth/me", {
  phone: "0812-3456-7890",
  occupation: "  Analis  BMN ",
  workplace: "Uji Smoke",
  address: "Jl. Uji No. 1",
});
ok(
  "profile saved & phone normalized",
  r.s === 200 && r.d.phone === "+6281234567890" && r.d.occupation === "Analis BMN" && r.d.name === adminSelf.name,
  r.d,
);
r = await adm.req("PATCH", "/api/auth/me", { phone: "abc" });
ok("profile invalid phone 400", r.s === 400, r);
r = await adm.get("/api/admin/accounts?q=noreply%40workingspace.id");
ok("admin list shows profile", r.d.items?.[0]?.workplace === "Uji Smoke", r.d);
r = await adm.req("PATCH", "/api/auth/me", { phone: "", occupation: "", workplace: "", address: "" });
ok("profile cleared", r.s === 200 && r.d.phone === null && r.d.address === null, r.d);
r = await adm.get("/api/admin/stats");
ok(
  "admin stats",
  r.s === 200 &&
    r.d.total >= 2 &&
    r.d.superAdmins >= 1 &&
    ["active30d", "unverified", "disabled"].every((k) => k in r.d),
  r.d,
);
r = await plain.get("/api/admin/stats");
ok("admin stats forbidden for member 403", r.s === 403, r);
r = await adm.get("/api/admin/accounts?status=super");
ok("admin filter super", r.s === 200 && r.d.items.length >= 1 && r.d.items.every((a) => a.superAdmin), r.d);
r = await adm.get("/api/admin/accounts?status=unverified");
ok("admin filter unverified", r.s === 200 && r.d.items.every((a) => !a.emailVerified && !a.disabled), r.d);
r = await adm.get("/api/admin/accounts?status=salah");
ok("admin filter invalid 400", r.s === 400, r);

const invited = `smoke-${stamp}-c@example.test`;
mark = mailMark();
r = await adm.post("/api/admin/accounts", { name: "Undangan", email: invited, apps: { akasha: "member" } });
ok("admin create (invite)", r.s === 201 && r.d.invited === true, r);
const invitedId = r.d.id;
const inviteMail = await latestMail(invited, mark);
ok("invite mail written", /Undangan akun Workingspace/.test(inviteMail ?? "") && !!tokenFrom(inviteMail), inviteMail);
r = await adm.post("/api/admin/accounts", { name: "Ganda", email: invited.toUpperCase() });
ok("admin create duplicate email 400", r.s === 400, r);
r = await adm.post("/api/admin/accounts", { name: "Lemah", email: `smoke-${stamp}-d@example.test`, password: "123" });
ok("admin create weak password 400", r.s === 400, r);
r = await adm.post("/api/admin/accounts", {
  name: "Salah",
  email: `smoke-${stamp}-e@example.test`,
  apps: { tidakada: "member" },
});
ok("admin create unknown app 404", r.s === 404, r);
const inv = new Browser();
r = await inv.post("/api/auth/reset-password", { token: tokenFrom(inviteMail), password: "Undangan-Akasha-2026" });
ok("invite sets password", r.s === 204, r);
r = await inv.post("/api/auth/login", { email: invited, password: "Undangan-Akasha-2026" });
ok(
  "invited account can sign in (verified by invite)",
  r.s === 200 && r.d.apps.some((a) => a.key === "akasha" && a.role === "member"),
  r,
);

r = await adm.req("PUT", `/api/admin/accounts/${invitedId}/apps/akasha`, { role: "admin" });
ok("admin set app role", r.s === 200, r);
r = await adm.req("PUT", `/api/admin/accounts/${invitedId}/apps/akasha`, { role: "owner" });
ok("admin invalid role 400", r.s === 400, r);
r = await inv.get("/api/auth/me");
ok("role visible to account", r.d.apps.find((a) => a.key === "akasha")?.role === "admin", r.d);
r = await adm.req("DELETE", `/api/admin/accounts/${invitedId}/apps/akasha`);
ok("admin revoke app access", r.s === 204, r);
r = await inv.get("/api/auth/me");
ok("revoked app gone", r.d.apps.length === 0, r.d);

r = await adm.req("PATCH", `/api/admin/accounts/${adminSelf.id}`, { disabled: true });
ok("admin cannot disable self", r.s === 400, r);
r = await adm.req("PATCH", `/api/admin/accounts/${adminSelf.id}`, { superAdmin: false });
ok("admin cannot drop own super admin", r.s === 400, r);
r = await adm.req("PATCH", `/api/admin/accounts/${invitedId}`, { disabled: true });
ok("admin disable account", r.s === 200, r);
r = await inv.get("/api/auth/me");
ok("disabled account signed out", r.s === 401, r);
r = await inv.post("/api/auth/login", { email: invited, password: "Undangan-Akasha-2026" });
ok("disabled account cannot sign in 403", r.s === 403, r);
r = await adm.post(`/api/admin/accounts/${invitedId}/password-link`);
ok("password link refused for disabled", r.s === 400, r);
r = await adm.req("PATCH", `/api/admin/accounts/${invitedId}`, { disabled: false, name: "Undangan Aktif" });
ok("admin re-enable + rename", r.s === 200, r);
mark = mailMark();
r = await adm.post(`/api/admin/accounts/${invitedId}/password-link`);
ok("admin sends reset link", r.s === 202 && /Atur ulang kata sandi/.test((await latestMail(invited, mark)) ?? ""), r);
r = await adm.get(`/api/admin/accounts/${invitedId}/events`);
ok(
  "account security events",
  r.s === 200 && r.d.some((e) => e.event === "admin_created") && r.d.some((e) => e.event === "login"),
  r.d?.map?.((e) => e.event),
);
r = await adm.get("/api/admin/apps");
ok("admin apps list", r.s === 200 && r.d.some((a) => a.key === "akasha" && a.members >= 1), r.d);
r = await adm.req("PATCH", "/api/admin/apps/akasha", { selfSignup: "member" });
ok("admin app self signup on", r.s === 200 && r.d.selfSignup === "member", r);
const selfSigned = `smoke-${stamp}-f@example.test`;
await new Browser().post("/api/auth/register", { name: "Mandiri", email: selfSigned, password, ...PROFILE });
r = await adm.get("/api/admin/accounts?q=" + encodeURIComponent(selfSigned));
ok("self signup gets app role", r.d.items[0]?.apps?.akasha === "member", r.d);
r = await adm.req("PATCH", "/api/admin/apps/akasha", { selfSignup: null });
ok("admin app self signup off", r.s === 200 && r.d.selfSignup === null, r);
r = await adm.req("PATCH", "/api/admin/apps/akasha", { url: "javascript:alert(1)" });
ok("admin app url must be http(s) 400", r.s === 400, r);

// ---------------------------------------------------------------- PIN keamanan (bersama semua aplikasi)
// Akun undangan dari bagian admin: punya kata sandi, akses Akasha dicabut → beri lagi agar bisa diverifikasi aplikasi
await adm.req("PUT", `/api/admin/accounts/${invitedId}/apps/akasha`, { role: "member" });
const pinUser = new Browser();
r = await pinUser.login(invited, "Undangan-Akasha-2026");
ok("pin user login", r.s === 200, r);
const pinVerify = (body, auth = basic) =>
  fetch(`${BASE}/api/pin/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  }).then(async (x) => ({ s: x.status, d: await x.json().catch(() => null) }));
r = await pinUser.get("/api/pin");
ok("pin status none", r.s === 200 && r.d.hasPin === false, r);
r = await pinVerify({ sub: invitedId, pin: "482915" });
ok("verify without pin 409 PIN_NOT_SET", r.s === 409 && r.d.code === "PIN_NOT_SET", r);
r = await pinUser.req("PUT", "/api/pin", { pin: "123456", password: "Undangan-Akasha-2026" });
ok("weak pin 400", r.s === 400, r);
r = await pinUser.req("PUT", "/api/pin", { pin: "482915", password: "salah" });
ok("set pin wrong password 400", r.s === 400, r);
r = await pinUser.req("PUT", "/api/pin", { pin: "482915", password: "Undangan-Akasha-2026" });
ok("set pin", r.s === 200 && r.d.hasPin === true, r);
r = await pinVerify({ sub: invitedId, pin: "482915" }, `Basic ${Buffer.from("akasha:salah").toString("base64")}`);
ok("verify with wrong client secret 401", r.s === 401, r);
r = await pinUser.req("POST", "/api/pin/verify", { sub: invitedId, pin: "482915" });
ok("verify from browser session (no client auth) 401", r.s === 401, r);
r = await pinVerify({ sub: invitedId, pin: "482915" });
ok("verify correct pin", r.s === 200 && r.d.valid === true, r);
for (let i = 1; i <= 4; i++) r = await pinVerify({ sub: invitedId, pin: "000001" });
ok("wrong pin counts down", r.s === 400 && r.d.code === "PIN_WRONG" && /Sisa 1/.test(r.d.message), r);
r = await pinVerify({ sub: invitedId, pin: "000001" });
ok("5th wrong pin blocks", r.s === 400 && /Dikunci 15 menit/.test(r.d.message), r);
r = await pinVerify({ sub: invitedId, pin: "482915" });
ok("blocked even with correct pin 429", r.s === 429 && r.d.code === "PIN_BLOCKED", r);
r = await fetch(`${BASE}/api/pin/status?sub=${invitedId}`, { headers: { Authorization: basic } }).then((x) => x.json());
ok("app pin status shows block", r.hasPin === true && !!r.blockedUntil, r);
r = await pinUser.req("PUT", "/api/pin", { pin: "591736", password: "Undangan-Akasha-2026" });
ok("reset pin with password clears block", r.s === 200 && r.d.blockedUntil === null, r);
r = await pinVerify({ sub: invitedId, pin: "591736" });
ok("new pin works", r.s === 200, r);
await adm.req("DELETE", `/api/admin/accounts/${invitedId}/apps/akasha`);
r = await pinVerify({ sub: invitedId, pin: "591736" });
ok("verify for account without app access 403", r.s === 403, r);
r = await pinUser.req("DELETE", "/api/pin", { password: "Undangan-Akasha-2026" });
ok("remove pin", r.s === 200 && r.d.hasPin === false, r);
r = await new Browser().get("/api/pin");
ok("pin status without session 401", r.s === 401, r);

// ---------------------------------------------------------------- pengajuan akses & masa akses
const m = new Browser();
r = await m.login(email, `${password}-baru`);
ok("member login for access tests", r.s === 200, r);
r = await new Browser().get("/api/access/apps");
ok("access catalog public", r.s === 200 && r.d.some((x) => x.key === "akasha"), r);
r = await m.req("POST", "/api/access/requests", { requests: [{ appKey: "akasha", purpose: "pendek" }] });
ok("request purpose too short 400", r.s === 400, r);
r = await new Browser().req("POST", "/api/access/requests", {
  requests: [{ appKey: "akasha", purpose: "Mengelola agenda dan arsip unit kerja." }],
});
ok("request without session 401", r.s === 401, r);
r = await m.req("POST", "/api/access/requests", {
  requests: [{ appKey: "akasha", purpose: "Mengelola agenda, arsip, dan laporan kinerja unit kerja." }],
});
const akashaRow = r.d?.apps?.find((x) => x.key === "akasha");
ok("request access → pending", r.s === 201 && !!akashaRow?.pendingRequestId && !akashaRow.canRequest, r.d);
r = await m.req("POST", "/api/access/requests", {
  requests: [{ appKey: "akasha", purpose: "Mengelola agenda, arsip, dan laporan kinerja unit kerja." }],
});
ok("duplicate pending request 400", r.s === 400, r);
r = await m.get("/api/admin/access-requests");
ok("member cannot list requests 403", r.s === 403, r);
r = await adm.get("/api/admin/access-requests");
const pendingRow = r.d?.find?.((x) => x.account.id === memberId && x.appKey === "akasha");
const unverifiedRow = r.d?.find?.((x) => x.account.email === unverified && x.appKey === "akai");
ok("admin sees pending request with purpose", r.s === 200 && /agenda, arsip/.test(pendingRow?.purpose ?? ""), r.d);
ok("request from registration listed (unverified)", unverifiedRow && !unverifiedRow.account.emailVerified, r.d);
r = await adm.req("POST", `/api/admin/access-requests/${unverifiedRow?.id}/approve`, { role: "member", days: 30 });
ok("approve unverified account 400", r.s === 400, r);
r = await adm.get("/api/admin/stats");
ok("stats pending requests", r.s === 200 && r.d.pendingRequests >= 2, r.d);
r = await adm.req("POST", `/api/admin/access-requests/${pendingRow?.id}/approve`, { role: "member", days: 45 });
ok("approve invalid duration 400", r.s === 400, r);
r = await adm.req("POST", `/api/admin/access-requests/${pendingRow?.id}/approve`, { role: "member", days: 90 });
const expires = r.d?.expiresAt ? new Date(r.d.expiresAt) : null;
ok(
  "approve 90 days",
  (r.s === 200 || r.s === 201) && expires && Math.abs(expires - Date.now() - 90 * 864e5) < 60_000,
  r,
);
r = await adm.req("POST", `/api/admin/access-requests/${pendingRow?.id}/approve`, { role: "member", days: 30 });
ok("approve twice 400", r.s === 400, r);
const clientAccount = () =>
  fetch(`${BASE}/api/client/account?sub=${memberId}`, { headers: { Authorization: basic } }).then((x) => x.json());
r = await clientAccount();
ok("client api: active with expiry", r.active === true && r.access?.state === "active" && !!r.access.expiresAt, r);
r = await m.req("POST", "/api/access/requests", {
  requests: [{ appKey: "akasha", purpose: "Perpanjangan untuk melanjutkan pekerjaan arsip." }],
});
ok("renewal too early 400", r.s === 400 && /30 hari/.test(r.d?.message ?? ""), r);
const accessDb = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?.*$/, "") });
await accessDb.connect();
await accessDb.query(
  "UPDATE app_memberships SET expires_at = now() - interval '1 day' WHERE account_id = $1 AND app_key = 'akasha'",
  [memberId],
);
r = await clientAccount();
ok("expired → read_only, still active (read)", r.active === true && r.access?.state === "read_only" && !!r.access.deleteAt, r);
r = await m.get("/api/access");
ok(
  "account sees read-only + can renew",
  r.d?.apps?.find((x) => x.key === "akasha")?.access?.state === "read_only" &&
    r.d.apps.find((x) => x.key === "akasha").canRequest,
  r.d,
);
await accessDb.query(
  "UPDATE app_memberships SET expires_at = now() - interval '181 days' WHERE account_id = $1 AND app_key = 'akasha'",
  [memberId],
);
r = await clientAccount();
ok("after 180 days → ended, inactive", r.active === false && r.access?.state === "ended", r);
r = await m.req("POST", "/api/access/requests", {
  requests: [{ appKey: "akasha", purpose: "Perpanjangan untuk melanjutkan pekerjaan arsip." }],
});
const renewal = r.d?.apps?.find((x) => x.key === "akasha")?.pendingRequestId;
ok("renewal after expiry allowed", r.s === 201 && !!renewal, r.d);
r = await adm.req("POST", `/api/admin/access-requests/${renewal}/approve`, { role: "admin", days: null });
r = await clientAccount();
ok("renewal unlimited → active again", r.active === true && r.access?.state === "active" && r.access.expiresAt === null && r.role === "admin", r);
r = await m.req("POST", "/api/access/requests", {
  requests: [{ appKey: "akai", purpose: "Menyusun konsep surat dan ringkasan rapat dengan bantuan AI." }],
});
const akaiReq = r.d?.apps?.find((x) => x.key === "akai")?.pendingRequestId;
r = await adm.req("POST", `/api/admin/access-requests/${akaiReq}/reject`, { note: "Belum dibuka untuk umum." });
ok("reject request 204", r.s === 204, r);
r = await m.get("/api/access");
ok(
  "rejected request in history with note",
  r.d?.requests?.some((x) => x.appKey === "akai" && x.status === "rejected" && x.note === "Belum dibuka untuk umum."),
  r.d,
);
r = await adm.req("PUT", `/api/admin/accounts/${memberId}/apps/akasha`, { role: "member", days: 90 });
r = await clientAccount();
ok("admin sets duration directly", r.access?.state === "active" && !!r.access.expiresAt && r.role === "member", r);
await accessDb.end();

// ---------------------------------------------------------------- bersihkan
const db = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?.*$/, "") });
await db.connect();
const del = await db.query("DELETE FROM accounts WHERE email LIKE 'smoke-%@example.test'");
await db.end();
ok("cleanup smoke accounts", del.rowCount >= 2, del.rowCount);

if (failed) {
  console.log(`\n${failed} test gagal`);
  process.exit(1);
}
console.log("\nSemua test lulus");
