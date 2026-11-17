/**
 * Contoh plugin bawaan Akai (6b.7) yang bisa dipasang sekali klik dan dipelajari pemilik sebagai contoh menulis plugin.
 * Dipasang = salinan kode menjadi milik akun (bisa diubah); perubahan di sini tidak mengubah salinan yang sudah terpasang.
 */

export interface CatalogPlugin {
  key: string;
  title: string;
  description: string;
  code: string;
}

const HARI_KERJA = `// Plugin contoh: hitung hari kerja (Senin–Jumat) tanpa jaringan.
definePlugin({
  name: "hari-kerja",
  title: "Hari Kerja",
  description: "Menghitung jumlah hari kerja di antara dua tanggal dan tanggal setelah N hari kerja (Senin–Jumat, tanpa hari libur yang diisi di pengaturan).",
  version: "1.0.0",
  config: [
    { key: "libur", label: "Hari libur", description: "Tanggal libur dipisah koma, format YYYY-MM-DD (mis. 2026-12-25, 2027-01-01)." }
  ],
  tools: [
    {
      name: "hitung_hari_kerja",
      description: "Hitung jumlah hari kerja dari tanggal mulai sampai tanggal selesai (keduanya ikut dihitung).",
      readOnly: true,
      input: {
        type: "object",
        properties: {
          mulai: { type: "string", description: "Tanggal mulai, YYYY-MM-DD" },
          selesai: { type: "string", description: "Tanggal selesai, YYYY-MM-DD" }
        },
        required: ["mulai", "selesai"]
      },
      run: async (input, akai) => {
        const libur = liburSet(akai.config.libur);
        let d = tanggal(input.mulai);
        const akhir = tanggal(input.selesai);
        if (d > akhir) throw new Error("Tanggal mulai harus sebelum tanggal selesai.");
        let kerja = 0;
        let akhirPekan = 0;
        let hariLibur = 0;
        while (d <= akhir) {
          const hari = d.getUTCDay();
          if (hari === 0 || hari === 6) akhirPekan++;
          else if (libur.has(ymd(d))) hariLibur++;
          else kerja++;
          d = new Date(d.getTime() + 86400000);
        }
        return { mulai: input.mulai, selesai: input.selesai, hariKerja: kerja, akhirPekan, hariLibur };
      }
    },
    {
      name: "tambah_hari_kerja",
      description: "Tanggal setelah menambahkan sejumlah hari kerja ke tanggal mulai (mis. tenggat 14 hari kerja).",
      readOnly: true,
      input: {
        type: "object",
        properties: {
          mulai: { type: "string", description: "Tanggal mulai, YYYY-MM-DD" },
          jumlah: { type: "integer", description: "Jumlah hari kerja" }
        },
        required: ["mulai", "jumlah"]
      },
      run: async (input, akai) => {
        const libur = liburSet(akai.config.libur);
        let d = tanggal(input.mulai);
        let sisa = Number(input.jumlah);
        if (!(sisa >= 0 && sisa <= 3650)) throw new Error("jumlah harus 0–3650.");
        while (sisa > 0) {
          d = new Date(d.getTime() + 86400000);
          const hari = d.getUTCDay();
          if (hari !== 0 && hari !== 6 && !libur.has(ymd(d))) sisa--;
        }
        return { mulai: input.mulai, jumlahHariKerja: Number(input.jumlah), tanggal: ymd(d) };
      }
    }
  ]
});

function tanggal(text) {
  const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(text || ""));
  if (!m) throw new Error("Format tanggal harus YYYY-MM-DD: " + text);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function liburSet(text) {
  return new Set(String(text || "").split(",").map((s) => s.trim()).filter(Boolean));
}
`;

const KURS = `// Plugin contoh: kurs mata uang memakai jaringan (open.er-api.com, gratis tanpa key).
definePlugin({
  name: "kurs-mata-uang",
  title: "Kurs Mata Uang",
  description: "Kurs terbaru antarmata uang (mis. USD ke IDR) dan konversi nominal, dari layanan publik open.er-api.com.",
  version: "1.0.0",
  hosts: ["open.er-api.com"],
  tools: [
    {
      name: "kurs",
      description: "Kurs terbaru dari satu mata uang ke mata uang lain, opsional mengonversi nominal.",
      readOnly: true,
      input: {
        type: "object",
        properties: {
          dari: { type: "string", description: "Kode mata uang asal, mis. USD" },
          ke: { type: "string", description: "Kode mata uang tujuan, mis. IDR" },
          jumlah: { type: "number", description: "Nominal yang dikonversi (bawaan 1)" }
        },
        required: ["dari", "ke"]
      },
      run: async (input, akai) => {
        const dari = String(input.dari).toUpperCase();
        const ke = String(input.ke).toUpperCase();
        const res = await akai.fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(dari));
        if (!res.ok) throw new Error("Layanan kurs menjawab " + res.status);
        const data = res.json();
        const rate = data.rates && data.rates[ke];
        if (!rate) throw new Error("Kurs " + dari + " ke " + ke + " tidak tersedia.");
        const jumlah = input.jumlah === undefined ? 1 : Number(input.jumlah);
        akai.log("kurs", dari, ke, rate);
        return { dari, ke, kurs: rate, jumlah, hasil: Math.round(jumlah * rate * 100) / 100, diperbarui: data.time_last_update_utc, sumber: "open.er-api.com" };
      }
    }
  ]
});
`;

