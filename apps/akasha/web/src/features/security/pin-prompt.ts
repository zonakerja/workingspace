import { create } from "zustand";

/** `item` = membuka item terkunci; `login` = tawaran tepat setelah login (Masuk dengan PIN / Lanjut tanpa PIN). */
export type PinPromptMode = "item" | "login";

interface PinPromptState {
  open: boolean;
  mode: PinPromptMode;
  /** Keterangan singkat (mis. nama item yang ingin dibuka) */
  reason?: string;
  show: (reason?: string, mode?: PinPromptMode) => void;
  hide: () => void;
}

export const usePinPrompt = create<PinPromptState>((set) => ({
  open: false,
  mode: "item",
  show: (reason, mode = "item") => set({ open: true, reason, mode }),
  hide: () => set({ open: false, reason: undefined, mode: "item" }),
}));

// Ditandai saat login berhasil (bukan saat sesi dipulihkan dari cookie / muat ulang halaman), dibaca sekali oleh AppShell
let loginPromptPending = false;
export const markLoginPinPrompt = () => {
  loginPromptPending = true;
};
export function consumeLoginPinPrompt() {
  const pending = loginPromptPending;
  loginPromptPending = false;
  return pending;
}

// Satu dialog untuk semua permintaan yang terkunci bersamaan (mis. beberapa tulisan sekaligus)
let pending: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;

/** Minta user memasukkan PIN; true = sesi kini terbuka. Dipakai juga oleh klien API saat server menjawab PIN_REQUIRED. */
export function requestUnlock(reason?: string, mode: PinPromptMode = "item"): Promise<boolean> {
  if (pending) return pending.promise;
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  pending = { promise, resolve };
  usePinPrompt.getState().show(reason, mode);
  return promise;
}

/** Dialog ditutup: selesaikan permintaan yang menunggu. */
export function settleUnlock(ok: boolean) {
  pending?.resolve(ok);
  pending = null;
  usePinPrompt.getState().hide();
}
