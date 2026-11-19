import { CheckCircle2, Info, Library, RefreshCw, ServerCog, Settings2, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConverterDocuments } from "./converter-documents";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearchParam } from "@/hooks/use-search-param";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useConverterPrefs,
  useConverterStats,
  useConverterStatus,
  useReconvert,
  useUpdateConverterPrefs,
} from "@/data/use-converter";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { ConverterMode, ConverterPrefs, ConverterReconvertScope, ConverterStatus } from "@/types/api";
import { formatCount, methodRows, PDF_MODE_OPTIONS, RECONVERT_INFO, ENHANCE_SCOPE_OPTIONS } from "./converter-utils";

const START_COMMAND = "docker compose --profile converter up -d --wait converter";

/**
 * Tools → Markdown Converter: berkas diubah ke Markdown di server sendiri (MarkItDown untuk dokumen teks, Docling untuk
 * gambar & PDF scan/bergambar) sebelum dibaca fitur AI, sehingga AI tidak membayar token untuk membaca berkas.
 */
export function ConverterSettings() {
  const { data: status, isLoading } = useConverterStatus();
  const { data: prefs } = useConverterPrefs();
  const [sub, setSub] = useSearchParam("sub");
  if (isLoading) return <PageLoader />;
  const active = !!status?.reachable && !!prefs?.enabled;
  const tab = sub === "settings" ? "settings" : "documents";
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <StatusCard status={status} />
      <Tabs value={tab} onValueChange={(value) => setSub(value === "documents" ? null : value)}>
        <TabsList>
          <TabsTrigger value="documents">
            <Library /> Dokumen
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 /> Pengaturan
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "documents" ? (
        <ConverterDocuments status={status} prefs={prefs} />
      ) : (
        <>
          {prefs && <PrefsCard prefs={prefs} status={status} />}
          <StoredFilesCard active={active} enhance={!!prefs?.aiEnhance} />
          <HowItWorks />
        </>
      )}
    </div>
  );
}

