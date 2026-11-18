/**
 * Kalender dua arah (docs/AKUN-TERSAMBUNG.md tahap 2). Logika murni, diuji di calendar-sync-logic.spec.ts: agenda Akasha ↔ acara
 * Google Calendar / Outlook (Microsoft Graph), sidik jari isi, dan aturan siapa yang menang saat keduanya berubah.
 */
import { addDays, FEED_TIMEZONES, type FeedTimezone } from "../calendar-feed/ics-logic";

export interface AgendaFields {
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD (inklusif) */
  endDate: string;
  /** HH:mm; kosong = sepanjang hari */
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ymd = (v: unknown) => (YMD.test(str(v).slice(0, 10)) ? str(v).slice(0, 10) : "");
const hm = (v: unknown) => (HM.test(str(v).slice(0, 5)) ? str(v).slice(0, 5) : "");

/** Payload record `schedule` → isi yang disinkronkan. Null = agenda tanpa tanggal (tidak disinkron). */
export function agendaFields(p: Payload): AgendaFields | null {
  const startDate = ymd(p.startDate) || ymd(p.date);
  if (!startDate) return null;
  const allDay = p.isAllDay === true;
  const startTime = allDay ? "" : hm(p.startTime) || hm(p.time);
  const endDate = ymd(p.endDate);
  return {
    title: str(p.title) || "Agenda",
    startDate,
    endDate: endDate && endDate >= startDate ? endDate : startDate,
    startTime,
    endTime: startTime ? hm(p.endTime) : "",
    location: str(p.location),
    description: str(p.description),
  };
}

/** Sidik jari stabil isi agenda (dibandingkan untuk tahu ada perubahan lokal sejak sinkron terakhir). */
export const fieldsKey = (f: AgendaFields) =>
  [f.title, f.startDate, f.endDate, f.startTime, f.endTime, f.location, f.description].join("␟");

/** Item terkunci PIN dikirim ke kalender luar hanya judul & waktunya. */
export const lockedFields = (f: AgendaFields): AgendaFields => ({ ...f, location: "", description: "" });

const pad = (n: number) => String(n).padStart(2, "0");
const offsetHours = (tz: FeedTimezone) => FEED_TIMEZONES[tz];

/** Tanggal + jam lokal → ISO dengan offset zona (Indonesia tanpa jam musim panas). */
function localIso(date: string, time: string, tz: FeedTimezone) {
  return `${date}T${time}:00+${pad(offsetHours(tz))}:00`;
}

/** Waktu (ISO berzona / UTC) → tanggal & jam lokal zona `tz`. */
export function toLocal(iso: string, tz: FeedTimezone) {
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso.replace(/(\.\d+)$/, "")}Z`);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + offsetHours(tz) * 3_600_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function endOf(f: AgendaFields, tz: FeedTimezone) {
  if (f.endTime && (f.endDate > f.startDate || f.endTime > f.startTime)) return localIso(f.endDate, f.endTime, tz);
  if (f.endDate > f.startDate) return localIso(f.endDate, f.startTime, tz);
  // Tanpa jam selesai: 1 jam
  const d = new Date(new Date(localIso(f.startDate, f.startTime, tz)).getTime() + 3_600_000);
  const l = toLocal(d.toISOString(), tz)!;
  return localIso(l.date, l.time, tz);
}

// ---------------------------------------------------------------- Google Calendar

export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
}

export function toGoogleEvent(f: AgendaFields, tz: FeedTimezone) {
  const timed = !!f.startTime;
  return {
    summary: f.title,
    description: f.description || undefined,
    location: f.location || undefined,
    start: timed ? { dateTime: localIso(f.startDate, f.startTime, tz), timeZone: tz } : { date: f.startDate },
    end: timed ? { dateTime: endOf(f, tz), timeZone: tz } : { date: addDays(f.endDate, 1) },
  };
}

export function fromGoogleEvent(e: GoogleEvent, tz: FeedTimezone): AgendaFields | null {
  if (e.start?.date) {
    const startDate = e.start.date;
    const endExclusive = e.end?.date ?? addDays(startDate, 1);
    const endDate = addDays(endExclusive, -1);
    return {
      title: str(e.summary) || "Acara",
      startDate,
      endDate: endDate >= startDate ? endDate : startDate,
      startTime: "",
      endTime: "",
      location: str(e.location),
      description: str(e.description),
    };
  }
  const start = e.start?.dateTime ? toLocal(e.start.dateTime, tz) : null;
  if (!start) return null;
  const end = e.end?.dateTime ? toLocal(e.end.dateTime, tz) : null;
  return {
    title: str(e.summary) || "Acara",
    startDate: start.date,
    endDate: end && end.date >= start.date ? end.date : start.date,
    startTime: start.time,
    endTime: end?.time ?? "",
    location: str(e.location),
    description: str(e.description),
  };
}

// ---------------------------------------------------------------- Microsoft Graph

export interface GraphEvent {
  id: string;
  changeKey?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  lastModifiedDateTime?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  "@removed"?: unknown;
}

/** Graph menerima zona IANA; semua waktu dikirim dengan zona agenda, sepanjang hari = tengah malam ke tengah malam. */
export function toGraphEvent(f: AgendaFields, tz: FeedTimezone) {
  const timed = !!f.startTime;
  const strip = (iso: string) => iso.slice(0, 19);
  return {
    subject: f.title,
    body: { contentType: "text", content: f.description },
    location: { displayName: f.location },
    isAllDay: !timed,
    start: {
      dateTime: timed ? strip(localIso(f.startDate, f.startTime, tz)) : `${f.startDate}T00:00:00`,
      timeZone: tz,
    },
    end: { dateTime: timed ? strip(endOf(f, tz)) : `${addDays(f.endDate, 1)}T00:00:00`, timeZone: tz },
  };
}

/** Acara Graph (diminta dalam UTC) → isi agenda. Isi teks dari body text, atau bodyPreview. */
export function fromGraphEvent(e: GraphEvent, tz: FeedTimezone): AgendaFields | null {
  const description = e.body?.contentType === "text" ? str(e.body.content) : str(e.bodyPreview);
  if (e.isAllDay) {
    const startDate = str(e.start?.dateTime).slice(0, 10);
    if (!YMD.test(startDate)) return null;
    const endExclusive = str(e.end?.dateTime).slice(0, 10) || addDays(startDate, 1);
    const endDate = addDays(endExclusive, -1);
    return {
      title: str(e.subject) || "Acara",
      startDate,
      endDate: endDate >= startDate ? endDate : startDate,
      startTime: "",
      endTime: "",
      location: str(e.location?.displayName),
      description,
    };
  }
  const zoneOf = (t?: { timeZone?: string }) => (t?.timeZone && t.timeZone !== "UTC" ? t.timeZone : "UTC");
  const asIso = (t?: { dateTime?: string; timeZone?: string }) => {
    const v = str(t?.dateTime);
    if (!v) return "";
    if (zoneOf(t) === "UTC") return v;
    // Zona lain (mis. dikirim dengan zona agenda): pakai offset zona Indonesia bila dikenal
    const known = (FEED_TIMEZONES as Record<string, number>)[zoneOf(t)];
    return known !== undefined ? `${v.slice(0, 19)}+${pad(known)}:00` : v;
  };
  const start = asIso(e.start) ? toLocal(asIso(e.start), tz) : null;
  if (!start) return null;
  const end = asIso(e.end) ? toLocal(asIso(e.end), tz) : null;
  return {
    title: str(e.subject) || "Acara",
    startDate: start.date,
    endDate: end && end.date >= start.date ? end.date : start.date,
    startTime: start.time,
    endTime: end?.time ?? "",
    location: str(e.location?.displayName),
    description,
  };
}

// ---------------------------------------------------------------- Aturan sinkron

/** Payload record schedule dari isi kalender, mempertahankan key lain milik agenda yang sudah ada. */
export function mergeIntoSchedule(current: Payload | null, f: AgendaFields, id: string): Payload {
  return {
    ...(current ?? {}),
    id,
    title: f.title,
    startDate: f.startDate,
    endDate: f.endDate,
    date: f.startDate,
    startTime: f.startTime,
    endTime: f.endTime,
    isAllDay: !f.startTime,
    location: f.location,
    description: f.description,
  };
}

/**
 * Acara luar berubah sejak sinkron terakhir: terapkan ke agenda? Tidak bila agenda juga berubah di Akasha dan lebih baru
 * (agenda menang, nanti dikirim ke kalender). Agenda tidak berubah = selalu terapkan.
 */
export function shouldApplyRemote(input: {
  localChanged: boolean;
  localUpdatedAt?: Date | null;
  remoteUpdatedAt?: string | null;
}) {
  if (!input.localChanged) return true;
  const remote = input.remoteUpdatedAt ? new Date(input.remoteUpdatedAt).getTime() : NaN;
  const local = input.localUpdatedAt?.getTime() ?? NaN;
  if (Number.isNaN(remote) || Number.isNaN(local)) return false;
  return remote > local;
}

/** Jendela sinkron: 30 hari ke belakang s.d. 365 hari ke depan. */
export const SYNC_PAST_DAYS = 30;
export const SYNC_FUTURE_DAYS = 365;
export const inWindow = (date: string, today: string) =>
  date >= addDays(today, -SYNC_PAST_DAYS) && date <= addDays(today, SYNC_FUTURE_DAYS);
