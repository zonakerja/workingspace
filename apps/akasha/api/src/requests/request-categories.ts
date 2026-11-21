/**
 * Kategori pengajuan (Approval) milik pemilik — tidak lagi daftar tetap pengelolaan BMN, karena tugas pemilik bisa berganti
 * (pindah unit, menjadi pimpinan). Kategori bawaan = kategori BMN lama (kuncinya tetap sehingga data lama terbaca) yang bisa
 * diubah, diarsipkan, atau ditambah. Penentuan otomatis = kata kunci (tanpa AI, dapat diperiksa pemilik); AI agent juga bisa
 * menetapkan kategori lewat MCP, dan pemilik selalu bisa mengubahnya manual. Logika murni → `request-categories.spec.ts`.
 */

export interface CategoryRule {
  key: string;
  label: string;
  keywords: string[];
  archived: boolean;
  isDefault: boolean;
  position: number;
}

export interface DefaultCategory {
  key: string;
  label: string;
  description: string;
  keywords: string[];
  isDefault?: boolean;
}

/** Kategori yang dibuat sekali untuk setiap akun (sama dengan jenis pengajuan sebelum kategori bisa dikelola). */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    key: "psp",
    label: "Penetapan Status Penggunaan (PSP) BMN",
    description: "Permohonan penetapan status penggunaan Barang Milik Negara dari satker.",
    keywords: ["psp", "penetapan status penggunaan"],
  },
  {
    key: "penghapusan",
    label: "Penghapusan BMN (termasuk SK Panitia Penghapusan)",
    description: "Usul penghapusan, pemusnahan, atau lelang BMN.",
    keywords: ["penghapusan", "pemusnahan", "lelang", "panitia penghapusan"],
  },
  {
    key: "pemanfaatan",
    label: "Pemanfaatan BMN (sewa, KSP, pinjam pakai, KSPI, BGS/BSG)",
    description: "Permohonan sewa, kerja sama pemanfaatan, pinjam pakai, BGS/BSG.",
    keywords: ["pemanfaatan", "sewa", "ksp", "kerja sama pemanfaatan", "pinjam pakai", "bgs", "bsg", "kspi"],
  },
  {
    key: "surat",
    label: "Surat permintaan arahan / tanggapan",
    description: "Surat yang meminta arahan, tanggapan, atau penjelasan.",
    keywords: ["arahan", "tanggapan", "mohon penjelasan", "konsultasi"],
  },
  {
    key: "lainnya",
    label: "Lainnya",
    description: "Pengajuan yang belum masuk kategori lain.",
    keywords: [],
    isDefault: true,
  },
];

const FALLBACK_KEY = "lainnya";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Kata kunci dibersihkan: huruf kecil, tanpa duplikat & kosong, maks. 40 kata kunci × 60 karakter. */
export function normalizeKeywords(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[,\n]/) : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const word = raw.trim().toLowerCase().slice(0, 60);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    result.push(word);
    if (result.length >= 40) break;
  }
  return result;
}

/** Kunci unik dari label (huruf kecil, tanda hubung, maks. 40), diberi nomor bila sudah dipakai. */
export function categoryKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = normalize(label).replace(/\s+/g, "-").slice(0, 36).replace(/-+$/, "") || "kategori";
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Kata kunci cocok bila muncul sebagai kata/frasa utuh di teks (bukan bagian kata lain: "sewa" ≠ "persewaan"). */
function matches(text: string, keyword: string) {
  const k = normalize(keyword);
  return !!k && ` ${text} `.includes(` ${k} `);
}

/**
 * Kategori otomatis: kategori aktif pertama (urutan tampil) yang salah satu kata kuncinya ada di teks; kata kunci lebih
 * panjang menang bila beberapa kategori cocok (lebih spesifik). Tanpa kecocokan → kategori bawaan (isDefault), lalu
 * "lainnya" bila masih ada, lalu kategori aktif pertama.
 */
export function classifyRequest(categories: CategoryRule[], text: string): { key: string; matched: string | null } {
  const active = categories.filter((c) => !c.archived).sort((a, b) => a.position - b.position);
  const haystack = normalize(text);
  let best: { key: string; matched: string; length: number } | null = null;
  for (const category of active) {
    for (const keyword of category.keywords) {
      if (!matches(haystack, keyword)) continue;
      const length = normalize(keyword).length;
      if (!best || length > best.length) best = { key: category.key, matched: keyword, length };
    }
  }
  if (best) return { key: best.key, matched: best.matched };
  const fallback = active.find((c) => c.isDefault) ?? active.find((c) => c.key === FALLBACK_KEY) ?? active[0] ?? null;
  return { key: fallback?.key ?? FALLBACK_KEY, matched: null };
}

/** Teks yang dipakai penentuan otomatis: judul, perihal, pemohon, isi, nama berkas. */
export function classificationText(input: {
  title?: string | null;
  subject?: string | null;
  applicant?: string | null;
  message?: string | null;
  fileNames?: string[];
}) {
  return [input.title, input.subject, input.applicant, input.message?.slice(0, 4000), ...(input.fileNames ?? [])]
    .filter(Boolean)
    .join(" \n ");
}
