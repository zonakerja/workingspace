import { describe, expect, it } from "vitest";
import {
  backupFileName,
  expiryDue,
  normalizeBackupSettings,
  runFolderName,
  runsToPrune,
  scheduleDue,
} from "./backup-logic";

const DAY = 24 * 60 * 60_000;
const now = new Date("2026-11-19T02:30:00Z");

describe("backup-logic", () => {
  it("pengaturan bawaan & batas", () => {
    expect(normalizeBackupSettings(null)).toEqual({
      accountId: null,
      schedule: "off",
      keep: 5,
      includeFiles: true,
      onExpiry: true,
      rootFolderId: null,
      filesFolderId: null,
    });
    expect(normalizeBackupSettings({ schedule: "daily", keep: 99 }).schedule).toBe("off");
    expect(normalizeBackupSettings({ keep: 99 }).keep).toBe(20);
    expect(normalizeBackupSettings({ keep: 0 }).keep).toBe(1);
  });

  it("jadwal mingguan / bulanan", () => {
    expect(scheduleDue("off", null, now)).toBe(false);
    expect(scheduleDue("weekly", null, now)).toBe(true);
    expect(scheduleDue("weekly", new Date(now.getTime() - 6 * DAY), now)).toBe(false);
    expect(scheduleDue("weekly", new Date(now.getTime() - 7 * DAY), now)).toBe(true);
    expect(scheduleDue("monthly", new Date(now.getTime() - 20 * DAY), now)).toBe(false);
  });

  it("masa akses hampir habis / sudah habis", () => {
    expect(expiryDue(null, null, now)).toBe(false);
    expect(expiryDue(new Date(now.getTime() + 10 * DAY), null, now)).toBe(false);
    expect(expiryDue(new Date(now.getTime() + 3 * DAY), null, now)).toBe(true);
    expect(expiryDue(new Date(now.getTime() - 3 * DAY), null, now)).toBe(true);
    expect(expiryDue(new Date(now.getTime() + 3 * DAY), new Date(now.getTime() - 2 * DAY), now)).toBe(false);
  });

  it("nama folder (WIB) & berkas", () => {
    expect(runFolderName(now)).toBe("Backup 2026-11-19 0930");
    expect(backupFileName("abcdef0123456789", "Surat: tugas?.pdf")).toBe("abcdef012345-Surat tugas .pdf");
  });

  it("pangkas backup lama, hanya yang berhasil dihitung", () => {
    const runs = [
      { id: "a", status: "done" },
      { id: "b", status: "failed" },
      { id: "c", status: "done" },
      { id: "d", status: "done" },
    ];
    expect(runsToPrune(runs, 2).map((r) => r.id)).toEqual(["d"]);
  });
});
