import type { AiNote, FreeList, FreeNote, ListItem, NoteFileAttachment, NoteAudioItem } from "@/types/entities";

// ---------------------------------------------------------------------------- Pencarian & urutan

/** Cocokkan kata kunci (tanpa membedakan huruf besar/kecil) dengan salah satu teks. */
export const matchesQuery = (query: string, ...texts: (string | undefined | null)[]) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return texts.some((t) => t?.toLowerCase().includes(q));
};

const byUpdatedDesc = (a: { updatedAt?: string }, b: { updatedAt?: string }) =>
  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/** Catatan disematkan dulu, lalu yang terakhir diubah. */
export const sortFreeNotes = (notes: FreeNote[]) =>
  [...notes].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || byUpdatedDesc(a, b));

/** Notes AI disematkan dulu, lalu tanggal terbaru, lalu yang terakhir diubah. */
export const sortAiNotes = (notes: AiNote[]) =>
  [...notes].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) || (b.date ?? "").localeCompare(a.date ?? "") || byUpdatedDesc(a, b),
  );

export const filterFreeNotes = (notes: FreeNote[], query: string) =>
  notes.filter((n) => matchesQuery(query, n.title, n.content));

export const filterAiNotes = (notes: AiNote[], query: string) =>
  notes.filter((n) => matchesQuery(query, n.title, n.content, n.aiSummary, n.audioTranscript));

export const filterLists = (lists: FreeList[], query: string) =>
  lists.filter((l) => matchesQuery(query, l.title, ...l.items.map((i) => i.text)));

// ---------------------------------------------------------------------------- Catatan bebas

/** Node dokumen editor (format JSON Tiptap/ProseMirror). */
export interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

/** Node yang bermakna walau tanpa teks. */
const MEDIA_NODES = new Set(["inkBlock", "image"]);

const walkDoc = (node: DocNode | undefined, visit: (node: DocNode) => void) => {
  if (!node) return;
  visit(node);
  node.content?.forEach((child) => walkDoc(child, visit));
};

export const docHasMedia = (doc: unknown) => {
  let found = false;
  walkDoc(doc as DocNode, (n) => {
    if (n.type && MEDIA_NODES.has(n.type)) found = true;
  });
  return found;
};

/** ID berkas gambar (object storage) di dalam dokumen. */
export const docUploadIds = (doc: unknown) => {
  const ids: string[] = [];
  walkDoc(doc as DocNode, (n) => {
    if (n.type === "image" && typeof n.attrs?.uploadId === "string") ids.push(n.attrs.uploadId);
  });
  return ids;
};

/** Teks biasa (catatan lama / hasil pengenalan tulisan tangan) → dokumen editor, satu paragraf per baris. */
export const plainTextToDoc = (text = ""): DocNode => ({
  type: "doc",
  content: (text ? text.split(/\r?\n/) : [""]).map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  })),
});

/** Paragraf dari teks (disisipkan ke dokumen yang sedang diedit). */
export const textToParagraphs = (text: string): DocNode[] => plainTextToDoc(text.trim()).content ?? [];

export const isHandwritingNote = (note: Pick<FreeNote, "kind">) => note.kind === "handwriting";

export const isFreeNoteEmpty = (note: Pick<FreeNote, "title" | "content" | "kind" | "doc" | "ink">) => {
  if (note.title.trim()) return false;
  if (isHandwritingNote(note)) return !note.ink?.strokes?.length && !note.content?.trim();
  return !note.content?.trim() && !docHasMedia(note.doc);
};

// ---------------------------------------------------------------------------- Lampiran Notes AI

const fileOf = (note: AiNote): NoteFileAttachment | null =>
  note.fileAttachment && "name" in note.fileAttachment ? (note.fileAttachment as NoteFileAttachment) : null;

export const MAX_NOTE_DOCUMENTS = 10;

/** Durasi rekaman: "12:34", atau "1:02:34" mulai satu jam. */
export const formatDuration = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

export const documentKey = (doc: NoteFileAttachment) => doc.id ?? doc.uploadId ?? doc.name;

