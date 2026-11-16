// Uji ujung-ke-ujung Akasha ↔ SSO workingspace.id (jalankan saat Akasha, frontend Vite, dan SSO menyala):
//   node test/sso-smoke.mjs
// Env: APP_URL (bawaan http://localhost:5173), SSO_URL (bawaan http://auth.workingspace.localhost:5175), SSO_ADMIN_EMAIL/PASSWORD
// (bawaan seed dev admin@workingspace.id / 123). Membuat akun SSO sementara smoke-sso-*@example.test lalu menghapusnya
// (SSO lewat database workingspace_auth, Akasha lewat /users).
import dns from "node:dns";
import pg from "pg";

// Resolver Windows tidak mengenal *.localhost (Chrome & curl menanganinya sendiri) → arahkan ke localhost
const lookup = dns.lookup;
dns.lookup = (hostname, ...rest) => lookup(hostname.endsWith(".localhost") ? "localhost" : hostname, ...rest);

const APP = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
const SSO = (process.env.SSO_URL ?? "http://auth.workingspace.localhost:5175").replace(/\/+$/, "");
const ADMIN = {
  email: process.env.SSO_ADMIN_EMAIL ?? "admin@workingspace.id",
  password: process.env.SSO_ADMIN_PASSWORD ?? "123",
};
const SSO_DB = process.env.SSO_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/workingspace_auth";

let failed = 0;
const ok = (name, cond, info) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`, info === undefined ? "" : JSON.stringify(info).slice(0, 500));
  }
};

/** Browser kecil lintas asal: cookie disimpan per host (tanpa memperhatikan path). */
class Browser {
  jars = new Map();
  jar(url) {
    const host = new URL(url).host;
    if (!this.jars.has(host)) this.jars.set(host, new Map());
    return this.jars.get(host);
  }
  async req(method, url, body) {
    const jar = this.jar(url);
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    const location = res.headers.get("location");
    return { s: res.status, d: data, location: location ? new URL(location, url).href : null };
  }
  /** Ikuti pengalihan 30x sampai berhenti (atau sampai halaman masuk SSO). */
  async follow(url) {
    let r = await this.req("GET", url);
    for (let i = 0; i < 10 && r.location && r.s >= 300 && r.s < 400; i++) {
      if (new URL(r.location).pathname === "/login" && r.location.startsWith(SSO)) return r;
      r = await this.req("GET", r.location);
    }
    return r;
  }
}

/** Pemeriksaan diam-diam: ikuti alur sampai callback Akasha; hasil = tujuan akhir pengalihan callback. */
async function silentCheck(browser) {
  let r = await browser.req("GET", `${APP}/api/v1/auth/sso/start?silent=1&returnTo=%2Fplanner`);
  for (let i = 0; i < 10 && r.location; i++) {
    if (r.location.includes("/api/v1/auth/sso/callback")) {
      const done = await browser.req("GET", r.location);
      return new URL(done.location).pathname + new URL(done.location).search;
    }
    if (r.location.includes("/login?uid=")) return "SSO_LOGIN_PAGE";
    r = await browser.req("GET", r.location);
  }
  return null;
}

/** Masuk Akasha lewat SSO dari awal (halaman login Akasha → SSO → callback). */
async function ssoSignIn(browser, email, password, returnTo = "/planner") {
  let r = await browser.follow(`${APP}/api/v1/auth/sso/start?returnTo=${encodeURIComponent(returnTo)}`);
  if (r.location?.includes("/login?uid=")) {
    const uid = new URL(r.location).searchParams.get("uid");
    const login = await browser.req("POST", `${SSO}/interaction/${uid}/login`, { email, password });
    if (login.s !== 200) return { login };
    r = await browser.follow(new URL(login.d.redirectTo, SSO).href);
  }
  return { final: r };
}

const stamp = Date.now();
const email = `smoke-sso-${stamp}@example.test`;
const password = "Ruang-Kerja-Sso-1";

// ---------------------------------------------------------------- konfigurasi
let r = await fetch(`${APP}/api/v1/auth/sso/config`).then((x) => x.json());
ok("sso config enabled", r.enabled === true && typeof r.accountUrl === "string", r);
if (!r.enabled) process.exit(1);

// ---------------------------------------------------------------- akun SSO baru dari admin, tanpa akses Akasha
const admin = new Browser();
r = await admin.req("POST", `${SSO}/api/auth/login`, ADMIN);
ok("sso admin login", r.s === 200, r);
r = await admin.req("POST", `${SSO}/api/admin/accounts`, { name: "Uji SSO Akasha", email, password });
ok("sso create account (no Akasha access)", r.s === 201, r);
const accountId = r.d.id;

const user = new Browser();
let res = await ssoSignIn(user, email, password);
ok(
  "no Akasha access → SSO refuses (APP_FORBIDDEN)",
  res.login?.s === 403 && res.login.d.code === "APP_FORBIDDEN",
  res.login,
);

// ---------------------------------------------------------------- beri akses → masuk Akasha
r = await admin.req("PUT", `${SSO}/api/admin/accounts/${accountId}/apps/akasha`, { role: "member" });
ok("grant Akasha member", r.s === 200, r);
const user2 = new Browser();
res = await ssoSignIn(user2, email, password, "/planner/daily");
ok("callback lands on returnTo", res.final?.s === 200 && res.final.location === null, res.final?.s);
ok("akasha refresh cookie set", user2.jar(APP).has("akasha_rt"), [...user2.jar(APP).keys()]);
r = await user2.req("POST", `${APP}/api/v1/auth/refresh`);
ok(
  "akasha session = SSO account",
  r.s === 200 && r.d.user.email === email && r.d.user.role === "member" && !!r.d.user.ssoSubject,
  r.d?.user,
);
const akashaUserId = r.d.user?.id;
r = await user2.req("POST", `${APP}/api/v1/auth/login`, { email, password });
ok("SSO account has no local password", r.s === 401, r);

// Masuk lagi saat sesi SSO masih ada → tanpa kata sandi
res = await ssoSignIn(user2, email, "salah-tidak-dipakai");
ok("single sign-on (no password prompt)", !res.login && user2.jar(APP).has("akasha_rt"), res.login);

// Pemeriksaan diam-diam (halaman masuk Akasha): SSO sudah masuk → Akasha langsung masuk; belum → kembali tanpa halaman masuk SSO
let silent = await silentCheck(user2);
ok("silent check with SSO session → signed in", silent === "/planner" && user2.jar(APP).has("akasha_rt"), silent);
silent = await silentCheck(new Browser());
ok("silent check without SSO session → /login?sso_checked=1", silent === "/login?sso_checked=1", silent);

// ---------------------------------------------------------------- PIN & akun dikelola SSO (B2 langkah 2)
const at2 = (await user2.req("POST", `${APP}/api/v1/auth/refresh`)).d.accessToken;
const api = (method, path, body, token = at2) =>
  fetch(`${APP}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (x) => ({ s: x.status, d: await x.json().catch(() => null) }));
