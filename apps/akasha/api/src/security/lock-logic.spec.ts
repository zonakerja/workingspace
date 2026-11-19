import { describe, expect, it } from "vitest";
import {
  archiveOriginKeys,
  isFileControlResource,
  isLockableType,
  isValidPin,
  isWeakPin,
  pinBlockMs,
  pinStillUnlocked,
  redactPayload,
} from "./lock-logic";

describe("lock-logic", () => {
  it("menyisakan kerangka item dan mencatat key yang disembunyikan", () => {
    const { payload, hidden } = redactPayload({
      title: "Rahasia",
      areaId: "a1",
      dueDate: "2026-11-20",
      description: "isi",
      resources: [{ uploadId: "u1" }],
      locked: true,
    });
    expect(payload).toEqual({
      title: "Rahasia",
      areaId: "a1",
      dueDate: "2026-11-20",
      description: "",
      resources: [],
      locked: true,
    });
    expect(hidden.sort()).toEqual(["description", "resources"]);
  });

  it("memvalidasi PIN 6 angka dan menolak PIN lemah", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a456")).toBe(false);
    expect(isWeakPin("111111")).toBe(true);
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("987654")).toBe(true);
    expect(isWeakPin("482915")).toBe(false);
  });

  it("memblokir setelah 5 kesalahan dan melipatgandakan blokir", () => {
    expect(pinBlockMs(4)).toBe(0);
    expect(pinBlockMs(5)).toBe(15 * 60_000);
    expect(pinBlockMs(10)).toBe(30 * 60_000);
    expect(pinBlockMs(100)).toBe(24 * 60 * 60_000);
  });

  it("mengenali jenis yang bisa dikunci", () => {
    expect(isLockableType("para_area")).toBe(true);
    expect(isLockableType("para_task")).toBe(false);
  });

  it("mengerangkakan snapshot arsip PARA tanpa membuang judul & asal", () => {
    const { payload, hidden } = redactPayload({
      originalType: "project",
      originalId: "p1",
      archivedAt: "2026-11-14T00:00:00.000Z",
      data: { title: "Rahasia", description: "isi", locked: true },
      related: { tasks: [{ id: "t1", title: "x" }] },
    });
    expect(payload.originalType).toBe("project");
    expect(payload.data).toEqual({ title: "Rahasia", description: "", locked: true });
    expect(payload.related).toBeNull();
    expect(hidden).toEqual(["data", "related"]);
  });

  it("mengenali item asal & turunan arsip PARA", () => {
    expect(
      archiveOriginKeys({
        originalType: "area",
        originalId: "a1",
        related: { projects: [{ id: "p1" }], tasks: [{ id: "t1" }, { title: "tanpa id" }], schedules: [{ id: "s1" }] },
      }),
    ).toEqual(["para_area:a1", "para_project:p1", "para_task:t1", "schedule:s1"]);
    expect(archiveOriginKeys({ originalType: "lain", originalId: "x" })).toEqual([]);
  });

  it("menolak mengunci arsip File Control", () => {
    expect(isFileControlResource({ type: "file", archivalStatus: "pending" })).toBe(true);
    expect(isFileControlResource({ type: "file", archivalStatus: "none" })).toBe(false);
    expect(isFileControlResource({ type: "file", archivalStatus: "" })).toBe(false);
    expect(isFileControlResource({ type: "link", archivalStatus: "pending" })).toBe(false);
  });
});

describe("kunci otomatis PIN", () => {
  const now = new Date("2026-11-18T10:00:00Z").getTime();
  it("tanpa kunci otomatis selalu terbuka", () => {
    expect(pinStillUnlocked(null, null, now)).toBe(true);
  });
  it("terkunci setelah n menit tanpa aktivitas", () => {
    expect(pinStillUnlocked(new Date(now - 4 * 60_000), 5, now)).toBe(true);
    expect(pinStillUnlocked(new Date(now - 5 * 60_000), 5, now)).toBe(false);
    expect(pinStillUnlocked(null, 15, now)).toBe(false);
  });
  it("Sub Area / Kegiatan bisa dikunci", () => {
    expect(isLockableType("para_activity")).toBe(true);
  });
});
