import { CheckCircle2, CircleDashed, ExternalLink, Network, Sparkles, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAiSettings } from "@/data/use-ai-settings";
import { errorMessage } from "@/lib/api/client";
import type { AiSettings } from "@/types/api";
import { akaiTaskRows } from "./ai-settings-utils";

/**
 * Pengaturan → Model AI: semua fitur AI Akasha (chatbot, RAG, Pencarian Pintar, Notes AI, OCR, Rapikan dokumen, agen,
 * transkrip) memakai model yang diatur di Akai → Model. Halaman ini menampilkan status per tugas.
 */
export function AiSettingsTab() {
  const { data, isLoading, error } = useAiSettings();

  if (isLoading) return <PageLoader />;
  if (!data) {
    return (
      <SectionCard icon={Sparkles} title="Model AI">
        <p className="text-sm text-destructive">Gagal memuat pengaturan AI: {errorMessage(error)}</p>
      </SectionCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AkaiCard akai={data.akai} />
      <SectionCard
        icon={Sparkles}
        title="Indeks & pengetahuan"
        description="Indeks pengetahuan (RAG) memakai model Embedding di Akai. Tanpa model Embedding, pencarian kata tetap bekerja."
      >
        <div className="flex flex-wrap gap-2 text-sm">
          <Button size="sm" variant="outline" asChild>
            <Link to="/tools/index">Tools → Indeks Pengetahuan</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/tools/knowledge">Tools → Basis Pengetahuan</Link>
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

/** Akai = satu tempat router & API key model untuk semua aplikasi workingspace.id. */
function AkaiCard({ akai }: { akai: AiSettings["akai"] }) {
  const manage = akai.webUrl ? `${akai.webUrl}/models?tab=tasks` : null;
  const rows = akaiTaskRows(akai);
  return (
    <SectionCard
      icon={Network}
      title="Akai — model AI untuk semua aplikasi"
      description="Router, API key, model, cadangan, dan biaya diatur sekali di Akai. Akasha tidak menyimpan API key."
      action={
        manage && akai.available ? (
          <Button size="sm" asChild>
            <a href={manage} target="_blank" rel="noreferrer">
              Atur di Akai <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        ) : undefined
      }
    >
      {!akai.available ? (
        <p className="text-sm text-muted-foreground">
          Akai belum aktif di server (AKAI_URL / klien Akasha) atau akun ini belum masuk lewat akun Workingspace. Fitur
          AI belum bisa dipakai.
        </p>
      ) : !akai.reachable ? (
        <p className="flex items-center gap-1.5 text-sm text-warning">
          <TriangleAlert className="size-4" /> Akai tidak dapat dihubungi — fitur AI berhenti sementara. Coba lagi
          sebentar.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-start gap-2 rounded-xl border px-3 py-2 text-sm">
              {row.models > 0 ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {row.label}{" "}
                  <Badge variant={row.models > 0 ? "secondary" : "outline"} className="ml-1 font-normal">
                    {row.models > 0 ? `${row.models} model` : "belum diatur"}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">{row.uses}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
