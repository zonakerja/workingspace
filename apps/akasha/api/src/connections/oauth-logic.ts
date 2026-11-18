/**
 * Akun tersambung lewat OAuth (docs/AKUN-TERSAMBUNG.md tahap 2). Logika murni, diuji di oauth-logic.spec.ts: alamat penyedia,
 * scope minimum, URL izin dengan PKCE, dan pembacaan respons token.
 */
import { createHash } from "node:crypto";

export const OAUTH_PROVIDERS = ["google", "microsoft"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/**
 * Scope minimum. Google: hanya kalender buatan aplikasi (`calendar.app.created` = membuat kalender "Akasha" dan mengelola acara
 * di dalamnya; kalender lain tidak terbaca). Gmail tetap lewat IMAP + Sandi Aplikasi (scope baca Gmail = audit keamanan Google).
 * Microsoft: kalender + email Outlook (baca & kirim).
 */
const OAUTH_SCOPES: Record<OAuthProvider, string[]> = {
  google: ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.app.created"],
  microsoft: [
    "openid",
    "email",
    "profile",
    "offline_access",
    "User.Read",
    "Calendars.ReadWrite",
    "Mail.Read",
    "Mail.Send",
  ],
};

/**
 * Scope tambahan Drive (docs/AKUN-TERSAMBUNG.md tahap 4), diminta hanya saat user menekan "Izinkan Drive". Google: `drive.file`
 * (tidak sensitif: berkas yang dipilih lewat Picker + berkas buatan Akasha saja). Microsoft: `Files.Read` (memilih berkas OneDrive)
 * + `Files.ReadWrite.AppFolder` (folder aplikasi untuk arsip dingin).
 */
const DRIVE_SCOPES: Record<OAuthProvider, string[]> = {
  google: ["https://www.googleapis.com/auth/drive.file"],
  microsoft: ["Files.Read", "Files.ReadWrite.AppFolder"],
};

/** Scope tersimpan (dari respons token) sudah memuat izin Drive? Microsoft bisa mengirim scope berawalan alamat Graph. */
export function hasDriveScope(provider: OAuthProvider, scopes: string) {
  const granted = scopes
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase());
  return DRIVE_SCOPES[provider].every((need) => granted.includes(need.toLowerCase()));
}

export interface OAuthEndpoints {
  authorize: string;
  token: string;
  /** Profil (email & nama) */
  profile: string;
  /** Akar API kalender / Graph */
  api: string;
  /** Akar Drive API (Google: drive/v3; Microsoft: sama dengan Graph) */
  drive: string;
  /** Akar unggah Drive (Google: upload/drive/v3; Microsoft: sama dengan Graph) */
  driveUpload: string;
}

export function oauthEndpoints(
  provider: OAuthProvider,
  options: { tenant?: string; testBase?: string },
): OAuthEndpoints {
  const base = options.testBase?.replace(/\/+$/, "");
  if (provider === "google") {
    return base
      ? {
          authorize: `${base}/google/auth`,
          token: `${base}/google/token`,
          profile: `${base}/google/userinfo`,
          api: `${base}/google/calendar/v3`,
          drive: `${base}/google/drive/v3`,
          driveUpload: `${base}/google/upload/drive/v3`,
        }
      : {
          authorize: "https://accounts.google.com/o/oauth2/v2/auth",
          token: "https://oauth2.googleapis.com/token",
          profile: "https://openidconnect.googleapis.com/v1/userinfo",
          api: "https://www.googleapis.com/calendar/v3",
          drive: "https://www.googleapis.com/drive/v3",
          driveUpload: "https://www.googleapis.com/upload/drive/v3",
        };
  }
  const tenant = options.tenant || "consumers";
  return base
    ? {
        authorize: `${base}/ms/authorize`,
        token: `${base}/ms/token`,
        profile: `${base}/ms/v1.0/me`,
        api: `${base}/ms/v1.0`,
        drive: `${base}/ms/v1.0`,
        driveUpload: `${base}/ms/v1.0`,
      }
    : {
        authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        profile: "https://graph.microsoft.com/v1.0/me",
        api: "https://graph.microsoft.com/v1.0",
        drive: "https://graph.microsoft.com/v1.0",
        driveUpload: "https://graph.microsoft.com/v1.0",
      };
}

const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** URL halaman izin penyedia. Google wajib `access_type=offline` + `prompt=consent` agar memberi refresh token. */
export function authorizeUrl(
  provider: OAuthProvider,
  endpoints: OAuthEndpoints,
  input: {
    clientId: string;
    redirectUri: string;
    state: string;
    verifier: string;
    loginHint?: string;
    drive?: boolean;
  },
) {
  const url = new URL(endpoints.authorize);
  const params: Record<string, string> = {
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: [...OAUTH_SCOPES[provider], ...(input.drive ? DRIVE_SCOPES[provider] : [])].join(" "),
    state: input.state,
    code_challenge: pkceChallenge(input.verifier),
    code_challenge_method: "S256",
  };
  if (provider === "google")
    Object.assign(params, { access_type: "offline", prompt: "consent", include_granted_scopes: "true" });
  else params.prompt = "select_account";
  if (input.loginHint) params.login_hint = input.loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  /** epoch ms */
  expires_at: number;
}

/** Respons token penyedia → token tersimpan; refresh token lama dipakai bila penyedia tidak mengirim yang baru. */
export function parseTokenResponse(raw: unknown, now: number, previous?: StoredToken): StoredToken {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.access_token !== "string" || !r.access_token) {
    const reason =
      typeof r.error_description === "string" ? r.error_description : typeof r.error === "string" ? r.error : "";
    throw new Error(`Token tidak diterima penyedia${reason ? `: ${reason.slice(0, 200)}` : ""}.`);
  }
  const ttl = Number(r.expires_in);
  return {
    access_token: r.access_token,
    refresh_token: typeof r.refresh_token === "string" ? r.refresh_token : previous?.refresh_token,
    expires_at: now + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000,
  };
}

/** Token perlu diperbarui (sisa < 2 menit). */
export const tokenExpired = (token: StoredToken, now: number) => token.expires_at - 120_000 <= now;

/** Email & nama dari profil Google (userinfo) / Microsoft Graph (/me). */
export function profileIdentity(provider: OAuthProvider, raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const email = (provider === "google" ? str(r.email) : str(r.mail) || str(r.userPrincipalName)).toLowerCase();
  const name = provider === "google" ? str(r.name) : str(r.displayName);
  if (!email) throw new Error("Penyedia tidak mengirim alamat email akun.");
  return { email, displayName: name || null };
}

/** Galat refresh yang berarti izin dicabut / kedaluwarsa (perlu sambungkan ulang). */
export const isRevoked = (raw: unknown) => {
  const e = (raw ?? {}) as Record<string, unknown>;
  return e.error === "invalid_grant" || e.error === "unauthorized_client";
};
