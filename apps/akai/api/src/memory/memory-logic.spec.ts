import { describe, expect, it } from "vitest";
import { extractionPrompt, isSensitive, memoryBlock, parseExtraction, worthExtracting } from "./memory-logic";

const mem = (id: string, content: string) => ({ id, content });

describe("memory-logic", () => {
  it("blok memori di prompt sistem", () => {
    expect(memoryBlock([])).toBeNull();
    const block = memoryBlock([mem("a", "Pengguna bernama Yusuf.")])!;
    expect(block).toContain("<memori_pengguna>\n- Pengguna bernama Yusuf.");
  });

  it("prompt pencatat memuat memori bernomor & pesan", () => {
    const prompt = extractionPrompt([mem("a", "Pengguna suka tabel.")], "Saya kerja di KPKNL", "Baik.");
    expect(prompt).toContain("1. Pengguna suka tabel.");
    expect(prompt).toContain("Saya kerja di KPKNL");
  });

  it("membaca JSON hasil: tambah, hapus nomor, buang rahasia & duplikat", () => {
    const existing = [mem("a", "Pengguna bekerja di KPKNL Malang."), mem("b", "Pengguna suka jawaban singkat.")];
    const out = parseExtraction(
      '```json\n{"add": ["Pengguna bekerja di KPKNL Malang.", "Kata sandi pengguna adalah abc123.", "Pengguna sedang menyusun SK PSP tahun 2027.", "ok"], "remove": [2, 9]}\n```',
      existing,
    );
    expect(out.add).toEqual(["Pengguna sedang menyusun SK PSP tahun 2027."]);
    expect(out.remove).toEqual(["b"]);
  });

  it("jawaban rusak = tanpa perubahan; maks. 3 memori baru", () => {
    expect(parseExtraction("tidak ada", [])).toEqual({ add: [], remove: [] });
    expect(parseExtraction("{bukan json", [])).toEqual({ add: [], remove: [] });
    const many = parseExtraction(
      JSON.stringify({
        add: [
          "Fakta pertama tentang A.",
          "Fakta kedua tentang B.",
          "Fakta ketiga tentang C.",
          "Fakta keempat tentang D.",
        ],
      }),
      [],
    );
    expect(many.add).toHaveLength(3);
  });

  it("deteksi data rahasia & pesan layak diperiksa", () => {
    expect(isSensitive("PIN saya 123456")).toBe(true);
    expect(isSensitive("NIK 3507123456789012")).toBe(true);
    expect(isSensitive("Pengguna suka kopi")).toBe(false);
    expect(worthExtracting("ok makasih")).toBe(false);
    expect(worthExtracting("Saya verifikator BMN di Malang")).toBe(true);
  });
});