function StatusCard({ status }: { status?: ConverterStatus }) {
  const reachable = !!status?.reachable;
  return (
    <SectionCard
      icon={ServerCog}
      title="Service converter"
      description="MarkItDown & Docling berjalan di server Akasha sendiri — isi berkas tidak dikirim ke penyedia AI."
      action={
        <Badge variant="outline" className={cn(reachable ? "text-success" : "text-warning")}>
          {reachable
            ? status?.ready
              ? "Aktif"
              : "Memuat model…"
            : status?.configured
              ? "Tidak menyala"
              : "Belum diatur"}
        </Badge>
      }
      contentClassName="flex flex-col gap-3 text-sm"
    >
      {reachable && status ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <Stat label="MarkItDown" value={status.engines.markitdown ?? "-"} />
          <Stat label="Docling" value={status.engines.docling ?? "-"} />
          <Stat label="Bahasa OCR" value={status.ocrLanguages.join(", ") || "-"} />
          <Stat label="Batas berkas" value={`${status.maxMb} MB`} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-warning">
            <TriangleAlert className="size-3.5" />
            {status?.configured
              ? "Service converter belum menyala. Sementara itu berkas dibaca pembaca bawaan, dan gambar/scan lewat OCR AI."
              : "CONVERTER_URL & CONVERTER_TOKEN belum diisi di server (backend/.env)."}
          </p>
          {status?.configured && (
            <p className="text-muted-foreground">
              Nyalakan di terminal WSL: <code className="rounded bg-muted px-1 py-0.5">{START_COMMAND}</code>
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "truncate text-sm font-semibold",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function PrefsCard({ prefs, status }: { prefs: ConverterPrefs; status?: ConverterStatus }) {
  const update = useUpdateConverterPrefs();
  const save = (input: Partial<ConverterPrefs>) =>
    update.mutate(input, { onError: (error) => toast.error("Gagal menyimpan", { description: errorMessage(error) }) });
  const pdfHint = PDF_MODE_OPTIONS.find((o) => o.value === prefs.pdfMode)?.hint;

  return (
    <SectionCard
      icon={Settings2}
      title={<label htmlFor="converter-enabled">Pakai Markdown Converter untuk semua fitur AI</label>}
      description="Berkas yang diunggah di mana pun (lampiran, Resource, Notes AI, My Notebook, Approval, vault Obsidian) dibaca converter dulu."
      action={
        <Switch id="converter-enabled" checked={prefs.enabled} onCheckedChange={(enabled) => save({ enabled })} />
      }
      contentClassName="flex flex-col gap-4"
    >
      {prefs.enabled && !status?.reachable && (
        <p className="text-xs text-warning">
          Menyala, tetapi service belum menyala → sementara memakai pembaca bawaan.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Cara membaca PDF</span>
          <Select
            value={prefs.pdfMode}
            disabled={!prefs.enabled}
            onValueChange={(value) => save({ pdfMode: value as ConverterMode })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PDF_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{pdfHint}</p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="converter-ai-ocr" className="text-sm font-medium">
              Cadangan OCR AI
            </label>
            <p className="text-xs text-muted-foreground">
              Bila converter tidak menemukan teks (tulisan tangan, foto buram) atau service mati, gambar & PDF scan
              dibaca AI lewat tugas OCR di Akai (memakai token). Matikan agar berkas tidak pernah dikirim ke AI untuk
              dibaca.
            </p>
          </div>
          <Switch
            id="converter-ai-ocr"
            checked={prefs.aiOcrFallback}
            onCheckedChange={(aiOcrFallback) => save({ aiOcrFallback })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="converter-ai-enhance" className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-module" /> Rapikan dengan AI
            </label>
            <p className="text-xs text-muted-foreground">
              Setelah dikonversi, AI merapikan <b>struktur</b> (judul, daftar, tabel, paragraf yang terpotong) dan{" "}
              <b>salah baca</b> (kata terpenggal, salah OCR) — tanpa meringkas atau menulis ulang. Hasil AI yang
              mengubah isi atau angka otomatis ditolak dan teks asli dipakai. Memakai token sekali per berkas (provider
              tugas{" "}
              <Link className="text-info underline-offset-2 hover:underline" to="/settings/api">
                Rapikan dokumen
              </Link>
              ).
            </p>
          </div>
          <Switch
            id="converter-ai-enhance"
            checked={prefs.aiEnhance}
            disabled={!prefs.enabled}
            onCheckedChange={(aiEnhance) => save({ aiEnhance })}
          />
        </div>
        {prefs.aiEnhance && (
          <div className="flex flex-col gap-1.5 md:max-w-sm">
            <span className="text-sm font-medium">Berkas yang dirapikan</span>
            <Select
              value={prefs.aiEnhanceScope}
              onValueChange={(value) => save({ aiEnhanceScope: value as ConverterPrefs["aiEnhanceScope"] })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENHANCE_SCOPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {ENHANCE_SCOPE_OPTIONS.find((o) => o.value === prefs.aiEnhanceScope)?.hint}
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function StoredFilesCard({ active, enhance }: { active: boolean; enhance: boolean }) {
  const { data: stats } = useConverterStats();
  const reconvert = useReconvert();
  const [confirm, setConfirm] = useState<ConverterReconvertScope | null>(null);
  const rows = methodRows(stats?.byMethod ?? {});

  const start = (scope: ConverterReconvertScope) =>
    reconvert.mutate(scope, {
      onSuccess: ({ queued }) =>
        toast.success(
          queued
            ? `${formatCount(queued)} berkas diantrekan untuk dibaca ulang.`
            : "Tidak ada berkas yang perlu dibaca ulang.",
        ),
      onError: (error) => toast.error("Gagal mengantrekan", { description: errorMessage(error) }),
    });

  return (
    <SectionCard
      icon={RefreshCw}
      title="Berkas tersimpan"
      description="Cara berkas Anda dibaca dan konversi ulang berkas lama ke Markdown."
      contentClassName="flex flex-col gap-4"
    >
      {rows.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((row) => (
            <Stat
              key={row.method}
              label={row.label}
              value={`${formatCount(row.count)} berkas`}
              tone={row.free ? undefined : "warning"}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Belum ada berkas yang dibaca.</p>
      )}
      <div className="flex flex-col gap-2">
        {(Object.keys(RECONVERT_INFO) as ConverterReconvertScope[])
          .filter((scope) => scope !== "unenhanced" || enhance)
          .map((scope) => {
            const count = stats?.reconvert[scope] ?? 0;
            return (
              <div
                key={scope}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {RECONVERT_INFO[scope].label} <span className="text-muted-foreground">· {formatCount(count)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{RECONVERT_INFO[scope].hint}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!active || !count || reconvert.isPending}
                  onClick={() => setConfirm(scope)}
                >
                  <RefreshCw /> Baca ulang
                </Button>
              </div>
            );
          })}
        {!active && (
          <p className="text-xs text-muted-foreground">
            Konversi ulang tersedia saat service menyala dan converter dipakai.
          </p>
        )}
      </div>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Baca ulang berkas?"
        destructive={false}
        confirmLabel="Ya, baca ulang"
        description={
          confirm
            ? `${formatCount(stats?.reconvert[confirm] ?? 0)} berkas dibaca ulang di latar belakang. Teks lama tetap dipakai sampai hasil baru selesai. Indeks pengetahuan ikut diperbarui (embedding ulang memakai sedikit kuota embedding).${enhance ? " Rapikan dengan AI memakai token untuk setiap berkas yang dirapikan." : ""}`
            : undefined
        }
        onConfirm={() => {
          if (confirm) start(confirm);
          setConfirm(null);
        }}
      />
    </SectionCard>
  );
}

function HowItWorks() {
  return (
    <SectionCard icon={Info} title="Cara kerja" contentClassName="flex flex-col gap-2 text-xs text-muted-foreground">
      <p className="flex gap-1.5">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-module" />
        <span>
          <b>MarkItDown</b> membaca dokumen berbasis teks (Word, Excel termasuk XLS, PowerPoint, PDF berlapisan teks,
          EPUB, HTML, Outlook) menjadi Markdown dengan judul, daftar, dan tabel. <b>Docling</b> membaca gambar dan PDF
          hasil scan / bergambar (OCR Tesseract bahasa Indonesia & Inggris, tata letak, tabel).
        </span>
      </p>
      <p className="flex gap-1.5">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
        <span>
          Hasil Markdown disimpan sekali per berkas lalu dipakai ulang oleh semua fitur: ringkasan AI Resource &
          lampiran, Notes AI, My Notebook, chatbot & Pencarian Pintar (indeks RAG), Approval & agen Hermes (alat MCP),
          dan berkas PDF di vault Obsidian. AI hanya menerima teks yang sudah rapi — tidak ada token untuk membaca
          berkas mentah.
        </span>
      </p>
      <p>
        Pengaturan model AI ada di{" "}
        <Link className="text-info underline-offset-2 hover:underline" to="/settings/api">
          Pengaturan → Model AI
        </Link>
        ; indeks pengetahuan di{" "}
        <Link className="text-info underline-offset-2 hover:underline" to="/tools/index">
          Tools → Indeks Pengetahuan
        </Link>
        .
      </p>
    </SectionCard>
  );
}
