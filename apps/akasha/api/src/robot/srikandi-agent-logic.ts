import { outgoingSignature, registerBlockers, type OutgoingEntry } from "./srikandi-register";
import { summarizeRobotJob } from "./robot-jobs";

/**
 * Logika murni robot SRIKANDI yang dipakai agen (Hermes) lewat MCP — diuji di `srikandi-agent-logic.spec.ts`.
 *
 * SRIKANDI adalah fitur terbuka untuk agen (keputusan user 2026-11-13, pola sama dengan e-Kinerja): agen boleh
 * **membaca** SRIKANDI (Daftar Naskah Keluar, referensi, klasifikasi), **memeriksa** satu entri Register tanpa menyimpan
 * (dryRun), dan **meminta** pendaftaran. Pendaftaran sungguhan (Simpan konsep di Log Naskah Keluar) hanya berjalan setelah
 * pemilik menyetujuinya di Approval → Usulan Agen; Kirim Konsep / Kirim Naskah / tanda tangan tidak pernah dilakukan robot.
 */

export type SrikandiAgentTask = "letters" | "inbox" | "references" | "classifications" | "check";

export const SRIKANDI_TASK_LABELS: Record<SrikandiAgentTask, string> = {
  letters: "Ambil Daftar Naskah Keluar",
  inbox: "Ambil Naskah Masuk & disposisi",
  references: "Ambil referensi",
  classifications: "Ambil klasifikasi arsip",
  check: "Periksa Register / perubahan konsep (tanpa menyimpan)",
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

export const registerRequestTitle = (entry: Pick<OutgoingEntry, "subject">, mode: RegisterMode = "register") =>
  `${mode === "update" ? "Perbarui di SRIKANDI" : "Daftarkan ke SRIKANDI"}: ${text(entry.subject, 120) || "(tanpa hal)"}`;

/** `register` = daftarkan konsep baru; `update` = perbarui konsep yang sudah terdaftar lewat Edit di Log Naskah Keluar. */
export type RegisterMode = "register" | "update";

/** Status entri yang sudah tidak bisa didaftarkan lagi. */
const isRegistered = (entry: Pick<OutgoingEntry, "status">) => entry.status === "submitted" || entry.status === "done";

/** Entri terdaftar yang isinya berubah sejak terakhir dikirim (tanpa catatan pengiriman = dianggap perlu dicek). */
const changedSincePush = (entry: OutgoingEntry) =>
  !entry.pushedSignature || entry.pushedSignature !== outgoingSignature(entry);

/**
 * Jenis permintaan untuk entri ini, atau alasan ditolak (pesan berbahasa Indonesia agar agen bisa memperbaikinya lewat
 * update_record lalu mencoba lagi): belum terdaftar → daftarkan; sudah terdaftar & berubah → perbarui lewat Edit; naskah
 * final sudah tertaut / tidak ada perubahan → ditolak.
 */
export function registerRequestMode(entry: OutgoingEntry): { mode: RegisterMode } | { error: string } {
  if (entry.status === "done") return { error: "Naskah final sudah tertaut — konsep tidak bisa diubah lagi." };
  if (entry.draftSentAt) return { error: "Konsep sudah dikirim ke verifikator — tidak bisa diubah lewat Edit." };
  const blockers = registerBlockers(entry);
  if (blockers.length) return { error: `Isian Register belum lengkap: ${blockers.join(", ")}.` };
  if (!isRegistered(entry)) return { mode: "register" };
  if (!changedSincePush(entry)) return { error: "Tidak ada perubahan sejak terakhir dikirim ke SRIKANDI." };
  return { mode: "update" };
}

/** Kompatibel: alasan ditolak saja (null = boleh diminta). */
export function registerRequestError(entry: OutgoingEntry): string | null {
  const result = registerRequestMode(entry);
  return "error" in result ? result.error : null;
}

const names = (picks: { label?: string }[] | undefined) => (picks ?? []).map((p) => text(p.label, 80)).filter(Boolean);

/** Isi entri saat diminta, diringkas untuk ditinjau pemilik sebelum menyetujui. */
export function registerSnapshot(entry: OutgoingEntry, mode: RegisterMode = "register") {
  return {
    entryId: entry.id,
    mode,
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

type CheckResult = {
  status: string;
  filled?: unknown;
  draft?: { number?: string | null } | null;
  runId?: string;
  plan?: string[];
  warnings?: string[];
};

/** Hasil "Periksa" untuk agen: status & isian formulir yang terbaca robot, tanpa tangkapan layar. */
export function summarizeCheck(result: CheckResult) {
  if (result.plan) {
    return {
      status:
        result.status === "unchanged"
          ? "konsep di SRIKANDI sudah sama dengan entri"
          : "rencana perubahan konsep, TIDAK disimpan (periksa)",
      langkah: result.plan,
      peringatan: result.warnings ?? [],
    };
  }
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
  if (task === "inbox") return summarizeRobotJob("srikandi_inbox", result);
  if (task === "references") return summarizeRobotJob("srikandi_references", result);
  if (task === "classifications") return summarizeRobotJob("srikandi_classifications", result);
  const r = (result && typeof result === "object" ? result : {}) as CheckResult;
  if (r.plan)
    return r.status === "unchanged"
      ? "Konsep di SRIKANDI sudah sama"
      : `${r.plan.length} perubahan direncanakan untuk konsep`;
  return r.status === "exists"
    ? "Draf berhal sama sudah ada di Log Naskah Keluar"
    : r.status === "preview"
      ? "Formulir Register terisi tanpa disimpan — siap diminta pendaftarannya"
      : `Periksa selesai (${String(r.status ?? "?")})`;
}
