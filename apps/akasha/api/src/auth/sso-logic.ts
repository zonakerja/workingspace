/** Aturan masuk lewat SSO workingspace.id (logika murni, diuji di sso-logic.spec.ts). */
import type { UserRole } from "../generated/prisma/client";

export interface SsoClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  apps?: Record<string, string>;
  super_admin?: boolean;
  /** Sesi SSO (OIDC sid) — dicocokkan dengan logout token saat sesi SSO berakhir */
  sid?: string;
}

/**
 * Role Akasha dari klaim SSO: super admin ekosistem = super_admin; role aplikasi `akasha` admin/member; tanpa akses = null
 * (SSO sudah menolak, ini pengaman kedua).
 */
export function roleFromClaims(claims: Pick<SsoClaims, "apps" | "super_admin">, appKey: string): UserRole | null {
  if (claims.super_admin) return "super_admin";
  const role = claims.apps?.[appKey];
  if (role === "admin") return "admin";
  if (role === "member") return "member";
  return null;
}

/** Tujuan setelah masuk: hanya path di aplikasi ini (mencegah open redirect). */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  if (value.startsWith("/login") || value.startsWith("/api/")) return "/";
  return value.slice(0, 500);
}

/**
 * Pemeriksaan diam-diam (`ws_silent=1` / `prompt=none`) tidak menemukan sesi SSO yang bisa dipakai → bukan galat bagi pengguna:
 * Akasha cukup menampilkan halaman masuknya.
 */
export const isSilentSsoMiss = (error: string) =>
  error === "login_required" || error === "interaction_required" || error === "consent_required";

/** Pesan galat ramah dari parameter `error` callback OIDC. */
export function ssoErrorMessage(error: string, description?: string | null): string {
  if (error === "access_denied") return description || "Masuk dibatalkan.";
  if (error === "login_required" || error === "interaction_required") return "Silakan masuk lagi.";
  return description || "Masuk lewat akun Workingspace gagal. Coba lagi.";
}

export const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * Isi logout token (OIDC Back-Channel Logout 1.0 §2.4) setelah tanda tangan, iss, aud, exp diperiksa jose:
 * wajib event back-channel-logout, jti, sid (Akasha hanya mengakhiri sesi dari sid itu), tanpa nonce.
 * Hasil = sid & sub, atau pesan galat.
 */
export function logoutTokenClaims(payload: Record<string, unknown>): { sid: string; sub?: string } | { error: string } {
  const events = payload.events as Record<string, unknown> | undefined;
  if (!events || typeof events !== "object" || !(BACKCHANNEL_LOGOUT_EVENT in events))
    return { error: "event back-channel-logout tidak ada" };
  if ("nonce" in payload) return { error: "logout token tidak boleh memuat nonce" };
  if (typeof payload.jti !== "string" || !payload.jti) return { error: "jti tidak ada" };
  if (typeof payload.sid !== "string" || !payload.sid) return { error: "sid tidak ada" };
  return { sid: payload.sid, ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}) };
}
