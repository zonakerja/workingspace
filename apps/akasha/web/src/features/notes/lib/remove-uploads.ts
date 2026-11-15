import { uploadsApi } from "@/lib/api/endpoints";

/** Pindahkan berkas tersimpan ke Sampah tanpa mengganggu user bila gagal (mis. sudah terhapus). */
export const removeUploads = (ids: string[]) => {
  ids.forEach((id) => void uploadsApi.remove(id).catch(() => undefined));
};

/** Buang permanen unggahan sesi yang belum pernah tersimpan (tidak masuk Sampah). */
export const discardUploads = (ids: string[]) => {
  ids.forEach((id) => void uploadsApi.discard(id).catch(() => undefined));
};

/** Pisahkan berkas tersimpan (→ Sampah) dari unggahan sesi ini (→ dibuang permanen). */
export const releaseUploads = (ids: string[], session: Set<string>) => {
  removeUploads(ids.filter((id) => !session.has(id)));
  discardUploads(ids.filter((id) => session.has(id)));
};

/**
 * Hapus berkas dan kembalikan ID yang ditolak karena bukan hak user (403) — mis. kolaborator berizin Edit menghapus
 * gambar/dokumen yang diunggah pemilik. ID itu dicatat di catatan (`orphanUploadIds`) lalu dibersihkan saat pemilik
 * membuka Notes (`useOrphanUploadsJanitor`).
 */
export async function removeUploadsCollectForbidden(ids: string[]): Promise<string[]> {
  const results = await Promise.all(
    [...new Set(ids)].map((id) =>
      uploadsApi.remove(id).then(
        () => null,
        (error: unknown) => ((error as { status?: number })?.status === 403 ? id : null),
      ),
    ),
  );
  return results.filter((id): id is string => !!id);
}

/** Gabungkan daftar berkas yatim tanpa duplikat. */
export const mergeOrphanIds = (current: string[] | undefined, added: string[]) => [
  ...new Set([...(current ?? []), ...added]),
];
