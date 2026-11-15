import { Info } from "lucide-react";

const NOTES = {
  office: {
    title: "Dokumen di sini tidak masuk Resource",
    body: (
      <>
        Dokumen di ruang kerja ini hanya milik Anda dan <b>tidak</b> menjadi Resource Global maupun arsip File Control.
        Untuk memakainya di <b>Working Space</b>, buka form Resource atau lampiran (Project, Action/Task, Agenda) → tipe{" "}
        <b>Buat Dokumen (ONLYOFFICE)</b> → <b>Dari Dokumen Saya</b>. Dokumen disalin ke sana; aslinya tetap di sini.
      </>
    ),
  },
  converter: {
    title: "Hasil konversi tidak masuk Resource",
    body: (
      <>
        Hasil di pustaka ini hanya milik Anda dan <b>tidak</b> menjadi Resource Global, arsip File Control, maupun
        indeks AI. Untuk memakainya di <b>Working Space</b>, buka form Resource atau lampiran (Project, Action/Task,
        Agenda) → tipe <b>Berkas</b> → <b>Dari MD Converter</b>. Hasil disalin sebagai berkas .md; aslinya tetap di
        sini.
      </>
    ),
  },
} as const;

/** Keterangan konsep ruang kerja Tools (ONLYOFFICE & Markdown Converter): terpisah dari Resource kecuali dipanggil Working Space. */
export function WorkspaceConceptNote({ kind }: { kind: keyof typeof NOTES }) {
  const note = NOTES[kind];
  return (
    <div className="flex gap-2.5 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-module" />
      <p>
        <span className="font-medium text-foreground">{note.title}.</span> {note.body}
      </p>
    </div>
  );
}
