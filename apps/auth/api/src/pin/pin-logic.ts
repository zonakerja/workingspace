/** Aturan PIN keamanan ekosistem (dipindah dari Akasha; logika murni, diuji di pin-logic.spec.ts). */

/** PIN = tepat 6 angka. */
export const PIN_PATTERN = /^\d{6}$/;
export const isValidPin = (pin: unknown): pin is string => typeof pin === "string" && PIN_PATTERN.test(pin);

/** PIN terlalu mudah ditebak (sama semua / urut naik / urut turun). */
export function isWeakPin(pin: string) {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  return Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
}

/** Percobaan salah sebelum diblokir sementara (dihitung bersama untuk semua aplikasi). */
export const PIN_MAX_ATTEMPTS = 5;

/**
 * Lama blokir setelah salah ke-`failed`: 0 sampai batas, lalu 15 menit, dan berlipat setiap 5 kesalahan berikutnya
 * (maks. 24 jam) agar tebakan beruntun tidak praktis.
 */
export function pinBlockMs(failed: number) {
  if (failed < PIN_MAX_ATTEMPTS) return 0;
  const rounds = Math.floor(failed / PIN_MAX_ATTEMPTS) - 1;
  return Math.min(15 * 60_000 * 2 ** rounds, 24 * 60 * 60_000);
}

/** Akun tanpa kata sandi (Google saja) membuktikan diri dengan sesi yang baru dibuat. */
export const FRESH_SESSION_MS = 15 * 60_000;

/** Kredensial klien dari header `Authorization: Basic …` (dipakai aplikasi memanggil API antar-server). */
export function parseBasicAuth(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i <= 0) return null;
  return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
}
