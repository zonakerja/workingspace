/** Logika murni PIN keamanan di browser (salinan aturan backend `security/lock-logic.ts`; ubah keduanya bersamaan). */

/** PIN terlalu mudah ditebak (sama semua / urut naik / urut turun). */
export function isWeakPin(pin: string) {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  return Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
}

/** Pesan masalah PIN baru, atau null bila siap disimpan. */
export function pinProblem(pin: string, confirm: string) {
  if (!/^\d{6}$/.test(pin)) return "PIN harus 6 angka.";
  if (isWeakPin(pin)) return "PIN terlalu mudah ditebak (angka sama semua / berurutan).";
  if (confirm !== pin) return "Ulangi PIN belum sama.";
  return null;
}
