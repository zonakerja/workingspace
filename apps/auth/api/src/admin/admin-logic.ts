/** Aturan pengelolaan akun oleh super admin (logika murni, diuji di admin-logic.spec.ts). */

export interface AccountChange {
  disabled?: boolean;
  superAdmin?: boolean;
}

/**
 * Pesan galat bila perubahan tidak boleh, atau null. Super admin tidak bisa menonaktifkan / mencabut super admin dirinya
 * sendiri, dan ekosistem harus selalu punya minimal satu super admin aktif.
 */
export function accountChangeProblem(
  change: AccountChange,
  ctx: { self: boolean; targetSuperAdmin: boolean; activeSuperAdmins: number },
): string | null {
  if (ctx.self && change.disabled) return "Anda tidak bisa menonaktifkan akun sendiri.";
  if (ctx.self && change.superAdmin === false) return "Anda tidak bisa mencabut status super admin sendiri.";
  const removesSuperAdmin = ctx.targetSuperAdmin && (change.superAdmin === false || change.disabled === true);
  if (removesSuperAdmin && ctx.activeSuperAdmins <= 1) return "Harus ada minimal satu super admin aktif.";
  return null;
}

/** Kata kunci pencarian akun → filter (nama / email, tanpa peka huruf besar). */
export function accountSearch(q: string | undefined) {
  const term = q?.trim();
  if (!term) return {};
  return {
    OR: [
      { email: { contains: term, mode: "insensitive" as const } },
      { name: { contains: term, mode: "insensitive" as const } },
    ],
  };
}
