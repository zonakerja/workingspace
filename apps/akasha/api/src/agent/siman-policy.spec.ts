import { describe, expect, it } from "vitest";
import { decideSimanPolicy, isLandOrBuilding, kelengkapanFacts, type SimanFacts } from "./siman-policy";

const facts: SimanFacts = {
  ticket: "PPL26110408030558728",
  suratPermohonan: true,
  sptjm: true,
  landOrBuilding: false,
  assetsMatch: true,
  assetCount: 36,
  analysisStatus: "LENGKAP",
  documents: { analysis: true, decree: true },
  disposed: true,
  stage: "7.4.3 - Proses Penelitian Analis Eselon 1",
};
const base = { facts, mode: "auto", requestStatus: "menunggu_verifikasi", paused: false, usedToday: 0, dailyLimit: 5 };

describe("siman-policy", () => {
  it("tiket wajib didisposisikan ke pemilik dan masih tahap penelitian", () => {
    expect(decideSimanPolicy({ ...base, facts: { ...facts, disposed: false } }).apply).toBe(false);
    const done = decideSimanPolicy({ ...base, facts: { ...facts, stage: "8 - Selesai" } });
    expect(done.apply).toBe(false);
    expect(done.reasons.join(" ")).toMatch(/tahap penelitian/);
  });

  it("fakta kelengkapan dari baris SIMAN (berkas wajib terambil)", () => {
    expect(
      kelengkapanFacts([
        { jenis: "Surat Permohonan - Mandatory", uploadId: "a" },
        { jenis: "Surat Pernyataan Tanggung Jawab Mutlak (SPTJM)", uploadId: "b" },
      ]),
    ).toEqual({ suratPermohonan: true, sptjm: true });
    expect(kelengkapanFacts([{ jenis: "SPTJM", uploadId: null }]).sptjm).toBe(false);
    expect(isLandOrBuilding("Selain Tanah Dan/Atau Bangunan", "PSP")).toBe(false);
    expect(isLandOrBuilding("Tanah", "PSP")).toBe(true);
  });

  it("auto menyetujui hanya bila semua syarat server terpenuhi", () => {
    expect(decideSimanPolicy(base)).toMatchObject({ outcome: "approve", apply: true });
    expect(decideSimanPolicy({ ...base, mode: "shadow" })).toMatchObject({ outcome: "approve", apply: false });
    expect(decideSimanPolicy({ ...base, paused: true }).apply).toBe(false);
    expect(decideSimanPolicy({ ...base, usedToday: 5 }).apply).toBe(false);
  });

  it("diserahkan ke pemilik bila ada yang kurang", () => {
    const review = (patch: Partial<SimanFacts>) => decideSimanPolicy({ ...base, facts: { ...facts, ...patch } });
    expect(review({ sptjm: false })).toMatchObject({ outcome: "review", apply: false });
    expect(review({ landOrBuilding: true }).outcome).toBe("review");
    expect(review({ assetsMatch: false }).outcome).toBe("review");
    expect(review({ assetsMatch: null }).outcome).toBe("review");
    expect(review({ analysisStatus: "TIDAK LENGKAP" }).outcome).toBe("review");
    expect(review({ documents: { analysis: true, decree: false } }).outcome).toBe("review");
    expect(decideSimanPolicy({ ...base, requestStatus: "disetujui" }).outcome).toBe("review");
  });
});
