/** Isi pita masa akses (logika murni, diuji di access-logic.test.ts). */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Pengingat di aplikasi mulai sekian hari sebelum akses habis. */
export const EXPIRING_WARN_DAYS = 14;

const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(date);

export type AccessBannerInfo =
  | { kind: "expiring"; expiresLabel: string; daysLeft: number }
  | { kind: "read_only"; expiresLabel: string; deleteLabel: string; daysLeft: number };

export function accessBannerInfo(
  user: { accessExpiresAt?: string | null; accessDeleteAt?: string | null } | null | undefined,
  now: Date,
): AccessBannerInfo | null {
  if (!user?.accessExpiresAt) return null;
  const expires = new Date(user.accessExpiresAt);
  if (now < expires) {
    const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / DAY_MS);
    return daysLeft <= EXPIRING_WARN_DAYS ? { kind: "expiring", expiresLabel: dateLabel(expires), daysLeft } : null;
  }
  const remove = user.accessDeleteAt ? new Date(user.accessDeleteAt) : null;
  if (!remove) return null;
  return {
    kind: "read_only",
    expiresLabel: dateLabel(expires),
    deleteLabel: dateLabel(remove),
    daysLeft: Math.max(0, Math.ceil((remove.getTime() - now.getTime()) / DAY_MS)),
  };
}
