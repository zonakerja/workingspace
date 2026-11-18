/**
 * Kotak masuk email (docs/AKUN-TERSAMBUNG.md tahap 1). Logika murni, diuji di inbox-logic.spec.ts: pengaturan IMAP per penyedia,
 * petunjuk otomatis tanpa AI (tagihan / jadwal, nominal, tanggal), dan usulan to-do / agenda dari satu email.
 */
import type { MailProvider } from "./mail-logic";

const IMAP_PORTS = [993, 143] as const;
export const INBOX_DAYS = [3, 7, 14, 30, 60] as const;
/** Maks. email yang diambil sekali sinkron (sisanya menyusul pada sinkron berikutnya). */
export const SYNC_BATCH = 100;
/** Maks. email disimpan per akun (yang tertua dibuang, kecuali yang sudah dijadikan to-do/agenda). */
export const MAX_MESSAGES_PER_ACCOUNT = 2000;
const MAX_BODY_CHARS = 60_000;
/** Selang sinkron otomatis per akun. */
export const SYNC_INTERVAL_MS = 10 * 60_000;

const IMAP_PRESETS: Partial<Record<MailProvider, { host: string; port: number }>> = {
  gmail: { host: "imap.gmail.com", port: 993 },
};

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Pengaturan IMAP dari preset / isian. Mengembalikan pesan galat bila tidak valid. */
export function resolveImap(
  provider: MailProvider,
  input: { imapHost?: string | null; imapPort?: number | null },
  options: { isPrivate: (host: string) => boolean; production: boolean },
): { host: string; port: number; secure: boolean } | string {
  const preset = IMAP_PRESETS[provider];
  const host = (preset?.host ?? input.imapHost ?? "").trim().toLowerCase();
  if (!host || !HOST.test(host)) return "Server IMAP tidak valid.";
  if (options.production && options.isPrivate(host)) return "Server IMAP harus alamat publik.";
  const port = preset?.port ?? input.imapPort ?? 993;
  if (!(IMAP_PORTS as readonly number[]).includes(port)) return "Port IMAP harus 993 atau 143.";
  return { host, port, secure: port === 993 };
}

type HintKind = "bill" | "schedule" | "none";

export interface MailHints {
  kind: HintKind;
  /** Nominal rupiah terbesar yang disebut (tagihan) */
  amount?: number;
  /** YYYY-MM-DD: jatuh tempo (tagihan) atau tanggal acara (jadwal) */
  date?: string;
  /** HH:mm (jadwal) */
  time?: string;
  /** Kata kunci yang ditemukan, untuk penjelasan di UI */
  matched: string[];
}

const BILL_WORDS = [
  "tagihan",
  "jatuh tempo",
  "invoice",
  "pembayaran",
  "bayar sebelum",
  "batas pembayaran",
  "virtual account",
  "total tagihan",
  "billing",
  "payment due",
  "amount due",
  "angsuran",
  "cicilan",
  "iuran",
];
const SCHEDULE_WORDS = [
  "undangan",
  "rapat",
  "meeting",
  "zoom",
  "google meet",
  "teams",
  "jadwal",
  "agenda",
  "webinar",
  "pukul",
  "invitation",
  "acara",
  "kegiatan",
];

const MONTHS: Record<string, number> = {
  januari: 1,
  jan: 1,
  january: 1,
  februari: 2,
  feb: 2,
  pebruari: 2,
  february: 2,
  maret: 3,
  mar: 3,
  march: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  jun: 6,
  june: 6,
  juli: 7,
  jul: 7,
  july: 7,
  agustus: 8,
  agu: 8,
  agt: 8,
  aug: 8,
  august: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  oct: 10,
  october: 10,
  november: 11,
  nov: 11,
  nopember: 11,
  desember: 12,
  des: 12,
  dec: 12,
  december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Semua tanggal yang disebut di teks (urutan kemunculan). Tahun tanpa ditulis = tahun email. */
export function findDates(text: string, refYear: number): string[] {
  const out: { at: number; ymd: string }[] = [];
  const lower = text.toLowerCase();
  const named = /(\d{1,2})\s+([a-z]{3,9})\.?\s*(\d{4})?/g;
  for (const m of lower.matchAll(named)) {
    const month = MONTHS[m[2]];
    if (!month) continue;
    const ymd = validDate(m[3] ? Number(m[3]) : refYear, month, Number(m[1]));
    if (ymd) out.push({ at: m.index ?? 0, ymd });
  }
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const ymd = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (ymd) out.push({ at: m.index ?? 0, ymd });
  }
  for (const m of lower.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    // Format Indonesia: hari/bulan/tahun
    const ymd = validDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (ymd) out.push({ at: m.index ?? 0, ymd });
  }
  return out.sort((a, b) => a.at - b.at).map((d) => d.ymd);
}