/** Semua dokumen tambahan sebuah Notes AI, termasuk catatan lama yang menyimpan satu dokumen. */
export const documentsOf = (note: AiNote): NoteFileAttachment[] => {
  if (note.fileAttachments?.length) return note.fileAttachments;
  const legacy = fileOf(note);
  return legacy ? [legacy] : [];
};

/** Teks tiap dokumen untuk ringkasan. */
export const documentSources = (note: AiNote) =>
  documentsOf(note)
    .map((doc) => ({
      name: doc.name,
      text: note.fileAttachments?.length ? (note.documentTexts?.[documentKey(doc)] ?? "") : (note.fileContext ?? ""),
    }))
    .filter((doc) => doc.text.trim());

/** Bentuk yang dipakai editor: catatan lama satu dokumen diubah ke daftar (tersimpan saat catatan disimpan berikutnya). */
export const withDocumentList = (note: AiNote): AiNote => {
  const legacy = note.fileAttachments?.length ? null : fileOf(note);
  if (!legacy) return note;
  const id = documentKey(legacy);
  return {
    ...note,
    fileAttachments: [{ ...legacy, id }],
    documentTexts: note.fileContext ? { [id]: note.fileContext } : {},
    fileAttachment: null,
    fileContext: "",
  };
};

/** Batas berkas audio per Notes AI. */
export const MAX_NOTE_AUDIOS = 10;

/** Semua audio sebuah Notes AI, termasuk catatan lama yang menyimpan satu audio (`audioUploadId` + `audioTranscript`). */
export const audiosOf = (note: AiNote): NoteAudioItem[] => {
  if (note.audioItems?.length) return note.audioItems;
  if (!note.audioUploadId && !note.audioTranscript?.trim()) return [];
  return [
    {
      id: note.audioUploadId ?? "audio-lama",
      name: "Audio",
      uploadId: note.audioUploadId,
      transcript: note.audioTranscript,
    },
  ];
};

/**
 * Gabungan transkrip untuk ringkasan, pencarian, dan indeks: satu audio = transkripnya apa adanya; beberapa audio =
 * per berkas berjudul "Audio n: nama" (urutan = urutan daftar).
 */
export const combinedTranscript = (items: NoteAudioItem[]) => {
  const done = items.filter((item) => item.transcript?.trim());
  if (items.length <= 1) return done[0]?.transcript?.trim() ?? "";
  return done
    .map((item) => `### Audio ${items.indexOf(item) + 1}: ${item.name}\n${item.transcript!.trim()}`)
    .join("\n\n");
};

/** Field turunan yang disimpan bersama daftar audio (kolom lama tetap terisi agar fitur lain tidak berubah). */
export const audioFields = (items: NoteAudioItem[]): Partial<AiNote> => ({
  audioItems: items,
  audioTranscript: combinedTranscript(items),
  hasAudio: items.length > 0,
  audioUploadId: items.find((item) => item.uploadId)?.uploadId,
});

/** Bentuk yang dipakai editor: catatan lama satu audio diubah ke daftar (tersimpan saat catatan disimpan berikutnya). */
export const withAudioList = (note: AiNote): AiNote =>
  note.audioItems?.length || !audiosOf(note).length ? note : { ...note, audioItems: audiosOf(note) };

/** ID berkas (object storage) yang dirujuk sebuah Notes AI. */
export const uploadIdsOf = (note: AiNote | null | undefined): string[] => {
  if (!note) return [];
  return [
    note.audioUploadId,
    ...audiosOf(note).map((audio) => audio.uploadId),
    ...documentsOf(note).map((doc) => doc.uploadId),
  ].filter((id, i, all): id is string => !!id && all.indexOf(id) === i);
};

/**
 * Berkas kandidat yang tidak dirujuk catatan `keep` → aman dihapus dari storage.
 * Kandidat = berkas catatan tersimpan + berkas yang diunggah selama editor terbuka.
 * Simpan: keep = draf yang disimpan. Buang perubahan: keep = catatan tersimpan.
 */
