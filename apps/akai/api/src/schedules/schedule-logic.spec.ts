import { describe, expect, it } from "vitest";
import { describeSchedule, nextRun, resultMail, validateSchedule } from "./schedule-logic";

const at = (iso: string) => new Date(iso);
const sched = (raw: Record<string, unknown>) => {
  const r = validateSchedule(raw);
  if (!r.schedule) throw new Error(r.error);
  return r.schedule;
};

describe("schedule-logic", () => {
  it("validasi jadwal", () => {
    expect(validateSchedule({ kind: "daily", time: "7:00" }).error).toMatch(/HH:mm/);
    expect(validateSchedule({ kind: "weekly", time: "07:00", days: [] }).error).toMatch(/hari/);
    expect(validateSchedule({ kind: "monthly", time: "07:00", dayOfMonth: 31 }).error).toMatch(/1–28/);
    expect(validateSchedule({ kind: "yearly" }).error).toMatch(/Jenis/);
    expect(sched({ kind: "weekly", time: "08:15", days: [5, 1, 1, 9] }).days).toEqual([1, 5]);
  });

  it("harian WIB: 07:00 WIB = 00:00 UTC; sudah lewat → besok", () => {
    const s = sched({ kind: "daily", time: "07:00" });
    expect(nextRun(s, "Asia/Jakarta", at("2026-11-16T23:00:00Z"))?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(nextRun(s, "Asia/Jakarta", at("2026-11-17T00:00:00Z"))?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(nextRun(s, "Asia/Jayapura", at("2026-11-16T23:00:00Z"))?.toISOString()).toBe("2026-11-17T22:00:00.000Z");
  });

  it("mingguan, bulanan, tiap N jam", () => {
    // 17 Nov 2026 = Selasa
    const weekly = sched({ kind: "weekly", time: "09:30", days: [1, 5] });
    expect(nextRun(weekly, "Asia/Jakarta", at("2026-11-17T03:00:00Z"))?.toISOString()).toBe("2026-11-20T02:30:00.000Z");
    const monthly = sched({ kind: "monthly", time: "06:00", dayOfMonth: 1 });
    expect(nextRun(monthly, "Asia/Jakarta", at("2026-11-17T03:00:00Z"))?.toISOString()).toBe(
      "2026-11-30T23:00:00.000Z",
    );
    const hourly = sched({ kind: "hourly", time: "00:15", everyHours: 6 });
    // 10:20 WIB → berikutnya 12:15 WIB = 05:15 UTC
    expect(nextRun(hourly, "Asia/Jakarta", at("2026-11-17T03:20:00Z"))?.toISOString()).toBe("2026-11-17T05:15:00.000Z");
  });

  it("keterangan & email", () => {
    expect(describeSchedule(sched({ kind: "weekly", time: "07:30", days: [1, 3] }), "Asia/Makassar")).toBe(
      "Setiap Senin, Rabu pukul 07:30 WITA",
    );
    const mail = resultMail({
      taskName: "Rangkum",
      when: "17 Nov",
      answer: "<b>isi</b>",
      error: null,
      link: "https://a.id/chat/1",
    });
    expect(mail.subject).toBe("[Akai] Rangkum");
    expect(mail.html).toContain("&lt;b&gt;isi&lt;/b&gt;");
    expect(mail.text).toContain("Buka di Akai: https://a.id/chat/1");
    expect(resultMail({ taskName: "R", when: "x", answer: "", error: "kuota", link: null }).subject).toBe(
      "[Akai] Gagal: R",
    );
  });
});
