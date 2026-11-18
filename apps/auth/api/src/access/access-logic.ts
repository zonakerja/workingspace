/**
 * Aturan masa akses aplikasi & pengajuan akses (logika murni, diuji di access-logic.spec.ts).
 *
 * Akses aplikasi boleh berbatas waktu (`app_memberships.expires_at`). Setelah habis, akun masih bisa masuk ke aplikasi
 * tetapi hanya **membaca** selama FREEZE_DAYS (waktu untuk mencadangkan data / mengajukan perpanjangan). Setelah masa beku
 * selesai akses berakhir dan aplikasi menghapus data akun itu.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lama masa beku (baca saja) setelah akses habis, sebelum data dihapus aplikasi. */
export const FREEZE_DAYS = 180;
/** Pilihan lama akses saat admin menyetujui (hari); null = tanpa batas. */
export const DURATION_OPTIONS = [30, 90, 180, 365] as const;
export const PURPOSE_MIN = 20;
export const PURPOSE_MAX = 1000;

export type AccessState = "active" | "read_only" | "ended";

export interface AccessInfo {
  state: AccessState;
  /** Akses penuh berakhir (null = tanpa batas) */
  expiresAt: Date | null;
  /** Data aplikasi dihapus pada (null = tanpa batas) */
  deleteAt: Date | null;
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

export function accessInfo(expiresAt: Date | null, now = new Date()): AccessInfo {
  if (!expiresAt) return { state: "active", expiresAt: null, deleteAt: null };
  const deleteAt = addDays(expiresAt, FREEZE_DAYS);
  const state: AccessState = now < expiresAt ? "active" : now < deleteAt ? "read_only" : "ended";
  return { state, expiresAt, deleteAt };
}

/** Bentuk JSON untuk API (tanggal ISO). */
export function accessJson(expiresAt: Date | null, now = new Date()) {
  const info = accessInfo(expiresAt, now);
  return {
    state: info.state,
    expiresAt: info.expiresAt?.toISOString() ?? null,
    deleteAt: info.deleteAt?.toISOString() ?? null,
  };
}

/**
 * Akhir masa akses baru saat disetujui: `days` null = tanpa batas. Perpanjangan selagi akses masih aktif dihitung dari
 * akhir masa lama (tidak memotong sisa); akses yang sudah habis dihitung dari sekarang.
 */
export function newExpiry(days: number | null, current: Date | null | undefined, now = new Date()): Date | null {
  if (days === null) return null;
  const from = current && current > now ? current : now;
  return addDays(from, days);
}

export function isDurationOption(days: unknown): days is number | null {
  return days === null || (DURATION_OPTIONS as readonly unknown[]).includes(days);
}

/**
 * Tahap email pengingat: 1 = 7 hari sebelum akses habis, 2 = akses habis (mulai baca saja), 3 = 30 hari sebelum data dihapus,
 * 4 = 7 hari sebelum dihapus, 5 = 1 hari sebelum dihapus.
 */
export const NOTICE_STAGES = [1, 2, 3, 4, 5] as const;
export type NoticeStage = (typeof NOTICE_STAGES)[number];

/** Saat setiap tahap jatuh tempo. */
function stageDueAt(stage: NoticeStage, expiresAt: Date): Date {
  const deleteAt = addDays(expiresAt, FREEZE_DAYS);
  switch (stage) {
    case 1:
      return addDays(expiresAt, -7);
    case 2:
      return expiresAt;
    case 3:
      return addDays(deleteAt, -30);
    case 4:
      return addDays(deleteAt, -7);
    case 5:
      return addDays(deleteAt, -1);
  }
}

/**
 * Tahap pengingat yang perlu dikirim sekarang (tahap tertinggi yang sudah jatuh tempo dan belum terkirim), atau null.
 * Hanya satu email per putaran: tahap yang terlewat (mis. server mati) tidak dikirim beruntun. Setelah data dihapus tidak
 * ada pengingat lagi.
 */
export function dueNotice(expiresAt: Date | null, sent: number, now = new Date()): NoticeStage | null {
  if (!expiresAt) return null;
  if (now >= addDays(expiresAt, FREEZE_DAYS)) return null;
  let due: NoticeStage | null = null;
  for (const stage of NOTICE_STAGES) if (stage > sent && now >= stageDueAt(stage, expiresAt)) due = stage;
  return due;
}

/** Ringkas isian tujuan pengajuan; pesan galat bila tidak sesuai. */
export function purposeProblem(purpose: string): string | null {
  const text = purpose.replace(/\s+/g, " ").trim();
  if (text.length < PURPOSE_MIN) return `Jelaskan tujuan atau kepentingan minimal ${PURPOSE_MIN} karakter.`;
  if (text.length > PURPOSE_MAX) return `Tujuan terlalu panjang (maks. ${PURPOSE_MAX} karakter).`;
  return null;
}

export const cleanPurpose = (purpose: string) =>
  purpose
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Boleh mengajukan akses aplikasi ini? Tidak boleh bila sudah ada pengajuan menunggu, atau akses masih aktif tanpa batas /
 * masih lebih dari 30 hari (perpanjangan baru dibuka 30 hari sebelum habis).
 */
export function requestProblem(
  ctx: { pending: boolean; membership: { expiresAt: Date | null } | null },
  now = new Date(),
): string | null {
  if (ctx.pending) return "Pengajuan untuk aplikasi ini masih menunggu keputusan admin.";
  const m = ctx.membership;
  if (!m) return null;
  if (!m.expiresAt) return "Anda sudah punya akses tanpa batas waktu ke aplikasi ini.";
  if (m.expiresAt.getTime() - now.getTime() > 30 * DAY_MS)
    return "Perpanjangan bisa diajukan mulai 30 hari sebelum masa akses berakhir.";
  return null;
}