export const unreferencedUploads = (candidates: Iterable<string>, keep: AiNote | null | undefined) => {
  const kept = new Set(uploadIdsOf(keep));
  return [...new Set(candidates)].filter((id) => !kept.has(id));
};

/** Batas teks dokumen yang disimpan di catatan & dikirim ke AI (berkas besar bisa berisi jutaan karakter). */
export const MAX_FILE_CONTEXT_CHARS = 200_000;

export const clampContext = (text: string) =>
  text.length > MAX_FILE_CONTEXT_CHARS
    ? `${text.slice(0, MAX_FILE_CONTEXT_CHARS)}\n\n[... teks dokumen dipotong karena terlalu panjang ...]`
    : text;

// ---------------------------------------------------------------------------- Prompt AI

export type SummaryStyle = "default" | "academic" | "meeting" | "simple" | "custom";

export const SUMMARY_STYLES: { id: SummaryStyle; label: string; desc: string }[] = [
  { id: "default", label: "Standar", desc: "Ringkasan seimbang: inti materi dan poin penting." },
  { id: "academic", label: "Akademis", desc: "Formal, detail, dan terstruktur rapi." },
  { id: "meeting", label: "Risalah Rapat", desc: "Fokus pada keputusan, tindak lanjut, dan penanggung jawab." },
  { id: "simple", label: "Catatan Mudah", desc: "Bahasa santai dan poin-poin singkat." },
  { id: "custom", label: "Kustom", desc: "Tulis sendiri instruksi gaya ringkasannya." },
];

const STYLE_INSTRUCTIONS: Record<Exclude<SummaryStyle, "custom">, string> = {
  default:
    "Buat ringkasan yang seimbang: mulai dengan 2–3 kalimat inti, lalu poin-poin penting per topik, dan tutup dengan kesimpulan singkat.",
  academic:
    "Gunakan bahasa formal dan akademis. Susun dengan bagian: Pendahuluan/Konteks, Pembahasan per topik (definisi, konsep, argumen, data), dan Kesimpulan. Pertahankan istilah teknis, angka, dan rumus secara akurat.",
  meeting:
    "Susun sebagai risalah rapat dengan bagian: Ringkasan Singkat, Poin Pembahasan, Keputusan, dan Tindak Lanjut. Bagian Tindak Lanjut berupa tabel Markdown dengan kolom Tugas | Penanggung Jawab | Tenggat (isi '-' bila tidak disebutkan).",
  simple:
    "Gunakan bahasa sehari-hari yang mudah dipahami dan kalimat pendek. Utamakan poin-poin singkat; jelaskan istilah sulit dengan sederhana.",
};

export interface SummaryInput {
  style: SummaryStyle;
  /** Wajib bila style = custom */
  customInstruction?: string;
  title?: string;
  /** Tanggal yang sudah diformat untuk dibaca */
  dateLabel?: string;
  agendaLabel?: string;
  content?: string;
  audioTranscript?: string;
  documents?: { name: string; text: string }[];
}

export const hasSummarySource = (n: AiNote) =>
  !!(n.content?.trim() || n.audioTranscript?.trim() || documentSources(n).length > 0);

