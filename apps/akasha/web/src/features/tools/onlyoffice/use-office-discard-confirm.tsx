import { useRef, useState } from "react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

interface PendingConfirm {
  /** Hapus atas permintaan user (tombol "Hapus dokumen"), bukan karena batal */
  explicit: boolean;
  resolve: (ok: boolean) => void;
}

/**
 * Konfirmasi untuk dokumen ONLYOFFICE yang dibuat di form tambah lampiran/resource tetapi belum disimpan:
 * - batal / ganti tipe / tutup form → tanpa tanya: dokumen yang sudah berisi tidak dibuang server melainkan dipindah ke
 *   Tools → ONLYOFFICE → Dokumen (keputusan user 2026-11-15), dokumen yang belum disunting dibuang;
 * - tombol "Hapus dokumen" (`explicit`) → selalu konfirmasi, dokumen dipindah ke Sampah.
 * `confirm()` mengembalikan `true` bila boleh dilanjutkan. Render `dialog` di dalam form.
 */
export function useOfficeDiscardConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolvedRef = useRef(false);

  const confirm = async (uploadId: string, options: { explicit?: boolean } = {}) => {
    const explicit = !!options.explicit;
    if (!explicit || !uploadId) return true;
    return new Promise<boolean>((resolve) => {
      resolvedRef.current = false;
      setPending({ explicit, resolve });
    });
  };

  const finish = (ok: boolean) => {
    if (!pending || resolvedRef.current) return;
    resolvedRef.current = true;
    pending.resolve(ok);
    setPending(null);
  };

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      onOpenChange={(open) => !open && finish(false)}
      title="Hapus dokumen ini?"
      description="Dokumen yang dibuat di ONLYOFFICE dipindah ke Sampah dan bisa dipulihkan selama 30 hari. Anda bisa memilih jenis dokumen lain setelahnya."
      confirmLabel="Hapus dokumen"
      cancelLabel="Kembali"
      onConfirm={() => finish(true)}
    />
  );

  return { confirm, dialog };
}
