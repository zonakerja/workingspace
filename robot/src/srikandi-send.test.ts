import { describe, expect, it } from "vitest";
import { detailMatches, findSendRow, parseSendRequest, pickSendConfirm, sendOutcome } from "./srikandi-send.js";

const request = { subject: "Hal baru", findSubject: "Hal lama", number: "XXX/KEU/ND/2026", dryRun: true };

describe("parseSendRequest", () => {
  it("wajib hal; dryRun bawaan true kecuali false eksplisit", () => {
    expect(parseSendRequest({})).toEqual({ error: "Hal konsep wajib diisi." });
    const a = parseSendRequest({ subject: " A " });
    expect(a).toEqual({ request: { subject: "A", findSubject: "A", number: "", dryRun: true } });
    const b = parseSendRequest({ subject: "A", dryRun: false });
    expect("request" in b && b.request.dryRun).toBe(false);
    const c = parseSendRequest({ subject: "A", dryRun: "false" });
    expect("request" in c && c.request.dryRun).toBe(true);
  });
});

describe("findSendRow", () => {
  const rows = [
    { subject: "Hal lama", number: "1/X", sendStatus: "TERKIRIM", editHref: null },
    { subject: "Hal lama", number: "XXX/KEU/ND/2026", sendStatus: "BELUM", editHref: "/form?id=a" },
    { subject: "Lain", number: "2", sendStatus: "BELUM", editHref: "/form?id=b" },
  ];
  it("hal lama dulu, nomor & belum terkirim", () => {
    expect(findSendRow(rows, request)?.editHref).toBe("/form?id=a");
    expect(findSendRow(rows, { ...request, number: "" })?.editHref).toBe("/form?id=a");
    expect(findSendRow(rows, { ...request, findSubject: "x", subject: "Lain" })?.number).toBe("2");
    expect(findSendRow(rows, { ...request, findSubject: "x", subject: "y" })).toBeNull();
  });
  it("hanya konsep terkirim → baris itu dikembalikan (tanpa tautan Edit)", () => {
    expect(findSendRow([rows[0]], { ...request, number: "" })?.editHref).toBeNull();
  });
});

describe("detailMatches", () => {
  it("hal harus sama, nomor sama bila tampil", () => {
    expect(detailMatches({ subject: "hal  lama", number: "XXX/KEU/ND/2026" }, request)).toBe(true);
    expect(detailMatches({ subject: "Hal baru", number: "" }, request)).toBe(true);
    expect(detailMatches({ subject: "Hal baru", number: "9/Y" }, request)).toBe(false);
    expect(detailMatches({ subject: "Hal lain", number: "XXX/KEU/ND/2026" }, request)).toBe(false);
    expect(detailMatches({ subject: "", number: "" }, request)).toBe(false);
  });
});

describe("pickSendConfirm", () => {
  it("hanya dialog tentang pengiriman + tombol persetujuan", () => {
    expect(pickSendConfirm("Kirim konsep ke verifikator?", ["Batal", "Ya, Kirim"])).toBe("Ya, Kirim");
    expect(pickSendConfirm("Naskah akan dikirim", ["OK", "Cancel"])).toBe("OK");
    expect(pickSendConfirm("Apakah Anda yakin?", ["Ya", "Tidak"])).toBeNull();
    expect(pickSendConfirm("Data akan dihapus, kirim?", ["Ya"])).toBeNull();
    expect(pickSendConfirm("Kirim konsep?", ["Tidak", "Batal"])).toBeNull();
  });
});

describe("sendOutcome", () => {
  it("berhasil / gagal / tak dikenal", () => {
    expect(sendOutcome("Berhasil Konsep berhasil dikirim")).toBe("sent");
    expect(sendOutcome("Gagal: verifikator wajib diisi")).toBe("failed");
    expect(sendOutcome("Memuat…")).toBe("unknown");
  });
});
