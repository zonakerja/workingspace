import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";

/** Token acak untuk tautan email & cookie sesi; yang disimpan di database hanya hash-nya. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Cookie sesi halaman SSO: host-only (tanpa Domain) sehingga aplikasi lain tidak bisa membaca/menimpanya. */
export const SESSION_COOKIE = "ws_sid";

export function sessionCookieOptions(secure: boolean, maxAgeMs?: number): CookieOptions {
  return { httpOnly: true, secure, sameSite: "lax", path: "/", ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

/** Baca satu cookie tanpa cookie-parser. */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export const clientInfo = (req: Request): ClientInfo => ({
  ip: req.ip,
  userAgent: req.headers["user-agent"]?.slice(0, 300),
});

export function clearSessionCookie(res: Response, secure: boolean) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(secure));
}
