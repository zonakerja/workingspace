import type { SimanRequest } from "@/types/entities";

/**
 * Logika murni tab SIMAN → Permohonan & pemilih tiket workflow (diuji `request-logic.test.ts`). Data = record
 * `siman_request` hasil sinkron robot; `disposed` = tiket didisposisikan ke pemilik (tampil di Penetapan Pengelolaan).
 */

export type RequestScope = "disposed" | "all";
export type RequestStage = "any" | "process" | "done";

/** Tiket selesai di SIMAN (mis. "11.4.5 - Selesai Proses Penerbitan Persetujuan Eselon 1"). */
export const isDone = (r: Pick<SimanRequest, "status">) => /selesai/i.test(r.status ?? "");

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Teks yang dicari: nomor tiket, satker, tipe, status, nomor surat, korwil. */
const haystack = (r: SimanRequest) =>
  fold(
    [r.ticket, r.satkerName, r.satkerCode, r.tipe, r.status, r.letterNumber, r.korwil, r.jenisBmn]
      .filter(Boolean)
      .join(" "),
  );

/** Saring + urutkan (terbaru dulu; tiket yang didisposisikan dulu bila tanggal sama). */
export function filterRequests(
  items: SimanRequest[],
  {
    scope,
    stage,
    search,
    showInactive,
  }: { scope: RequestScope; stage: RequestStage; search: string; showInactive: boolean },
): SimanRequest[] {
  const words = fold(search).split(/\s+/).filter(Boolean);
  return items
    .filter((r) => showInactive || r.active !== false)
    .filter((r) => scope === "all" || r.disposed === true)
    .filter((r) => stage === "any" || (stage === "done" ? isDone(r) : !isDone(r)))
    .filter((r) => {
      if (!words.length) return true;
      const text = haystack(r);
      return words.every((w) => text.includes(w));
    })
    .sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") ||
        Number(!!b.disposed) - Number(!!a.disposed) ||
        b.ticket.localeCompare(a.ticket),
    );
}

/** Jumlah per pilihan (setelah menyaring tiket tidak aktif). */
export function requestCounts(items: SimanRequest[], showInactive: boolean) {
  const visible = items.filter((r) => showInactive || r.active !== false);
  return {
    disposed: visible.filter((r) => r.disposed === true).length,
    all: visible.length,
    disposedOpen: visible.filter((r) => r.disposed === true && !isDone(r)).length,
  };
}

/** "Rp 99.467.100" */
export function formatRupiah(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

/** Status SIMAN tanpa kode di depan: "7.4.3 - Proses Penelitian…" → { code: "7.4.3", label: "Proses Penelitian…" }. */
export function statusParts(status: string | undefined): { code: string; label: string } {
  const m = /^\s*([\d.]+)\s*[-–]\s*(.*)$/.exec(status ?? "");
  return m ? { code: m[1], label: m[2] } : { code: "", label: status ?? "" };
}

/**
 * Pilihan tiket untuk isian workflow: hanya tiket yang didisposisikan ke pemilik (diproses lewat halaman Penetapan
 * Pengelolaan). Bawaan yang masih diproses; `includeDone` = termasuk yang sudah selesai.
 */
export function ticketOptions(items: SimanRequest[], includeDone = false) {
  const list = filterRequests(items, {
    scope: "disposed",
    stage: includeDone ? "any" : "process",
    search: "",
    showInactive: false,
  });
  return list.map((r) => ({
    value: r.ticket,
    label: `${r.ticket} · ${r.satkerName || r.satkerCode || "Satker ?"}`,
    hint: [r.tipe, statusParts(r.status).label, r.disposed ? "Didisposisikan ke Anda" : ""].filter(Boolean).join(" · "),
  }));
}
