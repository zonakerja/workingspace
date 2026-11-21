import { normalizeSystemUrl } from "./robot-logic";

/**
 * Logika murni robot SIMAN yang dipakai agen (Hermes) lewat MCP — diuji di `siman-agent-logic.spec.ts`.
 *
 * SIMAN adalah fitur terbuka untuk agen (keputusan user 2026-11-13, pola sama dengan e-Kinerja & SRIKANDI): kodenya tetap
 * bawaan dan namanya dikunci, tetapi agen boleh menambah workflow di dalamnya dan menjalankan robotnya. Karena alur tiket &
 * unggah surat keputusan belum diajarkan pemilik, robot SIMAN untuk agen hanya **membaca**: menjaga sesi dan membaca isi
 * satu halaman SIMAN (struktur teks, tanpa klik dan tanpa mengisi apa pun) agar agen bisa mempelajari halaman tiket
 * bersama pemilik. Menulis ke SIMAN (unggah SK) kelak hanya lewat permintaan yang disetujui pemilik.
 */

export type SimanAgentTask = "session" | "page" | "ticket" | "requests";

export const SIMAN_TASK_LABELS: Record<SimanAgentTask, string> = {
  session: "Jaga sesi login",
  page: "Baca halaman SIMAN (tanpa klik)",
  ticket: "Baca tiket SIMAN (aset, kelengkapan + berkas, analisis, riwayat)",
  requests: "Ambil daftar Permohonan SIMAN & tanda disposisi",
};

/** Nomor tiket SIMAN: "PPL" + angka (mis. PPL26110408030558728). */
export function simanTicketNumber(raw: string | undefined): string | null {
  const ticket = (raw ?? "").trim().toUpperCase();
  return /^PPL\d{14,20}$/.test(ticket) ? ticket : null;
}

/** Batas isi berkas kelengkapan yang dikirim ke agen per panggilan. */
export const SIMAN_FILE_CHARS = 60_000;

/** Batas teks struktur halaman yang dikembalikan ke agen (snapshot aksesibilitas bisa sangat panjang). */
export const SIMAN_PAGE_CHARS = 15_000;

/**
 * Alamat yang tidak boleh dibuka agen walau di dalam SIMAN: membuka alamat = permintaan GET, dan tautan seperti keluar /
 * hapus / batal bisa mengubah keadaan. Pola dicocokkan pada path + query (huruf kecil).
 */
const FORBIDDEN_PATH =
  /(logout|log-out|signout|sign-out|keluar|delete|hapus|remove|destroy|batal|cancel|approve|setuju|reject|tolak|submit|kirim|upload|unggah)/;

/**
 * Periksa alamat halaman yang diminta agen. Kosong = halaman utama SIMAN. Mengembalikan alamat ternormalisasi atau
 * pesan galat (Bahasa Indonesia, agar agen bisa memperbaikinya). Batas host konektor diperiksa lagi oleh RobotService.
 */
export function simanPageUrl(url: string | undefined, homeUrl: string): { url: string } | { error: string } {
  const raw = (url ?? "").trim();
  if (!raw) return { url: homeUrl };
  const normalized = normalizeSystemUrl(raw);
  if (!normalized) return { error: "Alamat halaman tidak valid (harus https)." };
  const parsed = new URL(normalized);
  if (FORBIDDEN_PATH.test(`${parsed.pathname}${parsed.search}`.toLowerCase())) {
    return { error: "Alamat itu bisa mengubah data atau mengakhiri sesi di SIMAN, jadi tidak dibuka robot." };
  }
  return { url: normalized };
}

/** Hasil baca halaman untuk agen: alamat akhir, judul, status sesi, dan struktur teks yang dipotong. */
export function summarizePage(run: {
  url?: string | null;
  title?: string | null;
  note?: string | null;
  aria?: string | null;
}) {
  const aria = run.aria ?? "";
  return {
    alamat: run.url ?? null,
    judul: run.title ?? null,
    catatan: run.note ?? null,
    struktur: aria.length > SIMAN_PAGE_CHARS ? `${aria.slice(0, SIMAN_PAGE_CHARS)}\n… (dipotong)` : aria,
  };
}

/** Ringkasan tugas yang selesai, satu baris Bahasa Indonesia. */
export function summarizeSimanTask(task: SimanAgentTask, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as { status?: string; title?: string; note?: string };
  if (task === "ticket") {
    const t = r as {
      tiket?: string;
      ringkasanAset?: { jumlah?: number } | null;
      berkas?: { uploadId: string | null }[];
    };
    const files = t.berkas ?? [];
    return `Tiket ${t.tiket ?? ""} dibaca: ${t.ringkasanAset?.jumlah ?? 0} aset, ${files.filter((f) => f.uploadId).length}/${files.length} berkas kelengkapan tersimpan`;
  }
  if (task === "requests")
    return typeof (r as { summary?: unknown }).summary === "string"
      ? (r as { summary: string }).summary
      : "Daftar Permohonan diperbarui";
  if (task === "session")
    return r.status === "active" ? "Sesi SIMAN masih aktif" : "Sesi SIMAN kedaluwarsa — perlu login ulang";
  return r.note ? `${r.note}${r.title ? `: ${r.title}` : ""}` : "Halaman dibaca";
}
