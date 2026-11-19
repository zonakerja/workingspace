/**
 * Cadangan rekaman Notes AI di browser (IndexedDB): selama merekam, potongan audio disimpan tiap beberapa detik.
 * Bila tab tertutup, browser crash, atau listrik padam sebelum rekaman dihentikan, rekaman bisa dipulihkan saat
 * catatan yang sama dibuka lagi. Cadangan dihapus setelah audionya terunggah ke server (atau dibuang user).
 * Hanya di browser ini; semua akses dibungkus try/catch (mode privat / penyimpanan diblokir = tanpa cadangan).
 */

const DB_NAME = "akasha-recordings";
const STORE = "sessions";

export interface RecordingBackup {
  key: string;
  chunks: Blob[];
  mimeType: string;
  startedAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Kunci cadangan per akun + catatan. */
export const backupKey = (userId: string | undefined, noteId: string | number | undefined) =>
  `${userId ?? "anon"}:${noteId ?? "baru"}`;

export async function readBackup(key: string): Promise<RecordingBackup | null> {
  try {
    return ((await run("readonly", (store) => store.get(key))) as RecordingBackup | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Tambah potongan rekaman (dibuat bila belum ada). */
export async function appendBackup(key: string, chunk: Blob, mimeType: string, startedAt: number) {
  try {
    const current = await readBackup(key);
    const next: RecordingBackup = {
      key,
      chunks: current && current.startedAt === startedAt ? [...current.chunks, chunk] : [chunk],
      mimeType,
      startedAt,
      updatedAt: Date.now(),
    };
    await run("readwrite", (store) => store.put(next));
  } catch {
    /* penyimpanan browser tidak tersedia — rekaman tetap berjalan tanpa cadangan */
  }
}

export async function clearBackup(key: string) {
  try {
    await run("readwrite", (store) => store.delete(key));
  } catch {
    /* abaikan */
  }
}

/** Ukuran & perkiraan durasi cadangan (untuk keterangan pemulihan). */
export const backupSummary = (backup: RecordingBackup) => ({
  bytes: backup.chunks.reduce((sum, chunk) => sum + chunk.size, 0),
  seconds: Math.max(0, Math.round((backup.updatedAt - backup.startedAt) / 1000)),
});
