import { FeatureWorkflowTab } from "@/features/agent/feature-workflow-tab";

/**
 * e-Kinerja → Workflow: e-Kinerja adalah fitur terbuka untuk agen. Workflow buatan agen berpenempatan `ekinerja`
 * (mis. menyusun narasi renaksi bulanan) tampil di sini setelah disetujui di Approval → Usulan Agen.
 */
export function KinerjaWorkflowTab() {
  return (
    <FeatureWorkflowTab
      placement="ekinerja"
      feature="e-Kinerja"
      hint={`Minta agen di AI Agent → Chat membuat workflow untuk e-Kinerja, misalnya menyusun uraian renaksi bulan ini atau memeriksa bukti yang belum lengkap. Agen juga bisa menjalankan robot e-Kinerja (ambil SKP, pantau, periksa) bila izin "Robot e-Kinerja" diaktifkan; pengisian tetap menunggu persetujuan Anda.`}
    />
  );
}