r = await api("GET", "/security/pin");
ok(
  "akasha pin status managed by SSO (no pin yet)",
  r.s === 200 && r.d.managedBySso === true && r.d.hasPin === false && !!r.d.accountUrl,
  r.d,
);
r = await api("PUT", "/security/pin", { password: "x", pin: "482915" });
ok("set pin in Akasha refused → PIN_IN_SSO", r.s === 409 && r.d.code === "PIN_IN_SSO", r.d);
r = await api("POST", "/security/pin/unlock", { pin: "482915" });
ok("unlock without SSO pin → 409 PIN_NOT_SET", r.s === 409 && r.d.code === "PIN_NOT_SET", r.d);
const ssoUser = new Browser();
await ssoUser.req("POST", `${SSO}/api/auth/login`, { email, password });
r = await ssoUser.req("PUT", `${SSO}/api/pin`, { pin: "482915", password });
ok("set pin at SSO", r.s === 200 && r.d.hasPin, r.d);
r = await api("GET", "/security/pin");
ok("akasha sees SSO pin", r.s === 200 && r.d.hasPin === true && r.d.unlocked === false, r.d);
r = await api("POST", "/security/pin/unlock", { pin: "000001" });
ok("wrong pin via SSO 400 PIN_WRONG", r.s === 400 && r.d.code === "PIN_WRONG", r.d);
r = await api("POST", "/security/pin/unlock", { pin: "482915" });
ok("unlock with SSO pin", r.s === 200 && r.d.unlocked === true, r.d);
r = await api("POST", "/robot/connectors/ekinerja/credentials", { username: "uji", password: "uji-rahasia" });
ok("robot credentials without PIN refused", r.s === 400 || r.s === 403, r.d);
r = await api("POST", "/robot/connectors/ekinerja/credentials", {
  username: "uji",
  password: "uji-rahasia",
  accountPin: "000001",
});
ok("robot credentials wrong PIN 400", r.s === 400 && r.d.code === "PIN_WRONG", r.d);
r = await api("POST", "/robot/connectors/ekinerja/credentials", {
  username: "uji",
  password: "uji-rahasia",
  accountPin: "482915",
});
ok("robot credentials confirmed with PIN", r.s === 200 || r.s === 201, r.d);
await api("DELETE", "/robot/connectors/ekinerja/credentials");
r = await api("PATCH", "/auth/me", { name: "Ganti Nama" });
ok("SSO account name change in Akasha refused", r.s === 400, r.d);
r = await api("PATCH", "/auth/me", { phone: "0812" });
ok("SSO account phone change allowed", r.s === 200 && r.d.phone === "0812" && r.d.hasPassword === false, r.d);
const adminAt = (await new Browser().req("POST", `${APP}/api/v1/auth/login`, ADMIN)).d.accessToken;
r = await api("PATCH", `/users/${akashaUserId}`, { role: "admin" }, adminAt);
ok("Manajemen User: role of SSO account refused 409", r.s === 409 && r.d.code === "MANAGED_BY_SSO", r.d);

