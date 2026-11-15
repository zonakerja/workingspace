/**
 * Context dokumen ruang kerja Tools → ONLYOFFICE → Dokumen (tidak masuk Resource). Didefinisikan di sini (bukan di modul
 * office) agar UploadsService bisa memakainya tanpa impor melingkar; `office.service.ts` mengekspor ulang.
 */
export const OFFICE_WORKSPACE_CONTEXT = "office-workspace";

/** Context yang dikelola fitur lain dan tidak boleh dipindah ke ruang kerja walau isinya sudah disunting. */
const NEVER_RESCUE = new Set([OFFICE_WORKSPACE_CONTEXT, "office-template", "knowledge_vault"]);

/**
 * "Buang unggahan" (`DELETE /uploads/:id?discard=1`) dari form Working Space yang ditutup / dibatalkan: dokumen yang sudah
 * pernah disunting & tersimpan di ONLYOFFICE (`version > 1` — versi hanya bertambah dari editor) tidak dihapus, melainkan
 * dipindah ke ruang kerja pemiliknya agar pekerjaan tidak hilang. Hanya berkas milik sendiri (kolaborator yang membuang
 * berkas di ruang pemilik item bersama tetap dibuang seperti biasa).
 */
export function shouldRescueOnDiscard(
  asset: { userId: string; version: number; context: string | null },
  userId: string,
) {
  return asset.userId === userId && asset.version > 1 && !NEVER_RESCUE.has(asset.context ?? "");
}
