import type { SrikandiInbox, SrikandiInboxKind, SrikandiOutgoing, Todo } from "@/types/entities";

/**
 * Logika murni tab SRIKANDI → Naskah Masuk (diuji di `inbox-logic.test.ts`). Data diambil robot dari halaman daftar
 * SRIKANDI saja (docs/AI-AGENT.md §21.14); tindak lanjut di LifeOS = to-do Planner dan balasan lewat Register.
 */

export const INBOX_KINDS: SrikandiInboxKind[] = ["masuk", "tembusan", "disposisi", "koordinasi", "arahan"];

export const INBOX_KIND_LABELS: Record<SrikandiInboxKind, string> = {
  masuk: "Naskah masuk",
  tembusan: "Tembusan",
  disposisi: "Disposisi",
  koordinasi: "Koordinasi",
  arahan: "Arahan",
};

/** Halaman daftar di SRIKANDI per jenis (untuk tombol "Buka di SRIKANDI"). */
export const INBOX_PATHS: Record<SrikandiInboxKind, string> = {
  masuk: "/penerimaan-naskah-masuk/naskah-dinas-masuk",
  tembusan: "/penerimaan-naskah-masuk/naskah-tembusan",
  disposisi: "/penerimaan-naskah-masuk/disposisi",
  koordinasi: "/penerimaan-naskah-masuk/koordinasi",
  arahan: "/penerimaan-naskah-masuk/arahan",
};

export const isUnread = (item: Pick<SrikandiInbox, "readStatus">) => /belum/i.test(item.readStatus ?? "");

/** Sudah ditindaklanjuti menurut SRIKANDI ("SUDAH DITINDAKLANJUTI", "SELESAI"). */
export const isFollowedUp = (item: Pick<SrikandiInbox, "followUpStatus">) =>
  /sudah|selesai/i.test(item.followUpStatus ?? "") && !/belum/i.test(item.followUpStatus ?? "");

/** Judul tampilan: hal naskah, atau uraian informasi (disposisi/koordinasi/arahan). */
export const inboxTitle = (item: Pick<SrikandiInbox, "subject" | "info" | "number">) =>
  item.subject?.trim() || item.info?.trim() || item.number?.trim() || "(tanpa hal)";

/** Tanggal acuan urutan: tanggal disposisi/arahan, lalu tanggal naskah. */
const sortDate = (item: SrikandiInbox) => item.sentDate || item.date || item.firstSeenAt?.slice(0, 10) || "";

export type InboxFilter = "all" | "unread" | SrikandiInboxKind;

const norm = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Saring (jenis / belum dibaca) + cari per kata di semua kolom, terbaru dulu. */
export function filterInbox(items: SrikandiInbox[], filter: InboxFilter, query: string) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  return items
    .filter((i) => (filter === "all" ? true : filter === "unread" ? isUnread(i) : i.kind === filter))
    .filter((i) => {
      if (!words.length) return true;
      const text = norm(
        [i.number, i.subject, i.origin, i.info, i.instruction, i.extraInstruction, INBOX_KIND_LABELS[i.kind]]
          .filter(Boolean)
          .join(" "),
      );
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => sortDate(b).localeCompare(sortDate(a)) || (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? ""));
}

/** Jumlah per jenis + belum dibaca (chip filter). */
export function inboxCounts(items: SrikandiInbox[]) {
  const counts: Record<InboxFilter, number> = {
    all: items.length,
    unread: items.filter(isUnread).length,
    masuk: 0,
    tembusan: 0,
    disposisi: 0,
    koordinasi: 0,
    arahan: 0,
  };
  for (const i of items) counts[i.kind] += 1;
  return counts;
}

/** To-do Planner dari satu naskah: judul berisi jenis + hal + instruksi, prioritas tinggi untuk disposisi/arahan. */
export function todoFromInbox(item: SrikandiInbox, id: string, today: Date): Todo {
  const instruction = [item.instruction, item.extraInstruction].filter(Boolean).join(" — ");
  const title = `${INBOX_KIND_LABELS[item.kind]}: ${inboxTitle(item)}${instruction ? ` (${instruction})` : ""}`;
  return {
    id,
    title: title.length > 300 ? `${title.slice(0, 299)}…` : title,
    completed: false,
    date: today.toDateString(),
    priority: item.kind === "disposisi" || item.kind === "arahan" ? "high" : "medium",
  };
}

/** Naskah yang bisa dibalas lewat Register (punya nomor naskah untuk Nomor Referensi). */
export const canReply = (item: SrikandiInbox) =>
  (item.kind === "masuk" || item.kind === "tembusan") && !!item.number?.trim();

/** Isian awal entri Register balasan: Nomor Referensi = nomor naskah masuk, hal diawali "Tanggapan atas". */
export function replyDraft(item: SrikandiInbox): Partial<SrikandiOutgoing> {
  return {
    reference: item.number?.trim() ?? "",
    subject: item.subject?.trim() ? `Tanggapan atas ${item.subject.trim()}` : "",
    replyTo: item.id,
  };
}

/** Naskah belum dibaca untuk lonceng notifikasi (terbaru dulu, maks. `limit`). */
export const unreadInbox = (items: SrikandiInbox[], limit = 5) => filterInbox(items, "unread", "").slice(0, limit);
