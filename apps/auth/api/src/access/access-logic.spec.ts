import { describe, expect, it } from "vitest";
import { accessInfo, dueNotice, isDurationOption, newExpiry, purposeProblem, requestProblem } from "./access-logic";

const d = (s: string) => new Date(s);
const day = 24 * 60 * 60 * 1000;

describe("accessInfo", () => {
  it("tanpa batas = aktif", () => {
    expect(accessInfo(null)).toEqual({ state: "active", expiresAt: null, deleteAt: null });
  });
  it("aktif → baca saja 180 hari → berakhir", () => {
    const exp = d("2026-12-01T00:00:00Z");
    expect(accessInfo(exp, d("2026-11-30T00:00:00Z")).state).toBe("active");
    expect(accessInfo(exp, d("2026-12-01T00:00:00Z")).state).toBe("read_only");
    const info = accessInfo(exp, d("2027-05-29T23:00:00Z"));
    expect(info.state).toBe("read_only");
    expect(info.deleteAt?.toISOString()).toBe("2027-05-30T00:00:00.000Z");
    expect(accessInfo(exp, d("2027-05-30T00:00:00Z")).state).toBe("ended");
  });
});

describe("newExpiry", () => {
  const now = d("2026-11-18T00:00:00Z");
  it("tanpa batas", () => expect(newExpiry(null, now, now)).toBeNull());
  it("baru / sudah habis dihitung dari sekarang", () => {
    expect(newExpiry(30, null, now)?.toISOString()).toBe("2026-12-18T00:00:00.000Z");
    expect(newExpiry(30, d("2026-10-01T00:00:00Z"), now)?.toISOString()).toBe("2026-12-18T00:00:00.000Z");
  });
  it("perpanjangan dihitung dari akhir masa lama", () => {
    expect(newExpiry(30, d("2026-11-28T00:00:00Z"), now)?.toISOString()).toBe("2026-12-28T00:00:00.000Z");
  });
  it("pilihan durasi", () => {
    expect(isDurationOption(90)).toBe(true);
    expect(isDurationOption(null)).toBe(true);
    expect(isDurationOption(45)).toBe(false);
  });
});

describe("dueNotice", () => {
  const exp = d("2026-12-01T00:00:00Z");
  const at = (offsetDays: number) => new Date(exp.getTime() + offsetDays * day);
  it("tanpa batas / belum waktunya", () => {
    expect(dueNotice(null, 0)).toBeNull();
    expect(dueNotice(exp, 0, at(-8))).toBeNull();
  });
  it("urutan tahap", () => {
    expect(dueNotice(exp, 0, at(-7))).toBe(1);
    expect(dueNotice(exp, 1, at(-3))).toBeNull();
    expect(dueNotice(exp, 1, at(0))).toBe(2);
    expect(dueNotice(exp, 2, at(150))).toBe(3);
    expect(dueNotice(exp, 3, at(173))).toBe(4);
    expect(dueNotice(exp, 4, at(179))).toBe(5);
    expect(dueNotice(exp, 5, at(179.5))).toBeNull();
  });
  it("tahap terlewat → hanya yang terbaru; setelah dihapus tidak ada", () => {
    expect(dueNotice(exp, 0, at(160))).toBe(3);
    expect(dueNotice(exp, 0, at(181))).toBeNull();
  });
});

describe("pengajuan", () => {
  const now = d("2026-11-18T00:00:00Z");
  it("tujuan", () => {
    expect(purposeProblem("pendek")).toMatch(/minimal/);
    expect(purposeProblem("Untuk mengelola arsip dan agenda kantor")).toBeNull();
  });
  it("boleh mengajukan", () => {
    expect(requestProblem({ pending: true, membership: null }, now)).toMatch(/menunggu/);
    expect(requestProblem({ pending: false, membership: null }, now)).toBeNull();
    expect(requestProblem({ pending: false, membership: { expiresAt: null } }, now)).toMatch(/tanpa batas/);
    expect(requestProblem({ pending: false, membership: { expiresAt: d("2027-03-01T00:00:00Z") } }, now)).toMatch(
      /30 hari/,
    );
    expect(requestProblem({ pending: false, membership: { expiresAt: d("2026-12-01T00:00:00Z") } }, now)).toBeNull();
    expect(requestProblem({ pending: false, membership: { expiresAt: d("2026-10-01T00:00:00Z") } }, now)).toBeNull();
  });
});
