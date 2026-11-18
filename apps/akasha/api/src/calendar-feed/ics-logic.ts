/**
 * Langganan kalender ICS (docs/AKUN-TERSAMBUNG.md tahap 0). Logika murni, diuji di ics-logic.spec.ts: payload agenda / to-do / task
 * Akasha → acara iCalendar (RFC 5545) yang dilanggan Google Calendar, Outlook, dan kalender HP.
 */

export const FEED_TIMEZONES = { "Asia/Jakarta": 7, "Asia/Makassar": 8, "Asia/Jayapura": 9 } as const;
export type FeedTimezone = keyof typeof FEED_TIMEZONES;
export const isFeedTimezone = (tz: unknown): tz is FeedTimezone =>
  typeof tz === "string" && Object.hasOwn(FEED_TIMEZONES, tz);

export interface FeedInclude {
  agenda: boolean;
  tasks: boolean;
  todos: boolean;
}
const DEFAULT_INCLUDE: FeedInclude = { agenda: true, tasks: true, todos: true };

export function normalizeInclude(raw: unknown): FeedInclude {
  const v = (raw ?? {}) as Partial<Record<keyof FeedInclude, unknown>>;
  return {
    agenda: typeof v.agenda === "boolean" ? v.agenda : DEFAULT_INCLUDE.agenda,
    tasks: typeof v.tasks === "boolean" ? v.tasks : DEFAULT_INCLUDE.tasks,
    todos: typeof v.todos === "boolean" ? v.todos : DEFAULT_INCLUDE.todos,
  };
}

/** Rentang feed: 60 hari ke belakang s.d. 365 hari ke depan (ukuran berkas tetap kecil). */
export const FEED_PAST_DAYS = 60;
export const FEED_FUTURE_DAYS = 365;

export interface FeedEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** HH:mm; kosong = sepanjang hari */
  startTime?: string;
  /** YYYY-MM-DD (inklusif) */
  endDate?: string;
  endTime?: string;
  location?: string;
  description?: string;
  url?: string;
  updatedAt: Date;
}

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ymd = (v: unknown) => {
  const s = str(v).slice(0, 10);
  return YMD.test(s) ? s : "";
};
const hm = (v: unknown) => {
  const s = str(v).slice(0, 5);
  return HM.test(s) ? s : "";
};