/** Templat plugin baru (ditampilkan saat membuat plugin dari awal). */
export const PLUGIN_TEMPLATE = `// Plugin Akai: kode JavaScript yang dijalankan di sandbox (tanpa akses berkas/server).
// akai.fetch(url, { method, headers, body }) → { status, ok, json(), text() } — hanya ke host di daftar hosts.
// akai.config = nilai pengaturan plugin; akai.log(...) = catatan saat uji.
definePlugin({
  name: "plugin-saya",
  title: "Plugin Saya",
  description: "Jelaskan apa yang dikerjakan plugin ini.",
  version: "1.0.0",
  hosts: [],
  config: [],
  tools: [
    {
      name: "halo",
      description: "Menyapa nama yang diberikan.",
      readOnly: true,
      input: { type: "object", properties: { nama: { type: "string" } }, required: ["nama"] },
      run: async (input, akai) => {
        return "Halo, " + input.nama + "!";
      }
    }
  ]
});
`;

/** Contoh paket (seperti plugin Claude): instruksi + skill + konektor Akasha. */
const AKASHA_HARIAN = JSON.stringify(
  {
    type: "akai-package",
    name: "akasha-harian",
    title: "Akasha Harian",
    description:
      "Asisten kerja harian untuk pengguna Akasha: konektor Akasha (agenda, to-do, catatan, pengetahuan) + skill rangkuman harian dan rencana mingguan.",
    version: "1.0.0",
    instructions:
      "Pengguna memakai Akasha sebagai ruang kerja (Planner, Working Space, Notes, Knowledge). Bila pertanyaan menyangkut agenda, to-do, tugas, catatan, atau pengetahuan pengguna, ambil datanya lewat alat konektor Akasha — jangan menebak. Sebut tanggal dengan format Indonesia (mis. Senin, 17 November 2026).",
    skills: [
      {
        name: "rangkuman-harian",
        description:
          "Merangkum agenda, to-do, dan tugas jatuh tempo hari ini dari Akasha menjadi rencana kerja. Pakai saat pengguna minta rangkuman hari ini, rencana kerja harian, atau 'apa yang harus saya kerjakan hari ini'.",
        instructions:
          "# Rangkuman harian\n\n1. Ambil agenda hari ini dan tugas terbuka/jatuh tempo lewat alat konektor Akasha.\n2. Susun: **Agenda** (jam · judul · tempat/tautan), **Prioritas** (maks. 5, yang terlambat dulu), **Bisa ditunda**.\n3. Akhiri dengan satu kalimat saran fokus. Jangan mengarang item yang tidak ada di data.",
      },
      {
        name: "rencana-mingguan",
        description:
          "Menyusun rencana kerja satu minggu dari agenda dan tugas Akasha. Pakai saat pengguna minta rencana minggu ini atau minggu depan.",
        instructions:
          "# Rencana mingguan\n\nAmbil agenda 7 hari dan tugas terbuka lewat konektor Akasha. Buat tabel | Hari | Agenda | Fokus kerja | lalu daftar tugas tanpa tanggal yang perlu dijadwalkan. Tandai bentrok jadwal bila ada.",
      },
    ],
    connectors: [
      {
        name: "Akasha",
        preset: "akasha",
        description: "Data kerja Akasha (token akses dari Akasha → Pengaturan → Integrasi).",
      },
    ],
  },
  null,
  2,
);

/** Templat paket baru (ditampilkan saat menulis paket dari awal). */
export const PACKAGE_TEMPLATE = JSON.stringify(
  {
    type: "akai-package",
    name: "paket-saya",
    title: "Paket Saya",
    description: "Jelaskan isi paket: untuk pekerjaan apa dan apa saja yang dibawa.",
    version: "1.0.0",
    instructions: "Instruksi tetap untuk Akai selama paket menyala (opsional).",
    skills: [
      {
        name: "contoh-skill",
        description: "Kapan skill ini dipakai.",
        instructions: "# Langkah\n\n1. ...",
        files: [{ path: "contoh.md", content: "Contoh isi berkas pendukung." }],
      },
    ],
    connectors: [{ name: "Server MCP", url: "https://mcp.contoh.id/mcp", auth: "token", allowWrite: false }],
  },
  null,
  2,
);

export const PLUGIN_CATALOG: CatalogPlugin[] = [
  {
    key: "akasha-harian",
    title: "Akasha Harian (paket)",
    description: "Paket: konektor Akasha + skill rangkuman harian & rencana mingguan + instruksi kerja.",
    code: AKASHA_HARIAN,
  },
  {
    key: "hari-kerja",
    title: "Hari Kerja",
    description: "Hitung hari kerja antara dua tanggal dan tenggat N hari kerja (tanpa jaringan).",
    code: HARI_KERJA,
  },
  {
    key: "kurs-mata-uang",
    title: "Kurs Mata Uang",
    description: "Kurs terbaru dan konversi nominal dari open.er-api.com (contoh plugin berjaringan).",
    code: KURS,
  },
];
