/**
 * Aturan tugas terjadwal Akai (6b.8, docs/AKAI.md §8). Logika murni, diuji di schedule-logic.spec.ts: bentuk jadwal, zona waktu
 * Indonesia (tanpa musim panas → selisih tetap), waktu jalan berikutnya, dan keterangan jadwal.
 */

export const SCHEDULE_LIMITS = { maxTasks: 20, nameChars: 100, promptChars: 8000 } as const;

/** Zona waktu yang didukung (selisih jam dari UTC). */
export const TIMEZONES: Record<string, { offset: number; label: string }> = {
  "Asia/Jakarta": { offset: 7, label: "WIB" },
  "Asia/Makassar": { offset: 8, label: "WITA" },
  "Asia/Jayapura": { offset: 9, label: "WIT" },
};

export type ScheduleKind = "hourly" | "daily" | "weekly" | "monthly";

export interface Schedule {
  kind: ScheduleKind;
  /** "HH:mm" (jam lokal; untuk hourly hanya menitnya yang dipakai) */
  time: string;
  /** weekly: hari 0 = Minggu … 6 = Sabtu */
  days: number[];
  /** monthly: tanggal 1–28 */
  dayOfMonth: number;
  /** hourly: setiap N jam (1–24), dihitung dari tengah malam */
  everyHours: number;
}

const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Periksa & rapikan jadwal dari isian; galat = pesan untuk pemilik. */
export function validateSchedule(
  raw: unknown,
): { schedule: Schedule; error: null } | { schedule: null; error: string } {
  const fail = (error: string) => ({ schedule: null, error }) as const;
  if (!isObject(raw)) return fail("Jadwal wajib diisi.");
  const kind = raw.kind;
  if (kind !== "hourly" && kind !== "daily" && kind !== "weekly" && kind !== "monthly")
    return fail("Jenis jadwal: hourly, daily, weekly, atau monthly.");
  const time = typeof raw.time === "string" ? raw.time : "07:00";
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return fail("Jam harus format HH:mm, mis. 07:30.");
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  if (kind === "weekly" && days.length === 0) return fail("Pilih minimal satu hari.");
  const dayOfMonth = Number(raw.dayOfMonth ?? 1);
  if (kind === "monthly" && !(Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 28))
    return fail("Tanggal bulanan 1–28.");
  const everyHours = Number(raw.everyHours ?? 1);
  if (kind === "hourly" && !(Number.isInteger(everyHours) && everyHours >= 1 && everyHours <= 24))
    return fail("Setiap N jam: 1–24.");
  return {
    schedule: {
      kind,
      time,
      days: kind === "weekly" ? days : [],
      dayOfMonth: kind === "monthly" ? dayOfMonth : 1,
      everyHours: kind === "hourly" ? everyHours : 1,
    },
    error: null,
  };
}

const offsetOf = (timezone: string) => (TIMEZONES[timezone] ?? TIMEZONES["Asia/Jakarta"]).offset;

/** Waktu jalan berikutnya setelah `after` (UTC), atau null bila tidak ditemukan dalam 400 hari. */
export function nextRun(schedule: Schedule, timezone: string, after: Date): Date | null {
  const offsetMs = offsetOf(timezone) * 3_600_000;
  const [hh, mm] = schedule.time.split(":").map(Number);
  // "Lokal" = waktu UTC digeser selisih zona; field UTC-nya dibaca sebagai jam lokal
  const local = new Date(after.getTime() + offsetMs);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let d = 0; d < 400; d++) {
    const day = new Date(start + d * 86_400_000);
    let hours: number[] = [];
    if (schedule.kind === "hourly") for (let h = 0; h < 24; h += schedule.everyHours) hours.push(h);
    else if (schedule.kind === "daily") hours = [hh];
    else if (schedule.kind === "weekly") hours = schedule.days.includes(day.getUTCDay()) ? [hh] : [];
    else hours = day.getUTCDate() === schedule.dayOfMonth ? [hh] : [];
    for (const h of hours) {
      const at = day.getTime() + h * 3_600_000 + mm * 60_000 - offsetMs;
      if (at > after.getTime()) return new Date(at);
    }
  }
  return null;
}

/** Keterangan jadwal, mis. "Setiap Senin, Rabu pukul 07:30 WIB". */
export function describeSchedule(schedule: Schedule, timezone: string) {
  const zone = (TIMEZONES[timezone] ?? TIMEZONES["Asia/Jakarta"]).label;
  const minute = schedule.time.slice(3);
  switch (schedule.kind) {
    case "hourly":
      return schedule.everyHours === 1
        ? `Setiap jam pada menit ${minute}`
        : `Setiap ${schedule.everyHours} jam pada menit ${minute} (${zone})`;
    case "daily":
      return `Setiap hari pukul ${schedule.time} ${zone}`;
    case "weekly":
      return `Setiap ${schedule.days.map((d) => DAY_NAMES[d]).join(", ")} pukul ${schedule.time} ${zone}`;
    default:
      return `Setiap tanggal ${schedule.dayOfMonth} pukul ${schedule.time} ${zone}`;
  }
}

/** Tanggal & jam lokal untuk judul percakapan hasil, mis. "17 Nov 2026 07.30". */
export function runLabel(at: Date, timezone: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONES[timezone] ? timezone : "Asia/Jakarta",
  }).format(at);
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Isi email hasil tugas (teks + HTML sederhana; jawaban Markdown ditampilkan apa adanya). */
export function resultMail(input: {
  taskName: string;
  when: string;
  answer: string;
  error: string | null;
  link: string | null;
}) {
  const head = input.error
    ? `Tugas terjadwal "${input.taskName}" gagal dijalankan (${input.when}).`
    : `Hasil tugas terjadwal "${input.taskName}" (${input.when}).`;
  const body = input.error ? `Penyebab: ${input.error}` : input.answer;
  const link = input.link ? `\n\nBuka di Akai: ${input.link}` : "";
  const text = `${head}\n\n${body}${link}\n\n— Akai · workingspace.id`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">
<p style="margin:0 0 12px"><strong>${escapeHtml(head)}</strong></p>
<div style="white-space:pre-wrap;border:1px solid #e2e8f0;border-radius:12px;padding:14px">${escapeHtml(body)}</div>
${input.link ? `<p style="margin:14px 0 0"><a href="${escapeHtml(input.link)}">Buka di Akai</a></p>` : ""}
<p style="margin:18px 0 0;color:#64748b;font-size:12px">Akai · workingspace.id — email otomatis, jangan dibalas.</p></div>`;
  return { subject: `[Akai] ${input.error ? "Gagal: " : ""}${input.taskName}`, text, html };
}