/** "Thu Oct 08 2026" (format todo Akasha) atau YYYY-MM-DD → YYYY-MM-DD. */
export function looseDate(v: unknown): string {
  const direct = ymd(v);
  if (direct) return direct;
  const s = str(v);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Agenda Akasha → acara. Agenda tanpa jam = sepanjang hari; multi-hari ikut tanggal selesai. */
export function scheduleEvent(
  id: string,
  p: Payload,
  updatedAt: Date,
  appUrl: string,
  locked = false,
): FeedEvent | null {
  const startDate = ymd(p.startDate) || ymd(p.date);
  if (!startDate) return null;
  const allDay = p.isAllDay === true;
  const startTime = allDay ? "" : hm(p.startTime) || hm(p.time);
  const endDate = ymd(p.endDate);
  const links = str(p.media)
    .split(/\s*\n\s*/)
    .filter((l) => /^https?:\/\//i.test(l));
  const description = locked
    ? ""
    : [str(p.type) && `Jenis: ${str(p.type)}`, str(p.description), links.length ? `Tautan:\n${links.join("\n")}` : ""]
        .filter(Boolean)
        .join("\n\n");
  return {
    uid: `schedule-${id}@akasha`,
    title: str(p.title) || "Agenda",
    startDate,
    startTime: startTime || undefined,
    endDate: endDate && endDate >= startDate ? endDate : undefined,
    endTime: startTime ? hm(p.endTime) || undefined : undefined,
    location: locked ? undefined : str(p.location) || undefined,
    description: description || undefined,
    url: appUrl ? `${appUrl}/overview?agenda=${encodeURIComponent(id)}` : undefined,
    updatedAt,
  };
}

/** To-do → acara sepanjang hari pada tanggalnya (selesai diberi tanda ✓). */
export function todoEvent(id: string, p: Payload, updatedAt: Date, appUrl: string): FeedEvent | null {
  const date = looseDate(p.date);
  if (!date) return null;
  const done = p.completed === true;
  return {
    uid: `todo-${id}@akasha`,
    title: `${done ? "✓" : "☐"} ${str(p.title) || "To-do"}`,
    startDate: date,
    url: appUrl ? `${appUrl}/overview?todo=${encodeURIComponent(id)}` : undefined,
    updatedAt,
  };
}

/** Action/Task Working Space → acara sepanjang hari pada tenggatnya. */
export function taskEvent(
  id: string,
  p: Payload,
  updatedAt: Date,
  appUrl: string,
  parent?: string,
  locked = false,
): FeedEvent | null {
  const date = ymd(p.dueDate);
  if (!date) return null;
  const done = p.completed === true;
  const description = locked
    ? ""
    : [parent && `Bagian dari: ${parent}`, str(p.description)].filter(Boolean).join("\n\n");
  return {
    uid: `task-${id}@akasha`,
    title: `${done ? "✓" : "◆"} ${str(p.title) || "Tugas"}`,
    startDate: date,
    description: description || undefined,
    url: appUrl ? `${appUrl}/overview?task=${encodeURIComponent(id)}` : undefined,
    updatedAt,
  };
}

/** Teks iCalendar: \ ; , dan baris baru di-escape (RFC 5545 §3.3.11). */
export function escapeText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lipat baris > 75 oktet (RFC 5545 §3.1) tanpa memotong karakter UTF-8. */
export function foldLine(line: string) {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74; // baris lanjutan diawali satu spasi
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const compactDate = (date: string) => date.replace(/-/g, "");
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/** Tanggal + jam lokal zona `tz` → waktu UTC format iCalendar (YYYYMMDDTHHMMSSZ). Indonesia tanpa jam musim panas. */
export function localToUtc(date: string, time: string, tz: FeedTimezone) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - FEED_TIMEZONES[tz] * 60);
  return stamp(d);
}

function eventLines(e: FeedEvent, tz: FeedTimezone) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(e.updatedAt)}`,
    `LAST-MODIFIED:${stamp(e.updatedAt)}`,
  ];
  if (e.startTime) {
    const endDate = e.endDate ?? e.startDate;
    lines.push(`DTSTART:${localToUtc(e.startDate, e.startTime, tz)}`);
    if (e.endTime && (endDate > e.startDate || e.endTime > e.startTime)) {
      lines.push(`DTEND:${localToUtc(endDate, e.endTime, tz)}`);
    } else if (endDate > e.startDate) {
      lines.push(`DTEND:${localToUtc(endDate, e.startTime, tz)}`);
    } else {
      lines.push("DURATION:PT1H");
    }
  } else {
    // Sepanjang hari: DTEND eksklusif (hari setelah tanggal terakhir)
    lines.push(`DTSTART;VALUE=DATE:${compactDate(e.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDays(e.endDate ?? e.startDate, 1))}`);
    lines.push("TRANSP:TRANSPARENT");
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  const description = [e.description, e.url && `Buka di Akasha: ${e.url}`].filter(Boolean).join("\n\n");
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  lines.push("END:VEVENT");
  return lines;
}

/** Berkas ICS utuh (CRLF, baris dilipat). */
export function buildCalendar(events: FeedEvent[], options: { name: string; timezone: FeedTimezone }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//workingspace.id//Akasha//ID",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name)}`,
    `X-WR-TIMEZONE:${options.timezone}`,
    // Saran interval pembaruan untuk aplikasi kalender yang menghormatinya (Google memakai jadwalnya sendiri)
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((e) => eventLines(e, options.timezone)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
