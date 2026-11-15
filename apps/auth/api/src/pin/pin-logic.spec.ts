import { describe, expect, it } from "vitest";
import { isValidPin, isWeakPin, parseBasicAuth, pinBlockMs } from "./pin-logic";

describe("PIN", () => {
  it("format & PIN lemah", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a456")).toBe(false);
    expect(isWeakPin("111111")).toBe(true);
    expect(isWeakPin("123456")).toBe(true);
    expect(isWeakPin("987654")).toBe(true);
    expect(isWeakPin("482915")).toBe(false);
  });

  it("blokir bertahap", () => {
    expect(pinBlockMs(4)).toBe(0);
    expect(pinBlockMs(5)).toBe(15 * 60_000);
    expect(pinBlockMs(10)).toBe(30 * 60_000);
    expect(pinBlockMs(500)).toBe(24 * 60 * 60_000);
  });
});

describe("parseBasicAuth", () => {
  it("membaca client_id:secret", () => {
    const header = `Basic ${Buffer.from("akasha:rahasia:dengan:titik-dua").toString("base64")}`;
    expect(parseBasicAuth(header)).toEqual({ id: "akasha", secret: "rahasia:dengan:titik-dua" });
  });
  it("menolak header lain", () => {
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth("Bearer x")).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from("tanpa-titik-dua").toString("base64")}`)).toBeNull();
  });
});
