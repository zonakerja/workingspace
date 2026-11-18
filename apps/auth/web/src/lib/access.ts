/** Tampilan masa akses & pengajuan (logika murni, diuji di access.test.ts). Aturan masa akses ada di server (access-logic.ts). */
import type { AccessInfo } from "./api";

export const PURPOSE_MIN = 20;
export const PURPOSE_MAX = 1000;

/** Pilihan lama akses saat admin menyetujui (hari); null = tanpa batas. */
export const DURATION_CHOICES: { days: number | null; label: string }[] = [
  { days: 30, label: "30 hari" },
  { days: 90, label: "3 bulan" },
  { days: 180, label: "6 bulan" },
  { days: 365, label: "1 tahun" },
  { days: null, label: "Tanpa batas" },
];

const DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const DAY_MS = 24 * 60 * 60 * 1000;

export const durationLabel = (days: number | null) =>
  DURATION_CHOICES.find((c) => c.days === days)?.label ?? `${days} hari`;

export type AccessTone = "success" | "info" | "warning" | "danger";

/** Label singkat masa akses: "Tanpa batas", "Berlaku s.d. 1 Des 2026", "Baca saja · dihapus 30 Mei 2027". */
export function accessLabel(
  access: AccessInfo | null | undefined,
  now = new Date(),
): { text: string; tone: AccessTone } {
  if (!access || !access.expiresAt) return { text: "Tanpa batas waktu", tone: "success" };
  const expires = new Date(access.expiresAt);
  if (access.state === "active") {
    const days = Math.ceil((expires.getTime() - now.getTime()) / DAY_MS);
    return { text: `Berlaku s.d. ${DATE.format(expires)}`, tone: days <= 14 ? "warning" : "info" };
  }
  if (access.state === "read_only" && access.deleteAt)
    return { text: `Baca saja · dihapus ${DATE.format(new Date(access.deleteAt))}`, tone: "danger" };
  return { text: "Akses berakhir", tone: "danger" };
}

export function purposeHint(purpose: string): string | null {
  const length = purpose.replace(/\s+/g, " ").trim().length;
  if (length < PURPOSE_MIN) return `Minimal ${PURPOSE_MIN} karakter (kurang ${PURPOSE_MIN - length}).`;
  if (length > PURPOSE_MAX) return `Maksimal ${PURPOSE_MAX} karakter.`;
  return null;
}

/** Kekuatan kata sandi untuk meter di formulir daftar (0–4) + label. Aturan wajib tetap diperiksa server. */
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  const capped = Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
  return { score: capped, label: ["", "Lemah", "Cukup", "Kuat", "Sangat kuat"][capped] };
}
