/** Alamat SSO & aplikasi. Development = server lokal; produksi diisi saat build (Dockerfile ARG / env VITE_*). */

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export const AUTH_URL = trimSlash(import.meta.env.VITE_AUTH_URL || "http://auth.workingspace.localhost:5175");
export const AKASHA_URL = trimSlash(import.meta.env.VITE_AKASHA_URL || "http://localhost:5173");
export const AKAI_URL = trimSlash(import.meta.env.VITE_AKAI_URL || "http://akai.workingspace.localhost:5177");

/** Tautan masuk & daftar ke SSO. Setelah masuk tanpa aplikasi tujuan, SSO membuka halaman akun (peluncur aplikasi). */
export function ssoLinks(authUrl: string) {
  const base = trimSlash(authUrl);
  return { login: `${base}/login?next=/account`, register: `${base}/register`, account: `${base}/account` };
}
