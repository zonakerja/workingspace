import {
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FileUp,
  Inbox,
  Info,
  RefreshCw,
  ServerCog,
  Settings2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Markdown } from "@/components/common/markdown";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useConverterPrefs,
  useConverterStats,
  useConverterStatus,
  useConvertFile,
  useReconvert,
  useUpdateConverterPrefs,
} from "@/data/use-converter";
import { useKnowledgeStatus } from "@/data/use-knowledge";
import { errorMessage } from "@/lib/api/client";
import { knowledgeApi } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";
import type {
  ConverterMode,
  ConverterPrefs,
  ConverterReconvertScope,
  ConverterResult,
  ConverterStatus,
  ConverterTokenComparison,
} from "@/types/api";
import {
  CONVERTER_ACCEPT,
  formatCount,
  formatDuration,
  inboxTitle,
  markdownFileName,
  methodRows,
  PDF_MODE_OPTIONS,
  RECONVERT_INFO,
  TRY_MODE_OPTIONS,
  tokenRows,
  providerLabel,
  ENHANCE_SCOPE_OPTIONS,
} from "./converter-utils";

const START_COMMAND = "docker compose --profile converter up -d --wait converter";
/** Batas isi catatan Inbox di server (`InboxNoteDto`). */
const INBOX_MAX_CHARS = 100_000;

/**
 * Tools → Markdown Converter: berkas diubah ke Markdown di server sendiri (MarkItDown untuk dokumen teks, Docling untuk
 * gambar & PDF scan/bergambar) sebelum dibaca fitur AI, sehingga AI tidak membayar token untuk membaca berkas.
 */
export function ConverterSettings() {
  const { data: status, isLoading } = useConverterStatus();
  const { data: prefs } = useConverterPrefs();
  if (isLoading) return <PageLoader />;
  const active = !!status?.reachable && !!prefs?.enabled;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <StatusCard status={status} />
      {prefs && <PrefsCard prefs={prefs} status={status} />}
      <TryCard key={prefs ? "ready" : "loading"} status={status} prefs={prefs} />
      <StoredFilesCard active={active} enhance={!!prefs?.aiEnhance} />
      <HowItWorks />
    </div>
  );
}

