import { formatDayMonth, parseLocalYMD } from "@/lib/dates";
import type { MailHints, MailMessageSummary } from "@/types/api";

/** Logika murni menu Email, diuji di `email-utils.test.ts`. */

const formatRupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Label petunjuk singkat: "Tagihan Rp 412.500 · 20 Nov" / "Jadwal 19 Nov 13:00". */
export function hintLabel(hints: MailHints | undefined): string | null {
  if (!hints || hints.kind === "none") return null;
  const date = hints.date ? formatDayMonth(parseLocalYMD(hints.date)!) : "";
  if (hints.kind === "bill") {
    return ["Tagihan", hints.amount ? formatRupiah(hints.amount) : "", date && `jatuh tempo ${date}`]
      .filter(Boolean)
      .join(" · ");
  }
  return ["Jadwal", date, hints.time ?? ""].filter(Boolean).join(" ");
}

export const senderName = (m: Pick<MailMessageSummary, "fromName" | "fromAddress">) => m.fromName || m.fromAddress;

/** Waktu di daftar: jam bila hari ini, selain itu tanggal. */
export function listTime(iso: string, now: Date) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
      });
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Tab menu Email → status pesan. */
export const TAB_STATUS = { inbox: "new", done: "done", ignored: "ignored" } as const;
