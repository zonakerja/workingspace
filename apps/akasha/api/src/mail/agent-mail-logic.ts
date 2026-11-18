/**
 * Alat agen untuk email & kalender (docs/AKUN-TERSAMBUNG.md tahap 3). Logika murni, diuji di agent-mail-logic.spec.ts: waktu luang dari
 * agenda satu hari, dan pemeriksaan permintaan kirim email dari agen.
 */
import { isEmail } from "./mail-logic";

export const SEND_EMAIL_KIND = "send_email";
const MAX_AGENT_RECIPIENTS = 10;
const MAX_AGENT_BODY = 20_000;

const toMin = (hm: string) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export interface BusyItem {
  title: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
}

/**
 * Celah kosong di antara agenda berjam pada satu hari (jam kerja `from`–`to`, minimal `duration` menit). Agenda tanpa jam selesai
 * dianggap 1 jam; agenda sepanjang hari tidak mengisi jam (dilaporkan terpisah).
 */
export function freeSlots(items: BusyItem[], options: { from?: string; to?: string; duration: number }) {
  const dayStart = toMin(options.from ?? "08:00") ?? 480;
  const dayEnd = toMin(options.to ?? "17:00") ?? 1020;
  const busy = items
    .filter((i) => !i.allDay)
    .map((i) => {
      const start = toMin(i.startTime ?? "");
      if (start === null) return null;
      const end = toMin(i.endTime ?? "");
      return { start, end: end !== null && end > start ? end : start + 60, title: i.title };
    })
    .filter((b): b is { start: number; end: number; title: string } => !!b)
    .sort((a, b) => a.start - b.start);
  const slots: { start: string; end: string; minutes: number }[] = [];
  let cursor = dayStart;
  for (const b of busy) {
    if (b.start - cursor >= options.duration && b.start > cursor)
      slots.push({
        start: toHm(cursor),
        end: toHm(Math.min(b.start, dayEnd)),
        minutes: Math.min(b.start, dayEnd) - cursor,
      });
    cursor = Math.max(cursor, b.end);
    if (cursor >= dayEnd) break;
  }
  if (dayEnd - cursor >= options.duration)
    slots.push({ start: toHm(cursor), end: toHm(dayEnd), minutes: dayEnd - cursor });
  return {
    slots: slots.filter((s) => s.minutes >= options.duration),
    busy: busy.map((b) => ({ title: b.title, start: toHm(b.start), end: toHm(b.end) })),
    allDay: items.filter((i) => i.allDay).map((i) => i.title),
  };
}

/** Periksa isi permintaan kirim email dari agen. Mengembalikan pesan galat atau isi yang sudah dirapikan. */
export function checkAgentEmail(input: { to: string[]; subject: string; body: string }) {
  const to = [...new Set(input.to.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return { error: "Penerima wajib diisi." };
  if (to.length > MAX_AGENT_RECIPIENTS) return { error: `Maksimal ${MAX_AGENT_RECIPIENTS} penerima per email.` };
  const bad = to.find((t) => !isEmail(t));
  if (bad) return { error: `Alamat tidak valid: ${bad}` };
  const subject = input.subject.trim();
  if (!subject) return { error: "Subjek wajib diisi." };
  const body = input.body.trim();
  if (!body) return { error: "Isi email wajib diisi." };
  if (body.length > MAX_AGENT_BODY) return { error: `Isi email maksimal ${MAX_AGENT_BODY} karakter.` };
  return { to, subject: subject.slice(0, 300), body };
}

export const sendEmailTitle = (to: string[], subject: string) =>
  `Kirim email ke ${to[0]}${to.length > 1 ? ` (+${to.length - 1})` : ""}: ${subject}`.slice(0, 200);
