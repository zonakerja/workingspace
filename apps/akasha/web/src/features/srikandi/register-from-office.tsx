import { FilePlus2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSrikandiOutgoings } from "@/data/collections";
import { officeApi } from "@/lib/api/endpoints";
import { links } from "@/lib/deep-links";
import { generateId } from "@/lib/ids";
import type { SrikandiOutgoing } from "@/types/entities";
import { RegisterDialog } from "./register-dialog";
import { emptyOutgoing, mainFileError, registerEntryForFile } from "./register-logic";

const nowIso = () => new Date().toISOString();

/**
 * Tombol "Register naskah" di header editor ONLYOFFICE: konsep yang sedang disusun langsung dibuka di modal Register Naskah
 * Keluar (file naskah = dokumen ini, hal dari nama berkas). Dokumen disimpan paksa dulu agar yang terdaftar adalah isi
 * terakhir. Bila dokumen ini sudah punya entri register, entri itu yang dibuka. Hanya untuk berkas yang diterima SRIKANDI
 * sebagai file naskah (DOCX/PDF).
 */
export function RegisterFromOfficeButton({
  uploadId,
  name,
  canEdit,
  onLeave,
}: {
  uploadId: string;
  name: string;
  canEdit: boolean;
  /** Dipanggil sebelum pindah ke menu Register (menutup editor) */
  onLeave: () => void;
}) {
  const navigate = useNavigate();
  const { items } = useSrikandiOutgoings();
  const [entry, setEntry] = useState<{ value: SrikandiOutgoing; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  if (mainFileError({ name })) return null;
  const existing = registerEntryForFile(items, uploadId);

  const open = async () => {
    if (canEdit) {
      setSaving(true);
      // Simpan isi terakhir editor ke LifeOS sebelum didaftarkan (gagal = tetap dibuka; ONLYOFFICE menyimpan otomatis)
      await officeApi.forceSave(uploadId).catch(() => undefined);
      setSaving(false);
    }
    if (existing) {
      setEntry({ value: existing, isNew: false });
      return;
    }
    const id = generateId("reg");
    setEntry({
      isNew: true,
      value: {
        ...emptyOutgoing(id),
        createdAt: nowIso(),
        subject: name.replace(/\.[^.]+$/, ""),
        file: { uploadId, name },
        uploadId,
        sourceType: "file",
        sourceTitle: name,
      },
    });
  };

  return (
    <>
      <Button variant="ghost" size="xs" disabled={saving} onClick={() => void open()}>
        {saving ? <Loader2 className="animate-spin" /> : <FilePlus2 />}{" "}
        <span className="hidden sm:inline">{existing ? "Register naskah (sudah ada)" : "Register naskah"}</span>
      </Button>
      <RegisterDialog
        open={!!entry}
        entry={entry?.value ?? null}
        isNew={entry?.isNew ?? false}
        onClose={() => setEntry(null)}
        onSaved={(saved) =>
          toast.success("Register naskah keluar disimpan.", {
            description: "Daftarkan ke SRIKANDI dari menu SRIKANDI → Register Naskah Keluar.",
            action: {
              label: "Buka Register",
              onClick: () => {
                onLeave();
                void navigate(links.srikandiRegister(saved.id));
              },
            },
          })
        }
      />
    </>
  );
}
