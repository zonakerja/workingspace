import { FileStack, FileUp, FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useOfficeStatus, useOfficeTemplates, useOfficeWorkspace } from "@/data/use-office";
import { errorMessage } from "@/lib/api/client";
import { officeApi, uploadsApi } from "@/lib/api/endpoints";
import type { OfficeFormat, OfficeTemplate, UploadedAsset } from "@/types/api";
import { OFFICE_KIND_ICON } from "./office-editor-host";
import { NEW_DOCUMENT_TYPES } from "./office-formats";
import { TemplatePickerDialog } from "./template-browser";
import { DOCUMENT_ACCEPT, importNeedsConversion, isDocumentFile } from "./office-templates";

/** Pilihan tipe "Buat Dokumen (ONLYOFFICE)" di form lampiran / Resource (nilai UI, disimpan sebagai tipe `file`). */
export const OFFICE_ATTACHMENT_TYPE = "office";
export const OFFICE_ATTACHMENT_LABEL = "Buat Dokumen (ONLYOFFICE)";

/** Context dokumen ruang kerja Tools → ONLYOFFICE → Dokumen (tidak masuk Resource). */
export const OFFICE_WORKSPACE_CONTEXT = "office-workspace";

/** ONLYOFFICE aktif di server → pilihan "Buat Dokumen" ditawarkan di form. */
export const useOfficeEnabled = () => useOfficeStatus().data?.enabled ?? false;

interface NewOfficeDocumentPickerProps {
  /** Judul dokumen (isi "Nama Resource" di form); kosong → nama jenis dokumen / templat / berkas */
  title?: string;
  /** Konteks upload lampiran (mis. "task", "schedule") */
  context?: string;
  /** Pemilik item bersama (izin edit) — dokumen disimpan atas nama pemilik, seperti upload lampiran */
  ownerId?: string;
  disabled?: boolean;
  /** Dokumen sudah dibuat (berkas baru, belum tersimpan di form — perlakukan seperti hasil upload) */
  onCreated: (asset: UploadedAsset) => void;
}

/**
 * Isi tipe "Buat Dokumen" di form lampiran & form Resource: dokumen kosong (Dokumen / Spreadsheet / Presentasi / PDF),
 * **templat** milik user (diunggah di Tools → ONLYOFFICE), atau **impor** berkas DOCX/XLSX/PPTX/… dari komputer.
 * Pemanggil yang membuka editor (agar bisa meringkas setelah editor ditutup).
 */
