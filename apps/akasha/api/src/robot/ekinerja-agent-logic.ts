/**
 * Logika murni robot e-Kinerja yang dipakai agen (Hermes) lewat MCP — diuji di `ekinerja-agent-logic.spec.ts`.
 *
 * Agen boleh **membaca** e-Kinerja (Ambil SKP & RHK, Pantau Rencana Aksi, Periksa bulan tanpa klik) dan **meminta**
 * pengisian. Pengisian sungguhan hanya berjalan setelah pemilik menyetujui permintaan itu di Approval → Usulan Agen;
 * "Kirim Penilaian Ke Atasan" tidak pernah dilakukan robot.
 */

export type EkinerjaAgentTask = "skp" | "monitor" | "check";

export const EKINERJA_TASK_LABELS: Record<EkinerjaAgentTask, string> = {
  skp: "Ambil SKP & RHK",
  monitor: "Pantau Rencana Aksi",
  check: "Periksa Rencana Aksi (tanpa mengisi)",
};

/** Jenis aksi agen untuk permintaan pengisian (tabel `agent_actions`). */
export const EKINERJA_FILL_KIND = "ekinerja_fill";
export const EKINERJA_FILL_RECORD = "ekinerja_renaksi";

const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** Bulan renaksi `YYYY-MM` yang masuk akal (tahun 2020–2100). */
export function isPeriod(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return year >= 2020 && year <= 2100 && month >= 1 && month <= 12;
}

export const periodLabel = (period: string) =>
  isPeriod(period) ? `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}` : period;

export const isYear = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 2020 && value <= 2100;

export const fillRequestTitle = (period: string) => `Isi Rencana Aksi e-Kinerja ${periodLabel(period)}`;

/** Entri renaksi satu bulan yang akan diisikan, diringkas untuk ditinjau pemilik sebelum menyetujui. */
export function fillSnapshot(entries: Record<string, unknown>[], period: string) {
  const own = entries.filter((e) => e.period === period && !e.proposed);
  const text = (v: unknown, max = 160) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
  return {
    period,
    total: own.length,
    deleted: own.filter((e) => e.deleted).length,
    entries: own.slice(0, 30).map((e) => ({
      description: text(e.description) || text(e.sourceTitle) || "(tanpa uraian)",
      realization: text(e.realization),
      status: typeof e.status === "string" ? e.status : null,
      deleted: !!e.deleted,
    })),
  };
}

type CheckResult = {
  period: string;
  imported?: number;
  results: {
    skp: string;
    status: string;
    rewritten?: number;
    planned?: number;
    missing?: string[];
    rows?: unknown[];
  }[];
};

/**
 * Hasil "Periksa" diringkas untuk agen: per SKP status bulan, jumlah langkah yang akan dilakukan, indikator yang tidak
 * ditemukan, dan isi baris yang terbaca (dipotong) — agen tidak perlu menerima tangkapan layar / struktur halaman.
 */
export function summarizeCheck(result: CheckResult, maxRows = 40) {
  return {
    period: result.period,
    bulan: periodLabel(result.period),
    diimpor_dari_ekinerja: result.imported ?? 0,
    skp: result.results.map((r) => ({
      skp: r.skp,
      status_bulan:
        r.status === "submitted"
          ? "sudah diajukan (terkunci, tidak bisa diisi)"
          : r.status === "draft"
            ? "draf"
            : r.status,
      langkah_direncanakan: r.planned ?? 0,
      baris_ditulis_ulang: r.rewritten ?? 0,
      indikator_tidak_ditemukan: r.missing ?? [],
      baris_terbaca: (r.rows ?? []).slice(0, maxRows),
    })),
  };
}

/** Ringkasan tugas yang selesai, satu baris Bahasa Indonesia. */
export function summarizeTask(task: EkinerjaAgentTask, result: unknown): string {
  const r = (result && typeof result === "object" ? result : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  if (task === "skp") return `SKP ${num(r.year)}: ${num(r.skps)} SKP, ${num(r.rhk)} RHK`;
  if (task === "monitor") {
    const months = Array.isArray(r.months) ? r.months.length : 0;
    return `${months} bulan terbaca dari ${num(r.skps)} SKP, ${num(r.imported)} entri diimpor`;
  }
  const results = Array.isArray(r.results) ? (r.results as CheckResult["results"]) : [];
  const planned = results.reduce((sum, x) => sum + (x.planned ?? 0), 0);
  const locked = results.filter((x) => x.status === "submitted").length;
  return `${results.length} SKP diperiksa, ${planned} langkah direncanakan${locked ? `, ${locked} bulan terkunci` : ""}`;
}

/** Skill Hermes yang memetakan kegiatan bulanan ke RHK dan menyusun narasi renaksi. */
export const RENAKSI_SKILL = "renaksi-ekinerja";

/** Perintah run Hermes dari tombol "Generate usulan" di e-Kinerja → Rencana Aksi. */
export function renaksiRunInput(period: string) {
  return [
    `Gunakan skill ${RENAKSI_SKILL} untuk Rencana Aksi e-Kinerja ${periodLabel(period)} (period ${period}).`,
    `1. Panggil ekinerja_renaksi_context { period: "${period}" }.`,
    "2. Petakan setiap kegiatan yang relevan ke satu RHK (boleh lebih dari satu butir per kegiatan bila memang beberapa output).",
    "   Kegiatan yang sudah diputuskan pemilik dan yang tidak relevan dengan RHK mana pun dilewati. Area/Project yang dikecualikan",
    "   pemilik sudah tidak ada di daftar; jangan mengusulkannya dari sumber lain.",
    "3. Susun Renaksi = nama kegiatan / rencana aksi singkat, Realisasi = output pekerjaan (mis. dokumen apa yang dihasilkan),",
    "   memakai judul, keterangan, dan nama lampiran kegiatan. Jangan mengarang output yang tidak tersirat dari data.",
    `4. Simpan dengan ekinerja_propose_renaksi { period: "${period}", items: [...] }, lalu laporkan ringkas berapa usulan per RHK`,
    "   dan kegiatan yang dilewati beserta alasannya.",
    "Jangan memanggil ekinerja_request_fill dan jangan menjalankan robot: pemilik yang memutuskan usulan mana yang masuk e-Kinerja.",
  ].join("\n");
}
