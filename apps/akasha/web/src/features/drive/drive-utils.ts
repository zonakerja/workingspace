/**
 * Drive (docs/AKUN-TERSAMBUNG.md tahap 4): logika murni yang dipakai pemilih berkas & kartu arsip dingin. Diuji di drive-utils.test.ts.
 */

/** Pesan dari jendela Google Picker ke form yang membukanya. */
export const PICKER_MESSAGE = "akasha-drive-pick";

export interface PickerMessage {
  type: typeof PICKER_MESSAGE;
  /** Penanda permintaan (cegah pesan dari permintaan lain / tab lain) */
  request: string;
  fileId: string | null;
  error?: string;
}

export function isPickerMessage(data: unknown, request: string): data is PickerMessage {
  const d = data as Partial<PickerMessage> | null;
  return (
    !!d && d.type === PICKER_MESSAGE && d.request === request && (d.fileId === null || typeof d.fileId === "string")
  );
}

/** Ukuran berkas ringkas (B, KB, MB, GB). */
export function formatSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[i]}`;
}

export const PROVIDER_DRIVE_LABEL = { google: "Google Drive", microsoft: "OneDrive" } as const;

/** Pilihan "tidak dibuka selama" di kartu arsip dingin. */
export const COLD_DAY_OPTIONS = [
  { value: 90, label: "3 bulan" },
  { value: 180, label: "6 bulan" },
  { value: 365, label: "1 tahun" },
  { value: 730, label: "2 tahun" },
];

export const COLD_SIZE_OPTIONS = [
  { value: 0, label: "Semua ukuran" },
  { value: 1, label: "≥ 1 MB" },
  { value: 5, label: "≥ 5 MB" },
  { value: 20, label: "≥ 20 MB" },
];

/** Label hari untuk nilai yang tidak ada di pilihan (mis. diatur lewat API). */
export const dayLabel = (days: number) => COLD_DAY_OPTIONS.find((o) => o.value === days)?.label ?? `${days} hari`;
