import { describe, expect, it } from "vitest";
import { normalizeEmail, passwordProblem } from "./password-policy";

describe("passwordProblem", () => {
  it("menolak kata sandi pendek, umum, dan berulang", () => {
    expect(passwordProblem("abc")).toMatch(/minimal 8/);
    expect(passwordProblem("Password")).toMatch(/umum/);
    expect(passwordProblem("aaaaaaaaa")).toMatch(/berulang/);
    expect(passwordProblem("x".repeat(129))).toMatch(/maksimal/);
  });

  it("menolak kata sandi yang memuat bagian depan email", () => {
    expect(passwordProblem("yusuf2026!", { email: "Yusuf@workingspace.id" })).toMatch(/email/);
    expect(passwordProblem("abc2026!xy", { email: "ab@workingspace.id" })).toBeNull();
  });

  it("menerima kata sandi yang wajar", () => {
    expect(passwordProblem("Ruang-Kerja-2026")).toBeNull();
  });

  it("menormalkan email", () => {
    expect(normalizeEmail("  Admin@WorkingSpace.ID ")).toBe("admin@workingspace.id");
  });
});
