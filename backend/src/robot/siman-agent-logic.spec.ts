import { describe, expect, it } from "vitest";
import { SIMAN_PAGE_CHARS, simanPageUrl, summarizePage, summarizeSimanTask } from "./siman-agent-logic";

const HOME = "https://siman.kemenkeu.go.id/profile";

describe("simanPageUrl", () => {
  it("kosong = halaman utama, alamat https dinormalkan", () => {
    expect(simanPageUrl(undefined, HOME)).toEqual({ url: HOME });
    expect(simanPageUrl("  ", HOME)).toEqual({ url: HOME });
    expect(simanPageUrl("https://siman.kemenkeu.go.id/tiket/daftar#atas", HOME)).toEqual({
      url: "https://siman.kemenkeu.go.id/tiket/daftar",
    });
  });

  it("menolak alamat tidak valid dan alamat yang bisa mengubah data / mengakhiri sesi", () => {
    expect(simanPageUrl("ftp://siman.kemenkeu.go.id", HOME)).toHaveProperty("error");
    expect(simanPageUrl("bukan alamat", HOME)).toHaveProperty("error");
    for (const bad of [
      "https://siman.kemenkeu.go.id/logout",
      "https://siman.kemenkeu.go.id/Account/LogOut",
      "https://siman.kemenkeu.go.id/tiket/hapus/12",
      "https://siman.kemenkeu.go.id/tiket?aksi=delete",
      "https://siman.kemenkeu.go.id/sk/upload",
    ]) {
      expect(simanPageUrl(bad, HOME)).toHaveProperty("error");
    }
  });
});

describe("summarizePage & summarizeSimanTask", () => {
  it("memotong struktur halaman yang panjang", () => {
    const long = "x".repeat(SIMAN_PAGE_CHARS * 2);
    const page = summarizePage({ url: HOME, title: "Profil", note: "Halaman direkam", aria: long });
    expect(page.struktur.length).toBeLessThan(long.length);
    expect(page.struktur.endsWith("(dipotong)")).toBe(true);
    expect(summarizePage({ aria: null }).struktur).toBe("");
  });

  it("ringkasan satu baris", () => {
    expect(summarizeSimanTask("session", { status: "active" })).toBe("Sesi SIMAN masih aktif");
    expect(summarizeSimanTask("session", { status: "expired" })).toContain("kedaluwarsa");
    expect(summarizeSimanTask("page", { note: "Halaman direkam", title: "Tiket" })).toBe("Halaman direkam: Tiket");
  });
});
