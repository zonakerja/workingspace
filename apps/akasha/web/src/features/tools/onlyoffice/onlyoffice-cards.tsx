import { AlertTriangle, FilePen, FileStack, RefreshCw, Sparkles, Trash2, Type, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/data/query-keys";
import {
  useOfficeFonts,
  useOfficePreferences,
  useOfficeTemplates,
  useUpdateOfficePreferences,
} from "@/data/use-office";
import { errorMessage } from "@/lib/api/client";
import { officeApi, uploadsApi } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";
import type { OfficeTemplate } from "@/types/api";
import { useQueryClient } from "@tanstack/react-query";
import { openOfficeEditor } from "./office-editor-host";
import { DOCUMENT_ACCEPT, TEMPLATE_CONTEXT, isDocumentFile } from "./office-templates";
import { TemplateBrowser } from "./template-browser";

/**
 * AI di editor (keputusan user): tab **AI** bawaan ONLYOFFICE (Chatbot, Summarization, Translation, Grammar & Spelling,
 * asisten kustom, OCR) dengan provider & API key yang sama dengan Pengaturan → Model AI — satu pintu, tanpa pengaturan key di
 * editor. Sakelar pribadi; berlaku saat dokumen dibuka berikutnya.
 */
export function OfficeAiCard() {
  const { data, isLoading, error } = useOfficePreferences();
  const update = useUpdateOfficePreferences();
  const checked = update.isPending && update.variables !== undefined ? update.variables : !!data?.ai;

  const change = (next: boolean) =>
    update.mutate(next, {
      onSuccess: () =>
        toast.success(next ? "AI di editor diaktifkan" : "AI di editor dimatikan", {
          description: "Berlaku saat dokumen dibuka berikutnya.",
        }),
      onError: (err) => toast.error("Pengaturan AI gagal disimpan", { description: errorMessage(err) }),
    });

  return (
    <SectionCard
      icon={Sparkles}
      title="AI di editor"
      description="Tab AI ONLYOFFICE memakai AI Akasha (Pengaturan → Model AI)."
    >
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Label
            htmlFor="office-ai-switch"
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal",
              checked && "border-module bg-module-soft",
            )}
          >
            <Switch
              id="office-ai-switch"
              checked={checked}
              disabled={update.isPending}
              onCheckedChange={change}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block font-semibold">Aktifkan tab AI di editor</span>
              <span className="text-sm text-muted-foreground">
                Semua fitur AI bawaan ONLYOFFICE — Chatbot, Summarization, Translation, Grammar & Spelling, asisten
                kustom, OCR PDF — dijawab provider AI Anda
                {data?.provider ? (
                  <>
                    {" "}
                    (<b>{data.provider.label}</b> · {data.provider.model})
                  </>
                ) : null}
                . API key tetap di server Akasha; tidak ada pengaturan key di editor. Mati = tidak ada isi dokumen yang
                dikirim ke AI.
              </span>
            </span>
          </Label>
          {checked && data && !data.aiReady && (
            <Notice>
              AI belum bisa menjawab: pilih provider dan simpan API key di{" "}
              <Link to="/settings/api" className="font-medium underline">
                Pengaturan → Model AI
              </Link>
              .
            </Notice>
          )}
          <p className="text-xs text-muted-foreground">
            Pilih teks dulu agar AI memproses bagian itu saja. Bahasa hasil ringkasan/terjemahan dipilih di jendela
            fiturnya (Target language). Pembuatan gambar belum didukung.
          </p>
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Modal Templat dokumen (Tools → ONLYOFFICE → Dokumen, tombol "Templat dokumen"): unggah, lihat, sunting, hapus templat.
 * Templat dipakai "Dari templat" saat membuat dokumen (ruang kerja maupun form Working Space).
 */
export function OfficeTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: templates = [], isLoading } = useOfficeTemplates();
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<OfficeTemplate | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.officeTemplates });

  const upload = async (files: File[]) => {
    const valid = files.filter((file) => isDocumentFile(file.name, file.type));
    if (valid.length < files.length) {
      toast.error("Sebagian berkas dilewati", {
        description: "Templat harus berupa dokumen, spreadsheet, presentasi, atau PDF.",
      });
    }
    if (valid.length === 0) return;
    setUploading(true);
    try {
      for (const file of valid) await uploadsApi.upload(file, TEMPLATE_CONTEXT);
      toast.success(valid.length > 1 ? `${valid.length} templat ditambahkan` : "Templat ditambahkan");
    } catch (err) {
      toast.error("Templat gagal diunggah", { description: errorMessage(err) });
    } finally {
      setUploading(false);
      void refresh();
    }
  };

  const remove = async (template: OfficeTemplate) => {
    try {
      await uploadsApi.remove(template.id);
      toast.success("Templat dihapus");
    } catch (err) {
      toast.error("Templat gagal dihapus", { description: errorMessage(err) });
    } finally {
      void refresh();
    }
  };

  // Editor ONLYOFFICE dibuka di atas halaman: modal templat ditutup dulu, lalu dibuka lagi setelah editor ditutup
  const edit = (template: OfficeTemplate) => {
    onOpenChange(false);
    openOfficeEditor({
      uploadId: template.id,
      name: template.originalName,
      onClosed: () => {
        void refresh();
        onOpenChange(true);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] grid-cols-1 flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileStack className="size-4 text-module" /> Templat dokumen
          </DialogTitle>
          <DialogDescription>
            Kop surat, nota dinas, notulen, format laporan — dipakai saat membuat dokumen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={DOCUMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void upload(files);
            }}
          />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Unggah DOCX/DOTX/ODT, XLSX/XLTX, PPTX/POTX, atau PDF. Saat membuat dokumen pilih <b>Dari templat</b>:
                isinya disalin ke dokumen baru (DOTX/ODT/… menjadi DOCX/XLSX/PPTX), templat tetap utuh. <b>Sunting</b>{" "}
                mengubah templat itu sendiri.
              </p>
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
                {uploading ? <Spinner /> : <Upload />} Unggah templat
              </Button>
            </div>
            {isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <TemplateBrowser
                templates={templates}
                actions={(template) => (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Sunting templat di ONLYOFFICE"
                      onClick={() => edit(template)}
                    >
                      <FilePen />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Hapus templat" onClick={() => setRemoving(template)}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              />
            )}
          </div>
          <ConfirmDialog
            open={!!removing}
            onOpenChange={(open) => !open && setRemoving(null)}
            title="Hapus templat?"
            itemName={removing?.name}
            description="Dokumen yang sudah dibuat dari templat ini tidak terpengaruh."
            confirmLabel="Hapus templat"
            onConfirm={() => {
              if (removing) void remove(removing);
              setRemoving(null);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Font server ONLYOFFICE (khusus admin; keputusan user): daftar keluarga font terpasang + unggah/hapus berkas font
 * tambahan. Berkas masuk folder bersama; ONLYOFFICE membuat ulang daftar font otomatis ± 1–2 menit kemudian.
 */
export function OfficeFontsCard() {
  const { data, isLoading, isFetching, refetch } = useOfficeFonts();
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const families = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (data?.families ?? []).filter((name) => !words || name.toLowerCase().includes(words));
  }, [data, query]);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.officeFonts });

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    let added = 0;
    for (const file of files) {
      try {
        await officeApi.uploadFont(file);
        added++;
      } catch (err) {
        toast.error(`${file.name} gagal diunggah`, { description: errorMessage(err) });
      }
    }
    setUploading(false);
    void refresh();
    if (added) {
      toast.success(added > 1 ? `${added} font diunggah` : "Font diunggah", {
        description:
          "Daftar font ONLYOFFICE diperbarui otomatis ± 1–2 menit lagi; editor yang terbuka tersambung ulang sebentar.",
      });
    }
  };

  const remove = async (name: string) => {
    try {
      await officeApi.deleteFont(name);
      toast.success("Font dihapus", { description: "Daftar font ONLYOFFICE diperbarui ± 1–2 menit lagi." });
    } catch (err) {
      toast.error("Font gagal dihapus", { description: errorMessage(err) });
    } finally {
      void refresh();
    }
  };

  return (
    <SectionCard
      icon={Type}
      title="Font"
      description={
        data?.available ? `${data.families.length} keluarga font terpasang di server ONLYOFFICE.` : "Font di editor."
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon-sm" title="Muat ulang daftar font" onClick={() => void refetch()}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
          </Button>
          {data?.uploadEnabled && (
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
              {uploading ? <Spinner /> : <Upload />} Unggah font
            </Button>
          )}
        </div>
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".ttf,.otf,.ttc"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void upload(files);
        }}
      />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Font tambahan</p>
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : !data?.uploadEnabled ? (
            <p className="text-sm text-muted-foreground">
              Unggah font belum aktif: isi <code className="rounded bg-muted px-1">ONLYOFFICE_FONTS_DIR</code> di
              backend (docs/ONLYOFFICE.md).
            </p>
          ) : data.files.length === 0 ? (
            <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
              Belum ada font tambahan. Contoh yang belum ada di server: Bookman Old Style, Century Gothic, Garamond,
              Segoe UI, font kop instansi.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.files.map((file) => (
                <li key={file.name} className="flex min-w-0 items-center gap-2 rounded-xl border p-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024).toLocaleString("id-ID", { maximumFractionDigits: 0 })} KB
                  </span>
                  <Button variant="ghost" size="icon-sm" title="Hapus font" onClick={() => setRemoving(file.name)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Berkas .ttf/.otf/.ttc (maks. 30 MB). Setelah unggah/hapus, ONLYOFFICE membuat ulang daftar font ± 1–2 menit
            (editor yang terbuka tersambung ulang sebentar); nama keluarga font = nama di dalam berkas. Pakai font yang
            boleh Anda pakai (lisensi).
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Terpasang di server</p>
            <SearchInput value={query} onChange={setQuery} placeholder="Cari font..." className="md:w-52" />
          </div>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !data?.available ? (
            <p className="text-sm text-muted-foreground">
              Daftar font tidak tersedia (server ONLYOFFICE tidak menjawab / sedang membuat ulang daftar font).
            </p>
          ) : (
            <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
              {families.map((name) => (
                <Badge key={name} variant="outline" className="font-normal" style={{ fontFamily: `"${name}"` }}>
                  {name}
                </Badge>
              ))}
              {families.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada font "{query}".</p>}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Hapus font?"
        itemName={removing ?? undefined}
        description="Dokumen yang memakai font ini akan tampil dengan font pengganti."
        confirmLabel="Hapus font"
        onConfirm={() => {
          if (removing) void remove(removing);
          setRemoving(null);
        }}
      />
    </SectionCard>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{children}</span>
    </p>
  );
}
