import { describe, expect, it } from "vitest";
import { messageOf } from "./api";
import { deviceLabel, safeNext } from "./format";

describe("deviceLabel", () => {
  it("mengenali peramban & sistem", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ),
    ).toBe("Chrome · Windows");
    expect(
      deviceLabel("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36 Edg/140.0"),
    ).toBe("Edge · Android");
    expect(deviceLabel("node")).toBe("Program");
    expect(deviceLabel(null)).toBe("Perangkat tidak dikenal");
  });
});

describe("safeNext", () => {
  it("hanya path di situs ini", () => {
    expect(safeNext("/account")).toBe("/account");
    expect(safeNext("https://evil.example")).toBe("/account");
    expect(safeNext("//evil.example")).toBe("/account");
    expect(safeNext("/\\evil.example")).toBe("/account");
    expect(safeNext(null)).toBe("/account");
  });
});

describe("messageOf", () => {
  it("membaca pesan Nest", () => {
    expect(messageOf({ message: "Gagal." }, "x")).toBe("Gagal.");
    expect(messageOf({ message: ["a", "b"] }, "x")).toBe("a b");
    expect(messageOf(null, "x")).toBe("x");
  });
});

describe("log keamanan", () => {
  it("label & metode masuk", async () => {
    const { eventLabel, loginMethod } = await import("./format");
    expect(eventLabel("login")).toBe("Masuk");
    expect(eventLabel("kejadian_baru")).toBe("kejadian_baru");
    expect(loginMethod({ method: "password:akasha" })).toBe("kata sandi · akasha");
    expect(loginMethod({ method: "sso:akasha" })).toBe("sesi SSO · akasha");
    expect(loginMethod(null)).toBeNull();
  });
});

describe("pinProblem", () => {
  it("format, lemah, konfirmasi", async () => {
    const { pinProblem } = await import("./format");
    expect(pinProblem("12345", "12345")).toMatch(/6 angka/);
    expect(pinProblem("777777", "777777")).toMatch(/sama semua/);
    expect(pinProblem("654321", "654321")).toMatch(/berurutan/);
    expect(pinProblem("482915", "482916")).toMatch(/Konfirmasi/);
    expect(pinProblem("482915", "482915")).toBeNull();
  });
});
