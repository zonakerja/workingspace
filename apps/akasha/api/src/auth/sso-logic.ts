/** Aturan masuk lewat SSO workingspace.id (logika murni, diuji di sso-logic.spec.ts). */
import type { UserRole } from "../generated/prisma/client";

export interface SsoClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  apps?: Record<string, string>;
  super_admin?: boolean;
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

/** Pesan galat ramah dari parameter `error` callback OIDC. */
export function ssoErrorMessage(error: string, description?: string | null): string {
  if (error === "access_denied") return description || "Masuk dibatalkan.";
  if (error === "login_required" || error === "interaction_required") return "Silakan masuk lagi.";
  return description || "Masuk lewat akun Workingspace gagal. Coba lagi.";
}
