import { registerBlockers, type OutgoingEntry } from "./srikandi-register";
import { summarizeRobotJob } from "./robot-jobs";

/**
 * Logika murni robot SRIKANDI yang dipakai agen (Hermes) lewat MCP — diuji di `srikandi-agent-logic.spec.ts`.
 *
 * SRIKANDI adalah fitur terbuka untuk agen (keputusan user 2026-11-13, pola sama dengan e-Kinerja): agen boleh
 * **membaca** SRIKANDI (Daftar Naskah Keluar, referensi, klasifikasi), **memeriksa** satu entri Register tanpa menyimpan
 * (dryRun), dan **meminta** pendaftaran. Pendaftaran sungguhan (Simpan konsep di Log Naskah Keluar) hanya berjalan setelah
 * pemilik menyetujuinya di Approval → Usulan Agen; Kirim Konsep / Kirim Naskah / tanda tangan tidak pernah dilakukan robot.
 */

export const SRIKANDI_AGENT_TASKS = ["letters", "references", "classifications", "check"] as const;
export type SrikandiAgentTask = (typeof SRIKANDI_AGENT_TASKS)[number];

export const SRIKANDI_TASK_LABELS: Record<SrikandiAgentTask, string> = {
  letters: "Ambil Daftar Naskah Keluar",
  references: "Ambil referensi",
  classifications: "Ambil klasifikasi arsip",
  check: "Periksa Register (tanpa menyimpan)",
};

/** Jenis aksi agen untuk permintaan pendaftaran naskah (tabel `agent_actions`). */
export const SRIKANDI_REGISTER_KIND = "srikandi_register";
export const SRIKANDI_REGISTER_RECORD = "srikandi_outgoing";

/** ID entri Register (clientId record `srikandi_outgoing`). */
export const isEntryId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const text = (v: unknown, max = 160) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export const registerRequestTitle = (entry: Pick<OutgoingEntry, "subject">) =>
  `Daftarkan ke SRIKANDI: ${text(entry.subject, 120) || "(tanpa hal)"}`;

/** Status entri yang sudah tidak bisa didaftarkan lagi. */
export const isRegistered = (entry: Pick<OutgoingEntry, "status">) =>
  entry.status === "submitted" || entry.status === "done";

/**
 * Kenapa entri Register belum bisa diminta untuk didaftarkan (null = boleh). Pesan berbahasa Indonesia agar agen bisa
 * melengkapinya lewat update_record lalu mencoba lagi.
 */
export function registerRequestError(entry: OutgoingEntry): string | null {
  if (isRegistered(entry)) return "Entri ini sudah terdaftar di SRIKANDI.";
  const blockers = registerBlockers(entry);
  return blockers.length ? `Isian Register belum lengkap: ${blockers.join(", ")}.` : null;
}

const names = (picks: { label?: string }[] | undefined) => (picks ?? []).map((p) => text(p.label, 80)).filter(Boolean);

/** Isi entri saat diminta, diringkas untuk ditinjau pemilik sebelum menyetujui. */
export function registerSnapshot(entry: OutgoingEntry) {
  return {
    entryId: entry.id,
    formType: entry.formType ?? "keluar",
    subject: text(entry.subject, 300),
    docType: text(entry.docType, 80),
    nature: text(entry.nature, 80),
    classification: text(entry.classification, 120),
    number: entry.autoNumber ? "(ambil nomor otomatis)" : text(entry.number, 80),
    summary: text(entry.summary, 300),
    file: entry.file?.name ?? null,
    attachments: (entry.attachments ?? []).map((a) => a.name).slice(0, 20),
    recipients: [...names(entry.recipientGroups), ...names(entry.recipients), ...names(entry.recipientsExternal)].slice(
      0,
      20,
    ),
    verifiers: names(entry.verifiers).slice(0, 10),
    signer: entry.signer ? text(entry.signer.label, 80) : null,
  };
}

type CheckResult = { status: string; filled?: unknown; draft?: { number?: string | null } | null; runId?: string };

/** Hasil "Periksa" untuk agen: status & isian formulir yang terbaca robot, tanpa tangkapan layar. */
export function summarizeCheck(result: CheckResult) {
  return {
    status:
      result.status === "preview"
        ? "formulir terisi, TIDAK disimpan (periksa)"
        : result.status === "exists"
          ? "draf berhal sama sudah ada di Log Naskah Keluar"
          : result.status,
    isian_terisi: result.filled ?? null,
    nomor_draf: result.draft?.number ?? null,
  };
}

/** Ringkasan tugas yang selesai, satu baris Bahasa Indonesia. */
export function summarizeTask(task: SrikandiAgentTask, result: unknown): string {
  if (task === "letters") return summarizeRobotJob("srikandi_letters", result);
  if (task === "references") return summarizeRobotJob("srikandi_references", result);
  if (task === "classifications") return summarizeRobotJob("srikandi_classifications", result);
  const r = (result && typeof result === "object" ? result : {}) as CheckResult;
  return r.status === "exists"
    ? "Draf berhal sama sudah ada di Log Naskah Keluar"
    : r.status === "preview"
      ? "Formulir Register terisi tanpa disimpan — siap diminta pendaftarannya"
      : `Periksa selesai (${String(r.status ?? "?")})`;
}
