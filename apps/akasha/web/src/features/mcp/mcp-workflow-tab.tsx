import { FeatureWorkflowTab } from "@/features/agent/feature-workflow-tab";

/**
 * Aplikasi MCP → Workflow: Aplikasi MCP adalah fitur terbuka untuk agen (keputusan user 2026-11-13). Workflow buatan agen
 * berpenempatan `mcp` (mis. buat desain Canva dari catatan, catat isu Linear dari rapat) tampil di sini setelah disetujui
 * di Approval → Usulan Agen.
 */
export function McpWorkflowTab() {
  return (
    <FeatureWorkflowTab
      placement="mcp"
      feature="Aplikasi MCP"
      hint={`Minta agen di AI Agent → Chat membuat workflow yang memakai aplikasi tersambung (misalnya membuat desain Canva dari catatan rapat). Bila izin "Aplikasi MCP" diaktifkan, agen juga bisa meminta koneksi aplikasi baru atau perubahan izinnya — semuanya menunggu persetujuan Anda, dan kredensial aplikasi tetap Anda yang mengisi.`}
    />
  );
}