// Role berubah di SSO → disamakan saat refresh (setelah cache status 60 dtk)
r = await admin.req("PUT", `${SSO}/api/admin/accounts/${accountId}/apps/akasha`, { role: "admin" });
console.log("… menunggu cache status akun SSO (65 dtk)");
await new Promise((x) => setTimeout(x, 65_000));
r = await user2.req("POST", `${APP}/api/v1/auth/refresh`);
ok("role synced from SSO on refresh", r.s === 200 && r.d.user.role === "admin", r.d?.user?.role);

// Keluar dari halaman SSO → SSO mengirim logout token ke Akasha → sesi Akasha dari sesi SSO itu berakhir
const user3 = new Browser();
res = await ssoSignIn(user3, email, password);
ok("second browser signed in", user3.jar(APP).has("akasha_rt"), res.final?.s);
const at3 = (await user3.req("POST", `${APP}/api/v1/auth/refresh`)).d.accessToken;
r = await user3.req("POST", `${SSO}/api/auth/logout`);
ok("SSO logout", r.s === 204, r);
await new Promise((x) => setTimeout(x, 1000));
r = await user3.req("POST", `${APP}/api/v1/auth/refresh`);
ok("back-channel logout → Akasha refresh 401", r.s === 401, r);
const me3 = await fetch(`${APP}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${at3}` } });
ok("back-channel logout → open tab access token 401", me3.status === 401, me3.status);
r = await user2.req("POST", `${APP}/api/v1/auth/refresh`);
ok("other browser's Akasha session untouched", r.s === 200, r.s);
r = await fetch(`${APP}/api/v1/auth/sso/backchannel-logout`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "logout_token=palsu",
});
ok("forged logout token 400", r.status === 400, r.status);

// Akses dicabut di SSO → sesi Akasha berakhir
r = await admin.req("DELETE", `${SSO}/api/admin/accounts/${accountId}/apps/akasha`);
await new Promise((x) => setTimeout(x, 65_000));
r = await user2.req("POST", `${APP}/api/v1/auth/refresh`);
ok("access revoked in SSO → Akasha session ends 401", r.s === 401, r);

// Keluar: Akasha memberi alamat keluar SSO
r = await user2.req("POST", `${APP}/api/v1/auth/logout`);
ok(
  "logout returns SSO end-session URL",
  r.s === 200 && String(r.d.ssoLogoutUrl).startsWith(`${SSO}/oidc/session/end`),
  r.d,
);
// Halaman keluar SSO dari aplikasi terdaftar: dikirim otomatis (tanpa tombol konfirmasi), skrip ber-nonce
{
  const page = await fetch(r.d.ssoLogoutUrl, {
    headers: { Cookie: [...user2.jar(r.d.ssoLogoutUrl)].map(([k, v]) => `${k}=${v}`).join("; ") },
  });
  const html = await page.text();
  const csp = page.headers.get("content-security-policy") ?? "";
  ok(
    "SSO logout page auto-submits (no confirmation)",
    page.status === 200 && html.includes('getElementById("op.logoutForm").submit()') && /script-src 'nonce-/.test(csp),
    { status: page.status, csp },
  );
}

// Callback tanpa cookie alur / state palsu → ditolak dengan pesan
r = await new Browser().req("GET", `${APP}/api/v1/auth/sso/callback?code=palsu&state=palsu`);
ok(
  "callback without flow cookie → /login?sso_error",
  r.s === 302 && /\/login\?sso_error=/.test(r.location ?? ""),
  r.location,
);
r = await new Browser().req("GET", `${APP}/api/v1/auth/sso/start?returnTo=https://evil.example`);
ok("start → SSO authorize", r.s === 302 && r.location?.startsWith(`${SSO}/oidc/auth?`), r.location);

// ---------------------------------------------------------------- bersihkan
if (akashaUserId) {
  r = await admin.req("POST", `${APP}/api/v1/auth/login`, ADMIN);
  const at = r.d?.accessToken;
  r = await fetch(`${APP}/api/v1/users/${akashaUserId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${at}` },
  });
  ok("cleanup Akasha user", r.ok, r.status);
}
const db = new pg.Client({ connectionString: SSO_DB });
await db.connect();
const del = await db.query("DELETE FROM accounts WHERE email LIKE 'smoke-sso-%@example.test'");
await db.end();
ok("cleanup SSO account", del.rowCount >= 1, del.rowCount);

if (failed) {
  console.log(`\n${failed} test gagal`);
  process.exit(1);
}
console.log("\nSemua test lulus");