/** Prompt ringkasan Notes AI dari semua sumber yang tersedia. */
export function buildSummaryPrompt(input: SummaryInput): string {
  const styleText =
    input.style === "custom"
      ? input.customInstruction?.trim() || STYLE_INSTRUCTIONS.default
      : STYLE_INSTRUCTIONS[input.style];

  const meta = [
    input.title?.trim() && `Judul/topik: ${input.title.trim()}`,
    input.dateLabel && `Tanggal: ${input.dateLabel}`,
    input.agendaLabel && `Agenda terkait: ${input.agendaLabel}`,
  ].filter(Boolean);

  const documents = input.documents?.filter((doc) => doc.text.trim()) ?? [];
  // Batas total dibagi rata agar satu dokumen besar tidak menghabiskan jatah dokumen lain
  const perDocument = Math.floor(MAX_FILE_CONTEXT_CHARS / Math.max(documents.length, 1));
  const hasAudio = !!input.audioTranscript?.trim();
  const sources = [
    hasAudio && `<transkrip_audio>\n${input.audioTranscript!.trim()}\n</transkrip_audio>`,
    input.content?.trim() && `<catatan_kasar>\n${input.content.trim()}\n</catatan_kasar>`,
    ...documents.map(
      (doc) =>
        `<dokumen_referensi nama="${doc.name.replace(/"/g, "'")}">\n${clampContext(doc.text.trim().slice(0, perDocument))}\n</dokumen_referensi>`,
    ),
  ].filter(Boolean);

  return [
    "Anda adalah asisten pencatat yang teliti. Buat ringkasan dari materi di bawah ini.",
    meta.length ? `\nInformasi catatan:\n${meta.map((m) => `- ${m}`).join("\n")}` : "",
    `\nGaya ringkasan: ${styleText}`,
    "\nAturan:",
    "1. Gunakan HANYA informasi dari materi; jangan menambah fakta, nama, angka, atau tanggal yang tidak ada.",
    hasAudio
      ? "2. Transkrip audio adalah SUMBER UTAMA: struktur dan isi ringkasan mengikuti pembahasan di audio. Catatan kasar melengkapi. Dokumen referensi hanya untuk memperjelas istilah, angka, dan rujukan yang dibahas di audio; jangan merangkum bagian dokumen yang tidak dibahas. Bila sumber saling bertentangan, sebutkan perbedaannya dan nama dokumennya."
      : "2. Catatan kasar adalah sumber utama bila ada, dokumen referensi sebagai rujukan; sebutkan nama dokumen saat merujuknya. Bila sumber saling bertentangan, sebutkan perbedaannya.",
    "3. Tulis dalam Bahasa Indonesia, kecuali materi seluruhnya berbahasa lain atau instruksi gaya meminta bahasa lain.",
    "4. Format Markdown: '#' untuk judul utama, '##' untuk sub-judul, '-' untuk daftar, '**teks**' untuk poin penting, tabel bila membantu.",
    "5. Rumus matematika: '$...$' untuk inline dan '$$...$$' di baris tersendiri untuk blok.",
    "6. Langsung tulis ringkasannya tanpa kalimat pembuka atau penutup tentang tugas ini.",
    `\nMateri:\n${sources.join("\n\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const HANDWRITING_PROMPT = [
  "Gambar berikut berisi tulisan tangan (satu gambar per halaman, berurutan). Salin semua tulisannya menjadi teks.",
  "- Pertahankan urutan, baris, judul, dan daftar (gunakan '-' atau nomor seperti aslinya).",
  "- Tulisan yang dicoret diabaikan; kata yang tidak terbaca ditandai [tidak terbaca].",
  "- Rumus matematika ditulis dengan LaTeX: '$...$' inline atau '$$...$$' untuk blok.",
  "- Gambar, panah, atau diagram dijelaskan singkat dalam tanda kurung siku, mis. [diagram: alur A → B].",
  "- Jangan menerjemahkan, meringkas, atau menambah komentar. Keluarkan HANYA teks hasil salinan.",
].join("\n");

export const EXTRACT_PROMPT = [
  "Salin seluruh teks dan informasi penting dari dokumen ini apa adanya untuk dijadikan bahan referensi.",
  "- Jangan meringkas, menerjemahkan, atau menambah komentar.",
  "- Pertahankan urutan, judul, daftar, dan angka; tabel ditulis sebagai tabel Markdown.",
  "- Untuk gambar tanpa teks, deskripsikan isinya secara singkat dan faktual.",
].join("\n");

// ---------------------------------------------------------------------------- List

export const listProgress = (list: Pick<FreeList, "items">) => {
  const done = list.items.filter((i) => i.checked).length;
  return {
    done,
    total: list.items.length,
    percent: list.items.length ? Math.round((done / list.items.length) * 100) : 0,
  };
};

/** Pindahkan item satu langkah ke atas (-1) atau ke bawah (+1). Di ujung daftar → tidak berubah. */
export const moveItem = <T>(items: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const removeCheckedItems = (items: ListItem[]) => items.filter((i) => !i.checked);
