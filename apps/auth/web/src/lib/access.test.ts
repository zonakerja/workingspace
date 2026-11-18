import { describe, expect, it } from "vitest";
import { accessLabel, durationLabel, passwordStrength, purposeHint } from "./access";

const now = new Date("2026-11-18T00:00:00Z");

describe("accessLabel", () => {
  it("tanpa batas", () => expect(accessLabel(null, now)).toEqual({ text: "Tanpa batas waktu", tone: "success" }));
  it("berlaku / hampir habis", () => {
    expect(accessLabel({ state: "active", expiresAt: "2027-03-01T00:00:00Z", deleteAt: null }, now).tone).toBe("info");
    expect(accessLabel({ state: "active", expiresAt: "2026-11-25T00:00:00Z", deleteAt: null }, now).tone).toBe(
      "warning",
    );
  });
  it("baca saja", () => {
    const l = accessLabel(
      { state: "read_only", expiresAt: "2026-11-01T00:00:00Z", deleteAt: "2027-04-30T00:00:00Z" },
      now,
    );
    expect(l.tone).toBe("danger");
    expect(l.text).toMatch(/^Baca saja · dihapus/);
  });
});

describe("pembantu formulir", () => {
  it("durasi", () => {
    expect(durationLabel(90)).toBe("3 bulan");
    expect(durationLabel(null)).toBe("Tanpa batas");
  });
  it("tujuan", () => {
    expect(purposeHint("singkat")).toMatch(/kurang/);
    expect(purposeHint("Untuk mengelola agenda dan arsip kantor")).toBeNull();
  });
  it("kekuatan kata sandi", () => {
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("abc").label).toBe("Lemah");
    expect(passwordStrength("Ruang-Kerja-2026").score).toBe(4);
  });
});
