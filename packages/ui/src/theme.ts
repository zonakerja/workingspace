import { useSyncExternalStore } from "react";

/** Tema halaman SSO: pilihan disimpan per peramban (bukan per akun — halaman masuk dipakai sebelum masuk). */
export type ThemePreference = "light" | "dark" | "system";

const KEY = "workingspace.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let preference = read();

function apply() {
  const dark = preference === "dark" || (preference === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Dipanggil sekali saat aplikasi dimuat (main.tsx). */
export function initTheme() {
  apply();
  media.addEventListener("change", () => {
    if (preference === "system") apply();
  });
}

export function setTheme(next: ThemePreference) {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // penyimpanan diblokir: tema tetap berlaku sampai halaman dimuat ulang
  }
  apply();
  for (const listener of listeners) listener();
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => preference,
  );
}