export function NewOfficeDocumentPicker({
  title,
  context,
  ownerId,
  disabled,
  onCreated,
}: NewOfficeDocumentPickerProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const { data: templates = [] } = useOfficeTemplates();
  const importRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Dokumen ruang kerja Tools → ONLYOFFICE → Dokumen hanya ditawarkan di form Working Space (bukan di ruang kerja itu sendiri)
  const fromWorkspace = context !== OFFICE_WORKSPACE_CONTEXT;
  const { data: workspace = [] } = useOfficeWorkspace(fromWorkspace);
  const workspaceDocs: OfficeTemplate[] = workspace.flatMap((doc) =>
    doc.target ? [{ ...doc, target: doc.target }] : [],
  );
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  /** true = dokumen dibuat (error ditampilkan sebagai toast). */
  const run = async (key: string, task: () => Promise<UploadedAsset>) => {
    setBusy(key);
    try {
      onCreated(await task());
      return true;
    } catch (err) {
      toast.error("Dokumen gagal dibuat", { description: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = (format: OfficeFormat) =>
    run(format, () =>
      officeApi.createDocument(
        { format },
        { title: title?.trim() || `${NEW_DOCUMENT_TYPES[format].label} baru`, context, ownerId },
      ),
    );

  // Isi templat disalin ke dokumen baru (templat tetap utuh); judul kosong → nama templat
  // Gagal → modal tetap terbuka (pencarian & halaman tidak hilang) agar bisa dicoba lagi
  const createFromTemplate = async (template: OfficeTemplate) => {
    const created = await run(`template:${template.id}`, () =>
      officeApi.createDocument({ templateId: template.id }, { title: title?.trim() || undefined, context, ownerId }),
    );
    if (created) setPickerOpen(false);
  };

  // Dokumen ruang kerja dipanggil ke Working Space sebagai SALINAN (dokumen di Tools tetap utuh & tidak menjadi Resource)
  const createFromWorkspace = async (doc: OfficeTemplate) => {
    const created = await run(`workspace:${doc.id}`, () =>
      officeApi.createDocument({ templateId: doc.id }, { title: title?.trim() || doc.name, context, ownerId }),
    );
    if (created) setWorkspaceOpen(false);
  };

  // Impor: berkas diunggah apa adanya; format lama yang hanya bisa dilihat (DOC, PPT, …) dikonversi ke DOCX/PPTX
  const importFile = (file: File) => {
    if (!isDocumentFile(file.name, file.type)) {
      toast.error("Format tidak didukung", {
        description: "Pilih dokumen, spreadsheet, presentasi, atau PDF (DOCX, XLSX, PPTX, ODT, DOC, PDF, …).",
      });
      return;
    }
    void run("import", async () => {
      const uploaded = await uploadsApi.upload(file, context, ownerId);
      if (!importNeedsConversion(file.name, file.type)) return uploaded;
      try {
        return await officeApi.createDocument(
          { templateId: uploaded.id },
          { title: title?.trim() || file.name.replace(/\.[^.]+$/, ""), context, ownerId },
        );
      } finally {
        await uploadsApi.discard(uploaded.id).catch(() => undefined);
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(NEW_DOCUMENT_TYPES) as OfficeFormat[]).map((format) => {
          const type = NEW_DOCUMENT_TYPES[format];
          const Icon = OFFICE_KIND_ICON[type.kind];
          return (
            <Button
              key={format}
              type="button"
              variant="secondary"
              size="sm"
              title={type.hint}
              disabled={disabled || !!busy}
              onClick={() => void create(format)}
            >
              {busy === format ? <Spinner /> : <Icon />} {type.label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Impor berkas DOCX, XLSX, PPTX, ODT, DOC, PDF, … dari komputer lalu sunting di ONLYOFFICE"
          disabled={disabled || !!busy}
          onClick={() => importRef.current?.click()}
        >
          {busy === "import" ? <Spinner /> : <FileUp />} Impor berkas
        </Button>
        <input
          ref={importRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importFile(file);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {fromWorkspace && workspaceDocs.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Salin dokumen dari Tools → ONLYOFFICE → Dokumen ke sini (dokumen asal tetap di ruang kerja)"
            disabled={disabled || !!busy}
            onClick={() => setWorkspaceOpen(true)}
          >
            <FolderOpen /> Dari Dokumen Saya <span className="text-muted-foreground">({workspaceDocs.length})</span>
          </Button>
        )}
        {templates.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !!busy}
            onClick={() => setPickerOpen(true)}
          >
            <FileStack /> Dari templat <span className="text-muted-foreground">({templates.length})</span>
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">
            Templat instansi (kop surat, nota dinas) bisa diunggah di{" "}
            <span className="font-medium">Tools → ONLYOFFICE → Dokumen → Templat dokumen</span>.
          </p>
        )}
      </div>
      <TemplatePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        templates={templates}
        selectingId={busy?.startsWith("template:") ? busy.slice("template:".length) : null}
        onSelect={(template) => void createFromTemplate(template)}
      />
      {fromWorkspace && (
        <TemplatePickerDialog
          open={workspaceOpen}
          onOpenChange={setWorkspaceOpen}
          templates={workspaceDocs}
          selectingId={busy?.startsWith("workspace:") ? busy.slice("workspace:".length) : null}
          onSelect={(doc) => void createFromWorkspace(doc)}
          heading="Dari Dokumen Saya"
          description="Dokumen dari Tools → ONLYOFFICE → Dokumen disalin ke sini sebagai dokumen baru. Dokumen asal tetap di ruang kerja dan tidak menjadi Resource."
        />
      )}
    </div>
  );
}
