/** Pembantu tampilan murni (diuji di format.test.ts). */

/** Ringkasan peramban dari user agent: "Chrome · Windows". */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Perangkat tidak dikenal";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : /node|undici/i.test(userAgent)
              ? "Program"
              : "Peramban";
  const os = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPad/.test(userAgent)
      ? "iOS"
      : /Windows/.test(userAgent)
        ? "Windows"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

const DATE_TIME = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });
export const formatDateTime = (iso: string) => DATE_TIME.format(new Date(iso));

/**
 * Tujuan setelah masuk di halaman SSO tanpa alur OIDC: hanya path di situs ini (mencegah open redirect).
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/account";
  return next;
}

const EVENT_LABELS: Record<string, string> = {
  register: "Mendaftar",
  email_verified: "Email diverifikasi",
  login: "Masuk",
  login_failed: "Gagal masuk",
  password_reset: "Atur ulang kata sandi",
  password_changed: "Ganti kata sandi",
  admin_created: "Dibuat admin",
  admin_updated: "Diubah admin",
  admin_password_link: "Admin mengirim tautan kata sandi",
  admin_sign_out: "Dikeluarkan admin dari semua perangkat",
  admin_app_access: "Akses aplikasi diubah",
  admin_app_updated: "Pengaturan aplikasi diubah",
  pin_set: "PIN diatur",
  pin_removed: "PIN dihapus",
  pin_failed: "PIN salah",
  pin_blocked: "PIN diblokir",
};

/** Label log keamanan; kejadian baru tanpa label tetap tampil dengan kodenya. */
export const eventLabel = (event: string) => EVENT_LABELS[event] ?? event;

/** Metode masuk dari detail log ("password:akasha" → "kata sandi · akasha"). */
export function loginMethod(detail: Record<string, unknown> | null): string | null {
  const method = typeof detail?.method === "string" ? detail.method : null;
  if (!method) return null;
  const [kind, app] = method.split(":");
  const label =
    kind === "password" ? "kata sandi" : kind === "sso" ? "sesi SSO" : kind === "verify" ? "tautan verifikasi" : kind;
  return app ? `${label} · ${app}` : label;
}

export const ROLE_LABELS = { admin: "Admin", member: "Anggota" } as const;

/** Pemeriksaan PIN di browser sebelum dikirim (server tetap memeriksa ulang). */
export function pinProblem(pin: string, confirm: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "PIN harus 6 angka.";
  if (/^(\d)\1{5}$/.test(pin)) return "PIN terlalu mudah ditebak (angka sama semua).";
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if (Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step))
    return "PIN terlalu mudah ditebak (angka berurutan).";
  if (pin !== confirm) return "Konfirmasi PIN tidak sama.";
  return null;
}

export interface SecurityCheck {
  key: "email" | "password" | "pin";
  label: string;
  done: boolean;
  /** Bagian halaman akun untuk memperbaikinya */
  hash: string;
}

/** Langkah pengamanan akun yang tampil di ringkasan (urutan = urutan saran). */
export function securityChecks(account: { emailVerified: boolean; hasPassword: boolean; hasPin: boolean }) {
  const checks: SecurityCheck[] = [
    { key: "email", label: "Email terverifikasi", done: account.emailVerified, hash: "profil" },
    { key: "password", label: "Kata sandi dibuat", done: account.hasPassword, hash: "keamanan" },
    { key: "pin", label: "PIN keamanan aktif", done: account.hasPin, hash: "pin" },
  ];
  const score = Math.round((checks.filter((c) => c.done).length / checks.length) * 100);
  return { checks, score };
}

/** "baru saja", "5 menit lalu", "3 jam lalu", "2 hari lalu", lalu tanggal. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minute = 60_000;
  if (diff < minute) return "baru saja";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} menit lalu`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} jam lalu`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} hari lalu`;
  return DATE_ONLY.format(new Date(iso));
}

const DATE_ONLY = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

/** Perangkat seluler menurut user agent (untuk ikon). */
export const isMobileAgent = (userAgent: string | null) => !!userAgent && /Android|iPhone|iPad|Mobile/.test(userAgent);
