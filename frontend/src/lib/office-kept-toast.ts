import { toast } from "sonner";

/**
 * Respons "buang unggahan" (`DELETE /uploads/:id?discard=1`) bertanda `kept`: dokumen ONLYOFFICE yang sudah disunting tidak
 * dibuang server melainkan dipindah ke Tools → ONLYOFFICE → Dokumen (form Working Space ditutup / dibatalkan). Beri tahu
 * user agar tahu ke mana dokumennya pergi dan bisa membersihkannya.
 */
export function withOfficeKeptToast<T extends { kept?: boolean }>(promise: Promise<T>) {
  return promise.then((result) => {
    if (result?.kept) {
      toast.info("Dokumen disimpan ke Tools → ONLYOFFICE → Dokumen", {
        description: "Dokumen yang sudah Anda isi tidak dibuang. Hapus dari sana bila tidak diperlukan.",
        action: {
          label: "Buka",
          // Dimuat saat diklik: router mengimpor semua halaman (menghindari impor melingkar dengan klien API)
          onClick: () => void import("@/app/router").then(({ router }) => router.navigate("/tools/onlyoffice")),
        },
      });
    }
    return result;
  });
}
