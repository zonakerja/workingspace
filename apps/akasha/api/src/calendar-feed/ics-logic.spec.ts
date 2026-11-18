import { describe, expect, it } from "vitest";
import {
  addDays,
  buildCalendar,
  escapeText,
  foldLine,
  localToUtc,
  looseDate,
  normalizeInclude,
  scheduleEvent,
  taskEvent,
  todoEvent,
} from "./ics-logic";

const at = new Date("2026-11-17T01:02:03.000Z");
const app = "https://akasha.workingspace.id";

describe("langganan kalender ICS", () => {
  it("escape teks & lipat baris > 75 oktet tanpa memotong huruf UTF-8", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const line of folded.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });

  it("jam lokal WIB/WITA/WIT → UTC", () => {
    expect(localToUtc("2026-11-17", "09:30", "Asia/Jakarta")).toBe("20261117T023000Z");
    expect(localToUtc("2026-11-17", "06:00", "Asia/Jayapura")).toBe("20261116T210000Z");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(looseDate("Thu Oct 08 2026")).toBe("2026-10-08");
  });

  it("agenda berjam, multi-hari sepanjang hari, terkunci tanpa isi", () => {
    const timed = scheduleEvent(
      "s1",
      {
        title: "Rapat",
        startDate: "2026-11-18",
        startTime: "09:00",
        endTime: "11:00",
        location: "Aula",
        media: "https://meet.x/y",
      },
      at,
      app,
    )!;
    const allDay = scheduleEvent("s2", { title: "Dinas", startDate: "2026-11-20", endDate: "2026-11-22" }, at, app)!;
    const locked = scheduleEvent("s3", { title: "Privat", startDate: "2026-11-19", location: "Rumah" }, at, app, true)!;
    const ics = buildCalendar([timed, allDay, locked], { name: "Akasha", timezone: "Asia/Jakarta" });
    expect(ics).toContain("DTSTART:20261118T020000Z");
    expect(ics).toContain("DTEND:20261118T040000Z");
    expect(ics).toContain("LOCATION:Aula");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261120");
    expect(ics).toContain("DTEND;VALUE=DATE:20261123");
    expect(ics).toContain("UID:schedule-s3@akasha");
    expect(ics).not.toContain("Rumah");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("agenda berjam tanpa jam selesai = 1 jam; tanpa tanggal dilewati", () => {
    const e = scheduleEvent("s", { title: "X", startDate: "2026-11-18", startTime: "08:00" }, at, app)!;
    expect(buildCalendar([e], { name: "A", timezone: "Asia/Jakarta" })).toContain("DURATION:PT1H");
    expect(scheduleEvent("s", { title: "X" }, at, app)).toBeNull();
  });

  it("to-do & task jadi acara sepanjang hari dengan tanda selesai", () => {
    expect(todoEvent("t", { title: "Bayar listrik", date: "Wed Nov 18 2026", completed: true }, at, app)).toMatchObject(
      {
        title: "✓ Bayar listrik",
        startDate: "2026-11-18",
      },
    );
    expect(taskEvent("k", { title: "Laporan", dueDate: "2026-11-19" }, at, app, "Project A")).toMatchObject({
      title: "◆ Laporan",
      description: "Bagian dari: Project A",
    });
  });

  it("pilihan isi feed: bawaan semua menyala", () => {
    expect(normalizeInclude({ todos: false })).toEqual({ agenda: true, tasks: true, todos: false });
  });
});
