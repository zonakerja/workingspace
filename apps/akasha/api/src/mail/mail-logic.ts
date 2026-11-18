/**
 * Akun email tersambung (docs/AKUN-TERSAMBUNG.md tahap 0). Logika murni, diuji di mail-logic.spec.ts: preset penyedia, validasi
 * SMTP, dan isi email ringkasan harian.
 */

export const MAIL_PROVIDERS = ["gmail", "outlook", "custom"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const MAX_MAIL_ACCOUNTS = 10;
const SMTP_PORTS = [25, 465, 587, 2525] as const;

export interface MailPreset {
  label: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  /** Kosong = bisa dipakai dengan kata sandi aplikasi; isi = alasan tidak bisa (butuh login OAuth). */
  oauthOnly?: string;
  hint: string;
}

export const MAIL_PRESETS: Record<MailProvider, MailPreset> = {
  gmail: {
    label: "Gmail",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    hint: "Pakai Sandi Aplikasi Google (Akun Google → Keamanan → Verifikasi 2 Langkah → Sandi aplikasi), bukan kata sandi Gmail.",
  },
  outlook: {
    label: "Outlook / Hotmail",
    oauthOnly:
      "Microsoft mematikan login kata sandi untuk Outlook.com sejak September 2024. Sambungkan akun Microsoft di kartu 'Google & Microsoft' di halaman ini, lalu klik 'Pakai untuk email'.",
    hint: "Lewat login Microsoft (OAuth).",
  },
  custom: {
    label: "Email lain (SMTP)",
    hint: "Isi server SMTP dari penyedia email (mis. email kantor/domain sendiri).",
  },
};

export const isMailProvider = (v: unknown): v is MailProvider =>
  typeof v === "string" && (MAIL_PROVIDERS as readonly string[]).includes(v);

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
export const isEmail = (v: string) => v.length <= 254 && EMAIL.test(v);
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export interface SmtpInput {
  provider: MailProvider;
  address: string;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean | null;
  smtpUser?: string | null;
}

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

/**
 * Susun pengaturan SMTP dari isian + preset. Mengembalikan pesan galat (Bahasa Indonesia) bila tidak valid.
 * `isPrivate` = pemeriksa host privat (ditolak di production agar tidak menjadi jalan ke jaringan internal).
 */
export function resolveSmtp(
  input: SmtpInput,
  options: { isPrivate: (host: string) => boolean; production: boolean },
): SmtpSettings | string {
  const preset = MAIL_PRESETS[input.provider];
  if (preset.oauthOnly) return preset.oauthOnly;
  const address = input.address.trim().toLowerCase();
  if (!isEmail(address)) return "Alamat email tidak valid.";
  const host = (preset.smtpHost ?? input.smtpHost ?? "").trim().toLowerCase();
  if (!host || !HOST.test(host)) return "Server SMTP tidak valid.";
  if (options.production && options.isPrivate(host)) return "Server SMTP harus alamat publik.";
  const port = preset.smtpPort ?? input.smtpPort ?? 587;
  if (!(SMTP_PORTS as readonly number[]).includes(port)) return "Port SMTP harus 465, 587, 25, atau 2525.";
  const secure = preset.smtpSecure ?? input.smtpSecure ?? port === 465;
  const user = (input.smtpUser ?? "").trim() || address;
  return { host, port, secure, user };
}

/** HH:mm (00:00–23:59). */
export const isClock = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const DIGEST_TIMEZONES = { "Asia/Jakarta": 7, "Asia/Makassar": 8, "Asia/Jayapura": 9 } as const;
export type DigestTimezone = keyof typeof DIGEST_TIMEZONES;
export const isDigestTimezone = (v: unknown): v is DigestTimezone =>
  typeof v === "string" && Object.hasOwn(DIGEST_TIMEZONES, v);

/** Tanggal & jam lokal saat `now` di zona `tz`. */
export function localNow(now: Date, tz: DigestTimezone) {
  const shifted = new Date(now.getTime() + DIGEST_TIMEZONES[tz] * 3_600_000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Ringkasan harian jatuh tempo: jam lokal sudah lewat `digestTime` dan hari ini belum terkirim. */
export function digestDue(
  account: { digestEnabled: boolean; digestTime: string; digestTimezone: string; digestLastSent: string | null },
  now: Date,
) {
  if (!account.digestEnabled) return null;
  const tz: DigestTimezone = isDigestTimezone(account.digestTimezone) ? account.digestTimezone : "Asia/Jakarta";
  const local = localNow(now, tz);
  if (local.time < account.digestTime) return null;
  if (account.digestLastSent === local.date) return null;
  return local.date;
}

export interface DigestItem {
  title: string;
  /** "09:00–10:00", "Sepanjang hari", "Terlambat 3 hari", dsb. */
  note?: string;
  url?: string;
}

export interface DigestData {
  date: string;
  name: string;
  agenda: DigestItem[];
  todos: DigestItem[];
  tasks: DigestItem[];
  overdue: DigestItem[];
  appUrl: string;
}

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
export function longDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Email ringkasan harian (teks + HTML sederhana). Kosong semua = tetap dikirim dengan kalimat "tidak ada". */
export function buildDigest(data: DigestData) {
  const sections: [string, DigestItem[]][] = [
    ["Agenda hari ini", data.agenda],
    ["To-do hari ini", data.todos],
    ["Task jatuh tempo hari ini", data.tasks],
    ["Terlambat", data.overdue],
  ];
  const total = data.agenda.length + data.todos.length + data.tasks.length + data.overdue.length;
  const subject = `Ringkasan Akasha · ${longDate(data.date)}${total ? ` · ${total} butir` : ""}`;
  const line = (i: DigestItem) => `- ${i.title}${i.note ? ` (${i.note})` : ""}`;
  const text = [
    `Halo ${data.name},`,
    "",
    `Ringkasan ${longDate(data.date)}:`,
    "",
    ...sections.flatMap(([title, items]) => (items.length ? [`${title}:`, ...items.map(line), ""] : [])),
    ...(total ? [] : ["Tidak ada agenda, to-do, atau task untuk hari ini.", ""]),
    `Buka Akasha: ${data.appUrl}/overview`,
    "",
    "Email ini dikirim karena ringkasan harian dinyalakan di Akasha (Pengaturan → Akun Tersambung).",
  ].join("\n");
  const htmlItem = (i: DigestItem) => {
    const title = escapeHtml(i.title);
    const linked = i.url
      ? `<a href="${escapeHtml(i.url)}" style="color:#4f46e5;text-decoration:none">${title}</a>`
      : title;
    return `<li style="margin:4px 0">${linked}${i.note ? ` <span style="color:#6b7280">· ${escapeHtml(i.note)}</span>` : ""}</li>`;
  };
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;max-width:560px">`,
    `<p>Halo ${escapeHtml(data.name)},</p>`,
    `<p style="font-size:16px;font-weight:bold">${escapeHtml(longDate(data.date))}</p>`,
    ...sections.flatMap(([title, items]) =>
      items.length
        ? [
            `<p style="margin:16px 0 4px;font-weight:bold">${escapeHtml(title)}</p>`,
            `<ul style="margin:0;padding-left:20px">${items.map(htmlItem).join("")}</ul>`,
          ]
        : [],
    ),
    total ? "" : "<p>Tidak ada agenda, to-do, atau task untuk hari ini.</p>",
    `<p style="margin-top:20px"><a href="${escapeHtml(data.appUrl)}/overview" style="color:#4f46e5">Buka Akasha</a></p>`,
    `<p style="color:#6b7280;font-size:12px">Email ini dikirim karena ringkasan harian dinyalakan di Akasha (Pengaturan → Akun Tersambung).</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

/** Pesan galat SMTP → kalimat yang bisa ditindaklanjuti user. */
export function smtpErrorMessage(error: unknown) {
  const e = error as { code?: string; responseCode?: number; message?: string };
  if (e.code === "EAUTH" || e.responseCode === 535)
    return "Login SMTP ditolak. Periksa alamat & kata sandi (Gmail wajib Sandi Aplikasi).";
  if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || e.code === "ESOCKET")
    return "Server SMTP tidak bisa dihubungi. Periksa server & port.";
  if (e.code === "EENVELOPE") return "Alamat penerima ditolak server SMTP.";
  return `Pengiriman gagal: ${String(e.message ?? error).slice(0, 200)}`;
}
