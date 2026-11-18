import { describe, expect, it } from "vitest";
import { buildDigest, digestDue, isEmail, localNow, longDate, resolveSmtp, smtpErrorMessage } from "./mail-logic";

const opts = { isPrivate: (h: string) => h === "localhost" || h.startsWith("10."), production: true };

describe("akun email tersambung", () => {
  it("preset Gmail mengisi server; Outlook ditolak (butuh OAuth)", () => {
    expect(resolveSmtp({ provider: "gmail", address: "Saya@Gmail.com" }, opts)).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "saya@gmail.com",
    });
    expect(resolveSmtp({ provider: "outlook", address: "a@outlook.com" }, opts)).toMatch(/Microsoft/);
  });

  it("SMTP lain: host privat ditolak di production, port dibatasi, 587 = STARTTLS", () => {
    expect(resolveSmtp({ provider: "custom", address: "a@b.id", smtpHost: "localhost", smtpPort: 587 }, opts)).toMatch(
      /publik/,
    );
    expect(resolveSmtp({ provider: "custom", address: "a@b.id", smtpHost: "mail.b.id", smtpPort: 22 }, opts)).toMatch(
      /Port/,
    );
    expect(
      resolveSmtp({ provider: "custom", address: "a@b.id", smtpHost: "mail.b.id", smtpPort: 587 }, opts),
    ).toMatchObject({
      secure: false,
      user: "a@b.id",
    });
    expect(resolveSmtp({ provider: "custom", address: "bukan-email", smtpHost: "mail.b.id" }, opts)).toMatch(/email/);
    expect(isEmail("x@y.co")).toBe(true);
  });

  it("ringkasan harian jatuh tempo sekali per hari lokal", () => {
    const acc = { digestEnabled: true, digestTime: "06:30", digestTimezone: "Asia/Jakarta", digestLastSent: null };
    expect(localNow(new Date("2026-11-16T23:40:00Z"), "Asia/Jakarta")).toEqual({ date: "2026-11-17", time: "06:40" });
    expect(digestDue(acc, new Date("2026-11-16T23:00:00Z"))).toBeNull(); // 06.00 WIB
    expect(digestDue(acc, new Date("2026-11-16T23:40:00Z"))).toBe("2026-11-17");
    expect(digestDue({ ...acc, digestLastSent: "2026-11-17" }, new Date("2026-11-17T05:00:00Z"))).toBeNull();
    expect(digestDue({ ...acc, digestEnabled: false }, new Date("2026-11-17T05:00:00Z"))).toBeNull();
  });

  it("isi ringkasan: bagian kosong dilewati, HTML di-escape", () => {
    const d = buildDigest({
      date: "2026-11-17",
      name: "Yusuf",
      agenda: [{ title: "Rapat <BMN>", note: "09:00–10:00", url: "https://a/x" }],
      todos: [],
      tasks: [],
      overdue: [{ title: "Laporan", note: "Terlambat 2 hari" }],
      appUrl: "https://a",
    });
    expect(longDate("2026-11-17")).toBe("Selasa, 17 November 2026");
    expect(d.subject).toContain("2 butir");
    expect(d.text).toContain("- Rapat <BMN> (09:00–10:00)");
    expect(d.text).not.toContain("To-do hari ini");
    expect(d.html).toContain("Rapat &lt;BMN&gt;");
    expect(smtpErrorMessage({ code: "EAUTH" })).toMatch(/Sandi Aplikasi/);
  });
});
