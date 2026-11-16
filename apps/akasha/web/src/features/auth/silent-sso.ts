/**
 * Pemeriksaan diam-diam sesi SSO dari halaman masuk Akasha: bila akun Workingspace di browser ini sudah masuk, Akasha ikut
 * masuk tanpa klik. Dibatasi sekali per 5 detik per tab (cadangan; penanda `sso_checked` sudah mencegah pemeriksaan berulang).
 */
const KEY = "akasha.silentSsoAt";
const GAP_MS = 5_000;

export function silentSsoAllowed(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    return !last || now - last > GAP_MS;
  } catch {
    return false;
  }
}

export function markSilentSso(now = Date.now()) {
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // penyimpanan diblokir: pemeriksaan diam-diam tidak diulang di tab ini
  }
}
