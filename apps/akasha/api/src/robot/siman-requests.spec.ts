import { describe, expect, it } from "vitest";
import {
  REQUESTS_COOLDOWN_MS,
  SIMAN_PACE_MS,
  simanAccountKey,
  simanPaceDelay,
  simanRequestsCooldown,
  inactivePayload,
  mergeRequestRecord,
  parseRequestRow,
  requestPayload,
  rupiah,
  simanDate,
  summarizeRequestSync,
} from "./siman-requests";

const row = {
  "Nomor Tiket": "PPL26110408030558728",
  Status: "7.4.3 - Proses Penelitian Analis Eselon 1",
  "Kode/Nama Asal Pembuat": "022050500683445 - KANTOR UPBU LETUNG",
  "Tipe Pengelolaan": "PSP Selain Tanah dan/atau Bangunan",
  "Tanggal Tiket": "04/11/2026",
  "Nilai Permohonan": "Rp 99.467.100",
  "Nomor Surat Pemohon": "PL.301/28/XI/UPBU-LTG/2026",
  Aksi: "",
};

describe("siman-requests", () => {
  it("membaca baris daftar permohonan", () => {
    const r = parseRequestRow(row);
    expect(r).toMatchObject({
      ticket: "PPL26110408030558728",
      tipe: "PSP Selain Tanah dan/atau Bangunan",
      date: "2026-11-04",
      satkerCode: "022050500683445",
      satkerName: "KANTOR UPBU LETUNG",
      value: 99467100,
      letterNumber: "PL.301/28/XI/UPBU-LTG/2026",
    });
    expect(parseRequestRow({ "Nomor Tiket": "abc" })).toBeNull();
  });

  it("tanggal & rupiah", () => {
    expect(simanDate("28-09-2026 10:12")).toBe("2026-09-28");
    expect(simanDate("2026-09-28")).toBe("2026-09-28");
    expect(simanDate("21 September 2026")).toBe("2026-09-21");
    expect(simanDate("-")).toBe("");
    expect(rupiah("1.720.500,00")).toBe(1720500);
    expect(rupiah("-")).toBeNull();
  });

  it("menandai disposisi & mempertahankan isian pemilik", () => {
    const r = parseRequestRow(row)!;
    const next = requestPayload(r, r, true);
    expect(next.disposed).toBe(true);
    const first = mergeRequestRecord(next, null, "T1");
    expect(first).toMatchObject({ isNew: true, changed: true, newlyDisposed: true });
    const again = mergeRequestRecord(next, { ...first.payload, note: "catatan" }, "T2");
    expect(again.changed).toBe(false);
    expect(again.payload.note).toBe("catatan");
    expect(again.payload.syncedAt).toBe("T1");
    // Daftar Penetapan tidak terbaca → nilai disposisi lama tetap
    const unknown = requestPayload(r, null, false);
    expect("disposed" in unknown).toBe(false);
    expect(mergeRequestRecord(unknown, first.payload, "T3").payload.disposed).toBe(true);
    // Tidak lagi didisposisikan
    expect(requestPayload(r, null, true).disposed).toBe(false);
  });

  it("tiket hilang ditandai tidak aktif sekali", () => {
    expect(inactivePayload({ ticket: "x", active: true }, "T")).toMatchObject({ active: false });
    expect(inactivePayload({ ticket: "x", active: false }, "T")).toBeNull();
    expect(summarizeRequestSync({ total: 13, disposed: 2, added: 1, newlyDisposed: 0 })).toContain("2 didisposisikan");
  });
});

describe("siman-requests durasi", () => {
  it("kolom Durasi yang bertambah tidak dihitung perubahan", () => {
    const a = parseRequestRow({ ...row, "Durasi Permohonan": "1 hari 1 jam" })!;
    const b = parseRequestRow({ ...row, "Durasi Permohonan": "1 hari 2 jam" })!;
    const first = mergeRequestRecord(requestPayload(a, a, true), null, "T1");
    expect(mergeRequestRecord(requestPayload(b, b, true), first.payload, "T2").changed).toBe(false);
  });
});

describe("siman-requests urutan kunci", () => {
  it("urutan kunci objek (jsonb) tidak dihitung perubahan", () => {
    const a = parseRequestRow(row)!;
    const first = mergeRequestRecord(requestPayload(a, a, true), null, "T1");
    const reordered = { ...first.payload, fields: Object.fromEntries(Object.entries(a.fields).reverse()) };
    expect(mergeRequestRecord(requestPayload(a, a, true), reordered, "T2").changed).toBe(false);
  });
});

describe("siman-requests akun & pengaman firewall", () => {
  it("kunci akun dari nama pengguna (huruf besar/kecil sama), tanpa kredensial = manual", () => {
    expect(simanAccountKey("Budi.KEU")).toBe(simanAccountKey("budi.keu"));
    expect(simanAccountKey("budi")).not.toBe(simanAccountKey("andi"));
    expect(simanAccountKey(null)).toBe("manual");
  });
  it("jeda antar-tugas & jeda sinkron daftar", () => {
    expect(simanPaceDelay(undefined, 1000)).toBe(0);
    expect(simanPaceDelay(1000, 1000 + 5_000)).toBe(SIMAN_PACE_MS - 5_000);
    expect(simanPaceDelay(1000, 1000 + SIMAN_PACE_MS + 1)).toBe(0);
    expect(simanRequestsCooldown(1, 1 + REQUESTS_COOLDOWN_MS - 60_000)).toBe(60_000);
    expect(simanRequestsCooldown(undefined, 5)).toBe(0);
  });
});
