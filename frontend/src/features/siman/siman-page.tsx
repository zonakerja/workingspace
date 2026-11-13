import { FileCheck2, Inbox, Workflow } from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import { ModulePage } from "@/components/layout/module-page";
import { Card } from "@/components/ui/card";
import { RobotSettings } from "@/features/tools/robot/robot-settings";
import { SimanWorkflowTab } from "./siman-workflow-tab";

const STEPS: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  text: string;
  to?: string;
  link?: string;
}[] = [
  {
    icon: Inbox,
    title: "1. Cek tiket dari satker",
    text: "Koneksi ini mengecek tiket pengajuan yang masuk di SIMAN beserta lampirannya.",
  },
  {
    icon: Workflow,
    title: "2. Diproses agen",
    text: "Proses yang diajarkan pemilik dijalankan agen sebagai workflow SIMAN; hasilnya diperiksa di Approval.",
    to: "/siman/workflow",
    link: "Buka Workflow",
  },
  {
    icon: FileCheck2,
    title: "3. Masukkan surat keputusan",
    text: "Setelah produknya jadi, berkas surat keputusan dimasukkan kembali ke SIMAN.",
  },
];

/**
 * Connection & MCP → SIMAN: fitur terbuka untuk agen (keputusan user 2026-11-13). Kode koneksi tetap bawaan; proses tiket
 * & unggah SK dibangun Hermes sebagai workflow berpenempatan `siman` setelah prosesnya diajarkan pemilik.
 */
export function Component() {
  return (
    <ModulePage module="siman">
      {(tab) =>
        tab === "connector" ? (
          <RobotSettings systems={["siman"]} />
        ) : tab === "workflow" ? (
          <SimanWorkflowTab />
        ) : (
          <div className="grid grid-cols-1 gap-3">
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-sm text-warning">
              Pengecekan tiket dan unggah surat keputusan belum dibangun, menunggu prosesnya diajarkan kepada agen. Saat
              ini robot SIMAN hanya menjaga sesi login dan, atas permintaan agen, membaca halaman tanpa mengklik.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, text, to, link }) => (
                <Card key={title} className="grid content-start gap-2 p-4">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-module-soft text-module">
                    <Icon className="size-4" />
                  </span>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                  {to && (
                    <Link className="text-sm font-semibold text-module hover:underline" to={to}>
                      {link}
                    </Link>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )
      }
    </ModulePage>
  );
}
