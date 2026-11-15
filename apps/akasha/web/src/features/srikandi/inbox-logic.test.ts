import { describe, expect, it } from "vitest";
import type { SrikandiInbox } from "@/types/entities";
import {
  canReply,
  filterInbox,
  inboxCounts,
  inboxTitle,
  isFollowedUp,
  isUnread,
  replyDraft,
  todoFromInbox,
  unreadInbox,
} from "./inbox-logic";

const items: SrikandiInbox[] = [
  {
    id: "a",
    kind: "masuk",
    date: "2026-11-10",
    number: "UM.003/12/DJPU/2026",
    subject: "Undangan Rapat BMN",
    origin: "Direktur Bandar Udara",
    readStatus: "BELUM DIBACA",
  },
  {
    id: "b",
    kind: "disposisi",
    date: "2026-11-09",
    sentDate: "2026-11-12",
    info: "Permohonan PSP Bandara X",
    instruction: "Untuk ditindaklanjuti",
    readStatus: "SUDAH DIBACA",
    followUpStatus: "SUDAH DITINDAKLANJUTI",
  },
];

describe("Naskah Masuk SRIKANDI di Akasha", () => {
  it("status, judul, dan urutan terbaru (tanggal disposisi didahulukan)", () => {
    expect(isUnread(items[0])).toBe(true);
    expect(isFollowedUp(items[1])).toBe(true);
    expect(isFollowedUp({ followUpStatus: "BELUM DITINDAKLANJUTI" })).toBe(false);
    expect(inboxTitle(items[1])).toBe("Permohonan PSP Bandara X");
    expect(filterInbox(items, "all", "").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("filter jenis / belum dibaca / kata & jumlah", () => {
    expect(filterInbox(items, "unread", "").map((i) => i.id)).toEqual(["a"]);
    expect(filterInbox(items, "disposisi", "").map((i) => i.id)).toEqual(["b"]);
    expect(filterInbox(items, "all", "bandara psp").map((i) => i.id)).toEqual(["b"]);
    expect(inboxCounts(items)).toMatchObject({ all: 2, unread: 1, masuk: 1, disposisi: 1, arahan: 0 });
    expect(unreadInbox(items)).toHaveLength(1);
  });

  it("to-do & balasan", () => {
    const todo = todoFromInbox(items[1], "todo-1", new Date(2026, 10, 13));
    expect(todo).toMatchObject({
      id: "todo-1",
      title: "Disposisi: Permohonan PSP Bandara X (Untuk ditindaklanjuti)",
      priority: "high",
      date: "Fri Nov 13 2026",
      completed: false,
    });
    expect(canReply(items[0])).toBe(true);
    expect(canReply(items[1])).toBe(false);
    expect(replyDraft(items[0])).toEqual({
      reference: "UM.003/12/DJPU/2026",
      subject: "Tanggapan atas Undangan Rapat BMN",
      replyTo: "a",
    });
  });
});
