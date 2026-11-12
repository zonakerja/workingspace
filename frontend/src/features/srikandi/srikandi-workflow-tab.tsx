import { FeatureWorkflowTab } from "@/features/agent/feature-workflow-tab";
import { SrikandiRegisterRequestsCard } from "./register-requests-card";

/**
 * SRIKANDI → Workflow: SRIKANDI adalah fitur terbuka untuk agen (keputusan user 2026-11-13). Workflow buatan agen
 * berpenempatan `srikandi` tampil di sini setelah disetujui, bersama permintaan pendaftaran naskah dari agen.
 */
export function SrikandiWorkflowTab() {
  return (
    <div className="grid grid-cols-1 gap-3">
      <SrikandiRegisterRequestsCard />
      <FeatureWorkflowTab
        placement="srikandi"
        feature="SRIKANDI"
        hint={`Minta agen di AI Agent → Chat membuat workflow untuk SRIKANDI, misalnya menyiapkan entri Register dari dokumen Approval atau memeriksa naskah ber-TTD yang belum diambil. Agen juga bisa menjalankan robot SRIKANDI (ambil naskah, referensi, klasifikasi, periksa Register) bila izin "SRIKANDI" diaktifkan; pendaftaran tetap menunggu persetujuan Anda, dan Kirim Konsep selalu Anda lakukan di SRIKANDI.`}
      />
    </div>
  );
}