/** Nominal rupiah: "Rp 1.250.000", "Rp1.250.000,00", "IDR 1,250,000.00". */
export function findAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(?:rp\.?|idr)\s?([\d.,]+)/gi)) {
    let raw = m[1].replace(/[.,]$/, "");
    // Pisahkan desimal 2 digit di akhir (",00" / ".00")
    raw = raw.replace(/[.,]\d{2}$/, (dec) => (raw.length - dec.length > 3 ? "" : dec));
    const digits = raw.replace(/[.,]/g, "");
    const value = Number(digits);
    if (Number.isFinite(value) && value >= 1000 && value < 1e13) out.push(value);
  }
  return out;
}

/** Jam acara: "pukul 09.00", "jam 13:30", "09:00 WIB". */
export function findTime(text: string): string | undefined {
  const m =
    /(?:pukul|jam|at)\s*(\d{1,2})[.:](\d{2})/i.exec(text) ?? /\b(\d{1,2})[.:](\d{2})\s*(?:wib|wita|wit)\b/i.exec(text);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : undefined;
}

/**
 * Petunjuk otomatis tanpa AI. Tagihan menang bila ada kata tagihan + nominal; jadwal bila ada kata jadwal + tanggal.
 * Tanggal yang dipilih = tanggal pertama yang tidak sebelum tanggal email (jatuh tempo / acara biasanya di depan).
 */
export function detectHints(subject: string, body: string, sentAt: Date): MailHints {
  const text = `${subject}\n${body.slice(0, 8000)}`;
  const lower = text.toLowerCase();
  const sentYmd = sentAt.toISOString().slice(0, 10);
  const dates = findDates(text, sentAt.getUTCFullYear()).filter((d) => d >= sentYmd);
  const billMatched = BILL_WORDS.filter((w) => lower.includes(w));
  const scheduleMatched = SCHEDULE_WORDS.filter((w) => lower.includes(w));
  const amounts = findAmounts(text);
  if (billMatched.length && amounts.length) {
    return { kind: "bill", amount: Math.max(...amounts), date: dates[0], matched: billMatched };
  }
  if (scheduleMatched.length && dates.length) {
    return { kind: "schedule", date: dates[0], time: findTime(text), matched: scheduleMatched };
  }
  return { kind: "none", matched: [] };
}

const formatRupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Usulan to-do dari email: judul, tanggal (YYYY-MM-DD), prioritas. */
export function suggestTodo(
  message: { subject: string; fromName?: string | null; fromAddress: string },
  hints: MailHints,
  today: string,
) {
  const from = message.fromName || message.fromAddress;
  const subject = message.subject.trim() || "(tanpa subjek)";
  if (hints.kind === "bill") {
    const amount = hints.amount ? ` ${formatRupiah(hints.amount)}` : "";
    return {
      title: `Bayar tagihan${amount}: ${subject}`.slice(0, 200),
      date: hints.date && hints.date >= today ? hints.date : today,
      priority: "high" as const,
    };
  }
  return {
    title: `Tindak lanjuti email ${from}: ${subject}`.slice(0, 200),
    date: hints.date ?? today,
    priority: "medium" as const,
  };
}

/** Usulan agenda dari email jadwal. */
export function suggestAgenda(message: { subject: string }, hints: MailHints, today: string) {
  return {
    title: message.subject.trim().slice(0, 200) || "Agenda dari email",
    startDate: hints.date ?? today,
    startTime: hints.time ?? "",
  };
}

/** Cuplikan satu baris untuk daftar. */
export function snippetOf(text: string, max = 200) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Potong isi email; balasan kutipan panjang ("On … wrote:" / baris ">") dibuang lebih dulu. */
export function trimBody(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^(on .+ wrote:|pada .+ menulis:)$/i.test(l.trim()));
  const kept = (cut > 3 ? lines.slice(0, cut) : lines).filter((l) => !/^>{2,}/.test(l));
  const joined = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return joined.length > MAX_BODY_CHARS ? `${joined.slice(0, MAX_BODY_CHARS)}\n…(dipotong)` : joined;
}

/** Galat IMAP → kalimat yang bisa ditindaklanjuti. */
export function imapErrorMessage(error: unknown) {
  const e = error as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (e.authenticationFailed || /auth|login|credentials/i.test(e.responseText ?? ""))
    return "Login IMAP ditolak. Periksa sandi (Gmail wajib Sandi Aplikasi) dan pastikan IMAP aktif di pengaturan email.";
  if (e.code === "ETIMEDOUT" || e.code === "ECONNREFUSED" || e.code === "ENOTFOUND")
    return "Server IMAP tidak bisa dihubungi. Periksa server & port.";
  return `Sinkron kotak masuk gagal: ${String(e.responseText ?? e.message ?? error).slice(0, 200)}`;
}
