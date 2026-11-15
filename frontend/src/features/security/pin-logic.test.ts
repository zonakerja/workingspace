import { describe, expect, it } from "vitest";
import { isWeakPin, pinProblem } from "./pin-logic";

describe("pin-logic", () => {
  it("menolak PIN lemah", () => {
    expect(isWeakPin("000000")).toBe(true);
    expect(isWeakPin("456789")).toBe(true);
    expect(isWeakPin("654321")).toBe(true);
    expect(isWeakPin("482915")).toBe(false);
  });

  it("memeriksa format & konfirmasi", () => {
    expect(pinProblem("12345", "12345")).toMatch(/6 angka/);
    expect(pinProblem("482915", "482916")).toMatch(/belum sama/);
    expect(pinProblem("482915", "482915")).toBeNull();
  });
});