function StatusCard({ status }: { status?: ConverterStatus }) {
  const reachable = !!status?.reachable;
  return (
    <SectionCard
      icon={ServerCog}
      title="Service converter"
      description="MarkItDown & Docling berjalan di server LifeOS sendiri — isi berkas tidak dikirim ke penyedia AI."
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
              dibaca AI di Pengaturan → Model AI (memakai token). Matikan agar berkas tidak pernah dikirim ke AI untuk
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

function TryCard({ status, prefs }: { status?: ConverterStatus; prefs?: ConverterPrefs }) {
  const convert = useConvertFile();
  const { data: knowledge } = useKnowledgeStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ConverterMode>("auto");
  // Bawaan centang Rapikan = sakelar di Pengaturan converter; bisa diubah per percobaan
  const [enhance, setEnhance] = useState(() => prefs?.aiEnhance ?? false);
  // Bawaan mati: penghitungan token mengirim isi berkas ke Google (countTokens Gemini), walau perapinya provider lain
  const [compareTokens, setCompareTokens] = useState(false);
  const [result, setResult] = useState<ConverterResult | null>(null);
  const [version, setVersion] = useState<"enhanced" | "converter">("enhanced");
  const [view, setView] = useState<"preview" | "source">("preview");
  const [dragging, setDragging] = useState(false);
  const [savingInbox, setSavingInbox] = useState(false);
  const disabled = !status?.reachable || convert.isPending;
  const shown = result ? (version === "enhanced" && result.enhanced ? result.enhanced.markdown : result.markdown) : "";

  const run = (file: File) => {
    if (status && file.size > status.maxMb * 1024 * 1024) {
      toast.error(`Berkas maksimal ${status.maxMb} MB.`);
      return;
    }
    setResult(null);
    convert.mutate(
      { file, mode, enhance, compareTokens },
      {
        onSuccess: (data) => {
          setResult(data);
          setVersion(data.enhanced ? "enhanced" : "converter");
          setView("preview");
          if (data.enhanceError) toast.error("Rapikan AI gagal", { description: data.enhanceError });
        },
        onError: (error) => toast.error("Konversi gagal", { description: errorMessage(error) }),
      },
    );
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) run(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !disabled) run(file);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shown);
    toast.success("Markdown disalin.");
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([shown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = markdownFileName(result.fileName);
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveToInbox = async () => {
    if (!result) return;
    setSavingInbox(true);
    try {
      const { path } = await knowledgeApi.addToInbox({ title: inboxTitle(result.fileName), content: shown });
      toast.success("Disimpan ke Inbox Knowledge", { description: path });
    } catch (error) {
      toast.error("Gagal menyimpan ke Inbox", { description: errorMessage(error) });
    } finally {
      setSavingInbox(false);
    }
  };

  return (
    <SectionCard
      icon={FileCode2}
      title="Coba konversi"
      description="Ubah satu berkas ke Markdown untuk dilihat, disalin, diunduh, atau disimpan ke Inbox vault. Berkas tidak disimpan."
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select value={mode} onValueChange={(value) => setMode(value as ConverterMode)}>
          <SelectTrigger className="w-40" aria-label="Mesin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRY_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={enhance} onCheckedChange={(checked) => setEnhance(checked === true)} />
          Rapikan dengan AI
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={compareTokens} onCheckedChange={(checked) => setCompareTokens(checked === true)} />
          Bandingkan token
        </label>
        {compareTokens && (
          <p className="basis-full text-[11px] text-muted-foreground">
            Token dihitung dengan penghitung token Google Gemini (gratis, tanpa menjalankan model). Isi berkas ikut
            dikirim ke Google untuk dihitung — matikan untuk berkas rahasia. Butuh API key Gemini langsung.
          </p>
        )}
        <Button onClick={() => inputRef.current?.click()} disabled={disabled}>
          {convert.isPending ? <Spinner /> : <FileUp />}
          {convert.isPending ? (enhance ? "Mengonversi & merapikan…" : "Mengonversi…") : "Pilih berkas"}
        </Button>
        <input ref={inputRef} type="file" accept={CONVERTER_ACCEPT} className="hidden" onChange={onPick} />
      </div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground",
          dragging && "border-module bg-module-soft",
        )}
      >
        {convert.isPending
          ? "Sedang dikonversi. Gambar & PDF scan dibaca Docling (± 1–5 dtk per halaman); rapikan AI menambah beberapa detik per bagian."
          : "Atau seret berkas ke sini — PDF, DOCX, XLSX/XLS, PPTX, EPUB, HTML, CSV, gambar (PNG, JPG, WEBP, TIFF, …)."}
      </div>

      {result && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge>{result.engine === "docling" ? "Docling" : "MarkItDown"}</Badge>
            <span className="text-muted-foreground">{result.reason}</span>
            {result.pages ? <Badge variant="outline">{result.pages} halaman</Badge> : null}
            <Badge variant="outline">{formatCount(result.chars)} karakter</Badge>
            <Badge variant="outline">{formatDuration(result.durationMs)}</Badge>
            {result.enhanced && (
              <Badge variant="outline">
                <Sparkles /> Dirapikan oleh {providerLabel(result.enhanced.provider)}
                {result.enhanced.model ? ` (${result.enhanced.model})` : ""} ·{" "}
                {formatDuration(result.enhanced.durationMs)} · {result.enhanced.parts} bagian
              </Badge>
            )}
          </div>
          {[...result.warnings, ...(result.enhanced?.notes ?? [])].map((warning) => (
            <p key={warning} className="flex items-center gap-1.5 text-xs text-warning">
              <TriangleAlert className="size-3.5 shrink-0" />
              {warning}
            </p>
          ))}
          {result.enhanceError && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" />
              Rapikan AI gagal: {result.enhanceError}
            </p>
          )}
          {result.tokenComparison && <TokenComparison data={result.tokenComparison} />}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {result.enhanced && (
                <Tabs value={version} onValueChange={(value) => setVersion(value as "enhanced" | "converter")}>
                  <TabsList>
                    <TabsTrigger value="enhanced">Dirapikan AI</TabsTrigger>
                    <TabsTrigger value="converter">Hasil converter</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              <Tabs value={view} onValueChange={(value) => setView(value as "preview" | "source")}>
                <TabsList>
                  <TabsTrigger value="preview">Pratinjau</TabsTrigger>
                  <TabsTrigger value="source">Markdown</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => void copy()} disabled={!shown}>
                <Copy /> Salin
              </Button>
              <Button size="sm" variant="outline" onClick={download} disabled={!shown}>
                <Download /> Unduh .md
              </Button>
              {knowledge?.folder && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void saveToInbox()}
                  disabled={!shown || savingInbox || shown.length > INBOX_MAX_CHARS}
                  title={shown.length > INBOX_MAX_CHARS ? "Lebih dari 100.000 karakter" : undefined}
                >
                  {savingInbox ? <Spinner /> : <Inbox />} Simpan ke Inbox
                </Button>
              )}
            </div>
          </div>
          <div className="max-h-[32rem] min-h-24 overflow-y-auto rounded-xl border bg-muted/20 p-3">
            {!shown ? (
              <p className="text-sm text-muted-foreground">Tidak ada teks yang terbaca dari berkas ini.</p>
            ) : view === "preview" ? (
              <Markdown content={shown} className="text-sm" />
            ) : (
              <pre className="font-mono text-xs break-words whitespace-pre-wrap">{shown}</pre>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Tabel token: berkas dibaca AI langsung vs Markdown vs hasil rapikan + biaya rapikan. Dihitung dengan penghitung token Gemini
 * (alat ukur), bukan model yang memproses dokumen — dijelaskan di kepala tabel agar tidak dikira perapinya Gemini.
 */
function TokenComparison({ data }: { data: ConverterTokenComparison }) {
  if (!data.available) {
    return <p className="text-xs text-muted-foreground">Perbandingan token tidak tersedia: {data.reason}</p>;
  }
  const rows = tokenRows(data);
  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <span className="font-medium">Perkiraan token saat berkas dibaca AI</span>
        <span className="text-right text-muted-foreground">alat hitung: Gemini ({data.model})</span>
      </div>
      <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        Hanya alat ukur — bukan model yang merapikan. Angka di Claude/OpenAI sedikit berbeda; untuk PDF keduanya menagih
        teks dan gambar tiap halaman, sehingga membaca PDF langsung biasanya jauh lebih mahal daripada di Gemini.
      </p>
      <div className="divide-y text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0">
              {row.label}
              {row.hint && <span className="block text-[11px] text-muted-foreground">{row.hint}</span>}
            </span>
            <span className="shrink-0 text-right font-mono">
              {row.tokens === null ? "—" : formatCount(row.tokens)}
              {row.saving !== null && (
                <span className={cn("ml-2 font-sans", row.saving >= 0 ? "text-success" : "text-warning")}>
                  {row.saving >= 0 ? `hemat ${row.saving}%` : `+${-row.saving}%`}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
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
