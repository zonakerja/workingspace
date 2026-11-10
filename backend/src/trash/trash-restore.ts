import { Prisma } from "../generated/prisma/client";

/**
 * Baris salinan Sampah → data `create` Prisma: kolom JSON yang bernilai null harus `Prisma.DbNull` (null polos ditolak
 * Prisma untuk kolom Json), kolom lain apa adanya (tanggal ISO diterima Prisma).
 */
export function restorableRow<T extends Record<string, unknown>>(row: T, jsonKeys: readonly string[]) {
  const out: Record<string, unknown> = { ...row };
  for (const key of jsonKeys) if (out[key] === null) out[key] = Prisma.DbNull;
  return out as T;
}

/** Salin nilai ke bentuk JSON murni (tanggal → ISO) untuk disimpan sebagai snapshot. */
export const toSnapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
