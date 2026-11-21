import { FeatureWorkflowTab } from "@/features/agent/feature-workflow-tab";

/**
 * SIMAN → Workflow: SIMAN adalah fitur terbuka untuk agen (keputusan user 2026-11-13). Workflow buatan agen berpenempatan
 * `siman` (mis. cek tiket satker, siapkan surat keputusan) tampil di sini setelah disetujui di Approval → Usulan Agen.
 */
export function SimanWorkflowTab() {
  return (
    <FeatureWorkflowTab
      placement="siman"
      feature="SIMAN"
      hint={`Ajarkan proses SIMAN kepada AI agent di AI Agent → Chat (misalnya cara mengecek tiket pengajuan satker dan lampiran Excel-nya), lalu minta AI agent membuat workflow untuk SIMAN. Bila izin "SIMAN" diaktifkan, AI agent bisa menjaga sesi dan membaca halaman SIMAN tanpa mengklik apa pun; memasukkan surat keputusan ke SIMAN belum dibangun.`}
    />
  );
}
