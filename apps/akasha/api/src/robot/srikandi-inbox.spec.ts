import { describe, expect, it } from "vitest";
import { cleanInboxItem, inboxClientId, isUnread, mergeInboxRecord, summarizeInboxSync } from "./srikandi-inbox";

const raw = {
  kind: "disposisi",
  date: "2026-11-12",
  sentDate: "2026-11-13",
  info: "Permohonan PSP BMN Bandara X",
  instruction: "Untuk ditindaklanjuti",
  extraInstruction: "Siapkan konsep jawaban",
  readStatus: "BELUM DIBACA",
  fields: { "Uraian Informasi": "Permohonan PSP BMN Bandara X" },
};

describe("sinkron Naskah Masuk SRIKANDI", () => {
  it("butir robot dirapikan; jenis asing / kosong ditolak", () => {
    expect(cleanInboxItem(raw)).toMatchObject({ kind: "disposisi", sentDate: "2026-11-13", number: "" });
    expect(cleanInboxItem({ ...raw, kind: "lain" })).toBeNull();
    expect(cleanInboxItem({ kind: "masuk", date: "11 Nov" })).toBeNull();
    expect(cleanInboxItem({ ...raw, date: "11 Nov" })?.date).toBe("");
  });

  it("ID stabil dari isi, berbeda bila instruksi berbeda", () => {
    const a = cleanInboxItem(raw)!;
    expect(inboxClientId(a)).toBe(inboxClientId({ ...a, readStatus: "SUDAH DIBACA" }));
    expect(inboxClientId(a)).not.toBe(inboxClientId({ ...a, instruction: "Lain" }));
    expect(inboxClientId(a)).toMatch(/^si-[0-9a-f]{20}$/);
  });

  it("kolom LifeOS dipertahankan; tanpa perubahan robot tidak ditulis ulang", () => {
    const item = cleanInboxItem(raw)!;
    const first = mergeInboxRecord("si-1", item, null, "2026-11-13T01:00:00.000Z");
    expect(first).toMatchObject({ changed: true, isNew: true });
    const existing = { ...first.payload, todoId: "todo-1" };
    const same = mergeInboxRecord("si-1", item, existing, "2026-11-13T02:00:00.000Z");
    expect(same.changed).toBe(false);
    expect(same.payload).toMatchObject({ todoId: "todo-1", firstSeenAt: "2026-11-13T01:00:00.000Z" });
    const read = mergeInboxRecord(
      "si-1",
      { ...item, readStatus: "SUDAH DIBACA" },
      existing,
      "2026-11-13T03:00:00.000Z",
    );
    expect(read).toMatchObject({ changed: true, isNew: false });
    expect(read.payload.syncedAt).toBe("2026-11-13T03:00:00.000Z");
  });

  it("status baca & ringkasan", () => {
    expect(isUnread("BELUM DIBACA")).toBe(true);
    expect(isUnread("SUDAH DIBACA")).toBe(false);
    expect(summarizeInboxSync({ masuk: 2, disposisi: 1 }, 1)).toBe("Naskah masuk 2, Disposisi 1 · 1 baru");
  });
});
