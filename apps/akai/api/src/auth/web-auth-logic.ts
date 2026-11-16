/** Aturan masuk Akai web lewat SSO (logika murni, diuji di web-auth-logic.spec.ts). docs/AKAI.md §4. */

export const SESSION_COOKIE = "akai_sid";
export const FLOW_COOKIE = "akai_sso";
/** Sesi web berlaku 30 hari sejak terakhir dipakai (diperpanjang paling sering tiap jam). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 60 * 60 * 1000;
/** Cookie alur masuk (state, nonce, PKCE) berlaku 10 menit. */
export const FLOW_TTL_S = 10 * 60;
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export interface SsoClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  sid?: string;
  super_admin?: boolean;
  apps?: Record<string, string>;
}

/** Akun boleh memakai Akai: super admin ekosistem atau punya akses aplikasi `appKey` (admin/member). */
export function hasAppAccess(claims: Pick<SsoClaims, "apps" | "super_admin">, appKey: string): boolean {
  if (claims.super_admin) return true;
  const role = claims.apps?.[appKey];
  return role === "admin" || role === "member";
}

/** Tujuan setelah masuk: hanya path di Akai web (mencegah open redirect). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  if (value.startsWith("/login") || value.startsWith("/api/")) return "/";
  return value.slice(0, 500);
}

/** Pemeriksaan diam-diam (`ws_silent=1`) tidak menemukan sesi SSO → bukan galat, cukup tampilkan halaman masuk. */
export const isSilentSsoMiss = (error: string) =>
  error === "login_required" || error === "interaction_required" || error === "consent_required";

/** Pesan ramah dari parameter `error` callback OIDC. */
export function ssoErrorMessage(error: string, description?: string | null): string {
  if (error === "access_denied") return description || "Masuk dibatalkan.";
  return description ? `Masuk gagal: ${description}` : "Masuk lewat akun Workingspace gagal. Coba lagi.";
}

/** Isi logout token OIDC Back-Channel Logout (tanda tangan & iss/aud diperiksa terpisah dengan jose). */
export function logoutTokenClaims(payload: Record<string, unknown>): { sid: string; sub?: string } | { error: string } {
  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || typeof events !== "object" || !(BACKCHANNEL_LOGOUT_EVENT in events))
    return { error: "event back-channel-logout tidak ada" };
  if ("nonce" in payload) return { error: "logout token tidak boleh memuat nonce" };
  if (typeof payload.jti !== "string" || !payload.jti) return { error: "jti tidak ada" };
  if (typeof payload.sid !== "string" || !payload.sid) return { error: "sid tidak ada" };
  return { sid: payload.sid, ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}) };
}

/** Nilai satu cookie dari header `Cookie` (tanpa pustaka). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const raw = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Permintaan web yang mengubah data wajib membawa header `X-Akai-Web: 1`. Browser tidak bisa mengirim header ini lintas
 * situs tanpa preflight CORS (yang tidak diizinkan Akai), jadi formulir/tautan situs lain tidak bisa memakai cookie sesi.
 */
export const needsWebHeader = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
