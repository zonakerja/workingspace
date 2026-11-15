/** Aturan kata sandi akun ekosistem (logika murni, diuji di password-policy.spec.ts). */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Kata sandi yang sangat umum (daftar pendek; pelengkap aturan panjang). */
const COMMON = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "qwertyui",
  "qwerty123",
  "11111111",
  "00000000",
  "abcdefgh",
  "abc12345",
  "iloveyou",
  "admin123",
  "passw0rd",
  "katasandi",
  "indonesia",
  "bismillah",
  "rahasia123",
]);

/** Pesan galat Bahasa Indonesia, atau null bila kata sandi boleh dipakai. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (password.length > PASSWORD_MAX) return `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "Kata sandi terlalu umum. Pilih yang lebih sulit ditebak.";
  if (/^(.)\1+$/.test(password)) return "Kata sandi tidak boleh satu karakter berulang.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Kata sandi tidak boleh memuat alamat email.";
  return null;
}

/** Normalisasi email untuk pencocokan akun (huruf kecil, tanpa spasi). */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
