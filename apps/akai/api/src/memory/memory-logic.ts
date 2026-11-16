/**
 * Aturan Memori Akai (6b.3, docs/AKAI.md §8). Logika murni, diuji di memory-logic.spec.ts: blok memori di prompt sistem, prompt
 * pencatat memori setelah setiap pertukaran, pembaca hasilnya, penyaring data rahasia, dan anti-duplikat.
 */

export const MEMORY_MAX_ITEMS = 200;
export const MEMORY_MAX_CHARS = 300;
/** Memori yang ikut prompt sistem (terbaru diperbarui lebih dulu). */
export const MEMORY_PROMPT_ITEMS = 100;
/** Maks. memori baru per pertukaran. */
export const MEMORY_MAX_ADDS = 3;

export interface MemoryItem {
  id: string;
  content: string;
}

/** Bagian prompt sistem: memori pengguna + cara memakainya. Kosong = tanpa blok. */
export function memoryBlock(items: MemoryItem[]): string | null {
  const list = items.slice(0, MEMORY_PROMPT_ITEMS).filter((m) => m.content.trim());
  if (!list.length) return null;
  return [
    "Yang Anda ingat tentang pengguna dari percakapan sebelumnya (pakai bila relevan, jangan diulang-ulang atau dipamerkan; bila bertentangan dengan pesan terbaru, pesan terbaru yang benar):",
    `<memori_pengguna>\n${list.map((m) => `- ${m.content.trim()}`).join("\n")}\n</memori_pengguna>`,
  ].join("\n");
}

/** Pola data yang tidak boleh diingat: kata sandi, PIN, token/API key, nomor identitas/rekening/kartu panjang. */
const SECRET =
  /(kata ?sandi|password|passcode|\bpin\b|\botp\b|token|api ?key|secret|rahasia|\bnik\b|no\.? ?rekening|nomor rekening|\b\d{12,}\b|sk-[a-z0-9]{8,})/i;

export const isSensitive = (text: string) => SECRET.test(text);

/** Prompt pencatat: fakta tahan lama tentang pengguna dari satu pertukaran → JSON { add, remove }. */
export function extractionPrompt(existing: MemoryItem[], user: string, assistant: string) {
  const numbered = existing
    .slice(0, MEMORY_PROMPT_ITEMS)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");
  return [
    "Tugas Anda: perbarui memori jangka panjang asisten tentang PENGGUNA berdasarkan satu pertukaran percakapan.",
    'Catat hanya fakta yang bermanfaat di percakapan lain dan kemungkinan tetap benar: nama panggilan, jabatan/peran, instansi/tempat kerja, bidang tugas, pekerjaan/proyek yang sedang berjalan, preferensi gaya jawaban atau bahasa, alat/aplikasi yang dipakai, permintaan eksplisit "ingat ...".',
    "JANGAN catat: isi pertanyaan sekali pakai, pengetahuan umum, isi dokumen, pendapat asisten, kata sandi, PIN, token, nomor identitas/rekening/kartu, data kesehatan, atau data orang lain.",
    "Hapus memori (sebut nomornya) bila pengguna meminta melupakannya atau pesan terbaru membantahnya.",
    `Tulis tiap memori baru sebagai satu kalimat pendek orang ketiga (mis. "Pengguna bekerja sebagai verifikator BMN di KPKNL."), maks. ${MEMORY_MAX_ADDS} memori baru. Jangan ulangi memori yang sudah ada.`,
    'Balas HANYA JSON tanpa penjelasan: {"add": ["..."], "remove": [nomor]}. Bila tidak ada perubahan: {"add": [], "remove": []}.',
    "",
    `<memori_sekarang>\n${numbered || "(kosong)"}\n</memori_sekarang>`,
    `<pesan_pengguna>\n${user.slice(0, 4000)}\n</pesan_pengguna>`,
    `<jawaban_asisten>\n${assistant.slice(0, 2000)}\n</jawaban_asisten>`,
  ].join("\n");
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Jawaban pencatat → perubahan yang aman: memori baru (dibersihkan, tanpa data rahasia, tanpa duplikat) dan id memori yang dihapus
 * (dari nomor urut `existing`). Jawaban rusak = tanpa perubahan.
 */
export function parseExtraction(raw: string | null | undefined, existing: MemoryItem[]) {
  const empty = { add: [] as string[], remove: [] as string[] };
  if (!raw) return empty;
  const match = raw.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
  if (!match) return empty;
  let data: { add?: unknown; remove?: unknown };
  try {
    data = JSON.parse(match[0]) as { add?: unknown; remove?: unknown };
  } catch {
    return empty;
  }
  const known = existing.slice(0, MEMORY_PROMPT_ITEMS);
  const remove = (Array.isArray(data.remove) ? data.remove : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= known.length)
    .map((n) => known[n - 1].id);
  const seen = new Set(existing.filter((m) => !remove.includes(m.id)).map((m) => normalize(m.content)));
  const add: string[] = [];
  for (const item of Array.isArray(data.add) ? data.add : []) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim().slice(0, MEMORY_MAX_CHARS);
    const key = normalize(text);
    if (text.length < 8 || isSensitive(text) || seen.has(key)) continue;
    if ([...seen].some((s) => s.length > 20 && (s.includes(key) || key.includes(s)))) continue;
    seen.add(key);
    add.push(text);
    if (add.length >= MEMORY_MAX_ADDS) break;
  }
  return { add, remove: [...new Set(remove)] };
}

/** Pesan pengguna yang layak diperiksa pencatat (pesan sangat pendek seperti "ok", "makasih" dilewati agar hemat). */
export const worthExtracting = (text: string) => text.replace(/\s+/g, " ").trim().length >= 15;
