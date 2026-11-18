/**
 * Identitas ekosistem workingspace.id: nama, tagline, dan visi tiap produk (pedoman branding pemilik, 2026-11-18). Akasha AI diperkenalkan sekali dengan nama lengkapnya, selanjutnya disebut **Akai**. Satu sumber untuk
 * halaman depan dan dashboard SSO agar penamaan selalu sama. Tagline resmi berbahasa Inggris; `lead` = penjelasan Indonesia.
 */

export interface EcosystemProduct {
  /** Kunci aplikasi di SSO (`apps.key`) */
  key: "akasha" | "akai" | "cendekia";
  /** Nama tampilan */
  name: string;
  /** Kepanjangan nama, disebut sekali saat memperkenalkan produk (mis. "Akasha AI" untuk Akai) */
  fullName?: string;
  /** Peran produk dalam ekosistem */
  role: string;
  tagline: string;
  /** Satu kalimat penjelasan berbahasa Indonesia */
  lead: string;
  vision: string;
  /** Sudah bisa dipakai */
  available: boolean;
}

export const ECOSYSTEM = {
  name: "workingspace.id",
  tagline: "One Space. Infinite Possibilities.",
  motto: "Where Work, Mind, and Growth Align.",
  lead: "Satu ruang yang menyatukan kerja, kecerdasan buatan, dan pengembangan diri.",
  vision:
    "Menjadi ekosistem digital terpusat yang menyatukan produktivitas, kecerdasan buatan, dan pengembangan diri ke dalam satu ruang yang seamless dan terotomatisasi.",
} as const;

export const PRODUCTS: readonly EcosystemProduct[] = [
  {
    key: "akasha",
    name: "Akasha",
    role: "Productivity & Automation",
    tagline: "Where Ideas Find Their Place.",
    lead: "Pusat kendali kerja harian: agenda, tugas, catatan, proyek, arsip, dan otomasi dalam satu ruang.",
    vision:
      "Menciptakan ruang kerja personal yang intuitif dan terotomatisasi, di mana setiap resource terkelola dengan rapi sehingga pengguna dapat fokus pada eksekusi dan kreativitas.",
    available: true,
  },
  {
    key: "akai",
    name: "Akai",
    fullName: "Akasha AI",
    role: "The Intelligence Layer",
    tagline: "Intelligence That Moves With You.",
    lead: "Pendamping cerdas yang bekerja mandiri maupun di dalam Akasha dan Cendekia: chat, agen, dan otomasi.",
    vision:
      "Menjadi agen kognitif dan pendamping cerdas yang proaktif, yang mempercepat pemecahan masalah, mengotomatisasi hal repetitif, dan memperluas kapasitas berpikir pengguna di seluruh ekosistem.",
    available: true,
  },
  {
    key: "cendekia",
    name: "Cendekia",
    role: "Self-Directed Learning",
    tagline: "Master Your Learning Journey.",
    lead: "Navigator belajar mandiri: lacak kuliah, sertifikasi, dan keterampilan baru secara terukur.",
    vision:
      "Menjadi navigator pembelajaran mandiri yang memberdayakan pengguna untuk melacak progres, mengukur pencapaian, dan menguasai pengetahuan baru secara terstruktur dan terukur.",
    available: false,
  },
];

export const product = (key: EcosystemProduct["key"]) => PRODUCTS.find((p) => p.key === key)!;

/** Nama tampilan aplikasi SSO menurut kunci (nama dari database dipakai bila kunci tidak dikenal). */
export const productName = (key: string, fallback: string) => PRODUCTS.find((p) => p.key === key)?.name ?? fallback;
