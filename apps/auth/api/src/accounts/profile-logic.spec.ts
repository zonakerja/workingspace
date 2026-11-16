import { describe, expect, it } from "vitest";
import { normalizePhone, profileChanges } from "./profile-logic";

describe("normalizePhone", () => {
  it("membakukan nomor Indonesia & internasional", () => {
    expect(normalizePhone("0812-3456-7890")).toBe("+6281234567890");
    expect(normalizePhone("+62 812 3456 7890")).toBe("+6281234567890");
    expect(normalizePhone("6281234567890")).toBe("+6281234567890");
    expect(normalizePhone("0065 9123 4567")).toBe("+6591234567");
    expect(normalizePhone("(021) 345 6789")).toBe("+62213456789");
  });
  it("menolak yang bukan nomor", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("0812abc")).toBeNull();
    expect(normalizePhone("+1234567890123456")).toBeNull();
  });
});

describe("profileChanges", () => {
  it("hanya key yang dikirim; kosong = dihapus", () => {
    expect(profileChanges({ occupation: "  Analis  BMN ", address: "" })).toEqual({
      fields: { occupation: "Analis BMN", address: null },
    });
  });
  it("galat untuk nomor salah & teks terlalu panjang", () => {
    expect(profileChanges({ phone: "abc" })).toHaveProperty("error");
    expect(profileChanges({ workplace: "x".repeat(151) })).toHaveProperty("error");
  });
});
