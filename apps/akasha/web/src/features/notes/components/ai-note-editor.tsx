import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Eye,
  FileText,
  Download,
  Mic,
  Paperclip,
  PencilLine,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router";
import { toast } from "sonner";
import { Markdown } from "@/components/common/markdown";
import { SearchableSelect } from "@/components/common/searchable-select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSchedules } from "@/data/collections";
import { useAssetUrl } from "@/data/use-asset-url";
import { openAttachment } from "@/features/resources/resource-utils";
import { AI_NOT_CONFIGURED, useAi } from "@/lib/ai/use-ai";
import { ApiError, errorMessage } from "@/lib/api/client";
import { uploadsApi } from "@/lib/api/endpoints";
import { links } from "@/lib/deep-links";
import { formatFullDate, parseLocalYMD } from "@/lib/dates";
import { trackPendingUpload, untrackPendingUpload } from "@/lib/pending-uploads";
import { cn } from "@/lib/utils";
import type { AiNote, NoteAudioItem, NoteFileAttachment } from "@/types/entities";
import {
  appendBackup,
  backupKey,
  backupSummary,
  clearBackup,
  readBackup,
  type RecordingBackup,
} from "@/lib/recording-backup";
import { useAuthStore } from "@/stores/auth-store";
import { generateId } from "@/lib/ids";
import { markRecordingActive } from "@/lib/recording-guard";
import { agendaLabel, agendaOptions } from "../lib/agenda-options";
import {
  buildSummaryPrompt,
  clampContext,
  documentKey,
  formatDuration,
  documentSources,
  documentsOf,
  MAX_NOTE_DOCUMENTS,
  withDocumentList,
  audioFields,
  audiosOf,
  MAX_NOTE_AUDIOS,
  withAudioList,
  hasSummarySource,
  type SummaryStyle,
  unreferencedUploads,
  uploadIdsOf,
} from "../lib/notes-logic";
import { CancelledError, DOCUMENT_ACCEPT, readFileText } from "../lib/read-file-text";
import { discardUploads, mergeOrphanIds, releaseUploads, removeUploadsCollectForbidden } from "../lib/remove-uploads";
import { SummaryStyleDialog } from "./summary-style-dialog";
import { usePermissions } from "@/hooks/use-permissions";
import { CommentsPanel } from "@/features/sharing/comments-panel";
import { ShareButton } from "@/features/sharing/share-dialog";
import { SharedBadge } from "@/features/sharing/shared-badge";

type ProcessStatus = "idle" | "processing" | "done" | "error";
type DocumentState = { status: ProcessStatus; step: string };
/** Keadaan satu audio di editor (tidak disimpan): status proses, URL lokal, rekaman yang belum sampai ke server. */
type AudioState = {
  status: ProcessStatus;
  step: string;
  localUrl?: string;
  unsaved?: { blob: Blob; fileName: string };
};
/** Potongan rekaman ditulis ke cadangan browser tiap 10 detik. */
const BACKUP_SLICE_MS = 10_000;
const nowMs = () => Date.now();

const NO_SCHEDULE = "__none__";
/** Batas lampiran `POST /ai/generate`. */
/** Cukup jelas untuk suara: rekaman 2 jam ± 45 MB (bawaan browser ± 128 kbps = ± 110 MB). */
const RECORDING_BITS_PER_SECOND = 48_000;
/** Kuota/limit provider AI habis (backend mengembalikan 429). */
const isQuotaError = (error: unknown) => error instanceof ApiError && error.status === 429;

function StatusBadge({ status, processingLabel }: { status: ProcessStatus; processingLabel: string }) {
  if (status === "processing")
    return (
      <Badge className="bg-warning/20 text-warning-foreground dark:text-warning">
        <Spinner className="size-3" /> {processingLabel}
      </Badge>
    );
  if (status === "error") return <Badge className="bg-destructive/12 text-destructive">Gagal</Badge>;
  if (status === "done")
    return (
      <Badge className="bg-success/15 text-success">
        <CheckCircle2 /> Siap
      </Badge>
    );
  return null;
}

export function AiNoteEditor({
  note,
  readOnly,
  onPersist,
  onExit,
}: {
  note: AiNote;
  readOnly: boolean;
  /** Simpan catatan ke koleksi (tanpa menutup editor) */
  onPersist: (note: AiNote) => void;
  /** Tutup editor (kembali ke daftar) */
  onExit: () => void;
}) {
  const ai = useAi();
  const navigate = useNavigate();
  const { items: schedules } = useSchedules();
  // Notes AI milik user lain (berbagi, izin edit): berkas baru disimpan atas nama pemiliknya
  const { uploadOwnerId } = usePermissions();
  const [draft, setDraft] = useState<AiNote>(() => withAudioList(withDocumentList(note)));
  const [dirty, setDirty] = useState(false);
  const [audioStates, setAudioStates] = useState<Record<string, AudioState>>({});
  const [docStates, setDocStates] = useState<Record<string, DocumentState>>({});
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [backRequested, setBackRequested] = useState(false);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  // Rekaman terputus (tab ditutup / crash) yang tersimpan di cadangan browser untuk catatan ini
  const [recovered, setRecovered] = useState<RecordingBackup | null>(null);
  const userId = useAuthStore((st) => st.user?.id);
  const recordingKey = backupKey(userId, note.id);
  // Jumlah upload yang masih berjalan; Simpan dinonaktifkan agar uploadId tidak hilang
  const [pendingUploads, setPendingUploads] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** Audio yang sudah dilepas: hasil unggah/transkrip yang masih berjalan diabaikan. */
  const removedAudiosRef = useRef(new Set<string>());
  /** Proses transkrip terbaru per audio (mengulang = proses lama diabaikan). */
  const audioRunRef = useRef<Record<string, number>>({});
  const recordingStartedRef = useRef(0);
  /** Dokumen yang sudah dilepas: hasil unggah/baca yang masih berjalan diabaikan. */
  const removedDocsRef = useRef(new Set<string>());
  /** Semua berkas yang diunggah selama editor terbuka (dibersihkan saat simpan/buang bila tidak dipakai). */
  const sessionUploadsRef = useRef(new Set<string>());
  const unmountedRef = useRef(false);
  /** true saat editor sengaja ditutup → navigasi tidak dicegat. */
  const leavingRef = useRef(false);

  const audios = audiosOf(draft);
  const documents = documentsOf(draft);
  const linkedSchedule = schedules.find((s) => s.id === draft.linkedScheduleId);
  const processing =
    Object.values(audioStates).some((st) => st.status === "processing") ||
    Object.values(docStates).some((st) => st.status === "processing");
  const unsavedAudios = audios.filter((a) => audioStates[a.id]?.unsaved);
  const guardActive = !readOnly && (dirty || recording || pendingUploads > 0 || processing);

  // ---------------------------------------------------------------- Cegah perubahan hilang
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      guardActive &&
      !leavingRef.current &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (!guardActive) return;
    // Tampilan dialognya milik browser (teks tidak bisa diatur); preventDefault + returnValue = semua browser
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [guardActive]);

  // Pewaktu rekaman + judul tab: tetap terlihat saat user pindah tab, agar tidak ditutup tanpa sengaja
  useEffect(() => {
    if (!recording) return;
    const releaseRecording = markRecordingActive();
    const started = Date.now();
    const originalTitle = document.title;
    const tick = () => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setRecordingSeconds(seconds);
      document.title = `🔴 Merekam ${formatDuration(seconds)} · ${originalTitle}`;
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      releaseRecording();
      clearInterval(timer);
      document.title = originalTitle;
    };
  }, [recording]);

  // Matikan mikrofon saat editor ditutup. Flag di-set ulang saat mount karena StrictMode (dev) menjalankan
  // cleanup sekali setelah mount pertama.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  // URL lokal audio dilepas saat editor ditutup
  const audioStatesRef = useRef(audioStates);
  useEffect(() => {
    audioStatesRef.current = audioStates;
  }, [audioStates]);
  useEffect(
    () => () => Object.values(audioStatesRef.current).forEach((st) => st.localUrl && URL.revokeObjectURL(st.localUrl)),
    [],
  );

  // Cadangan rekaman yang terputus untuk catatan ini (tab tertutup / crash saat merekam)
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    void readBackup(recordingKey).then((backup) => {
      if (active && backup?.chunks.length) setRecovered(backup);
    });
    return () => {
      active = false;
    };
  }, [recordingKey, readOnly]);

  const patch = (values: Partial<AiNote>) => {
    setDraft((prev) => ({ ...prev, ...values }));
    setDirty(true);
  };

  const trackUpload = (file: File, context: string) => {
    setPendingUploads((n) => n + 1);
    return uploadsApi
      .upload(file, context, uploadOwnerId)
      .then((asset) => {
        sessionUploadsRef.current.add(asset.id);
        // Editor sudah ditutup (perubahan dibuang) sebelum upload selesai → berkas tidak dipakai
        if (unmountedRef.current) discardUploads([asset.id]);
        // Dicatat sampai catatan disimpan: tab di-reload/ditutup sebelum Simpan → berkas dibersihkan janitor
        else trackPendingUpload(asset.id);
        return asset;
      })
      .finally(() => setPendingUploads((n) => n - 1));
  };

  const reportAiError = (title: string, error: unknown, quotaHint: string) => {
    const msg = errorMessage(error);
    if (isQuotaError(error)) toast.error("Limit API Tercapai ⚠️", { description: `${msg} ${quotaHint}` });
    else toast.error(title, { description: msg });
  };

  const requireAi = () => {
    if (ai.isConfigured) return true;
    toast.error("AI belum diatur", { description: AI_NOT_CONFIGURED });
    return false;
  };

  // ---------------------------------------------------------------- Audio
  const setAudios = (update: (items: NoteAudioItem[]) => NoteAudioItem[]) => {
    setDraft((prev) => ({ ...prev, ...audioFields(update(audiosOf(prev))) }));
    setDirty(true);
  };
  const setAudioState = (id: string, next: Partial<AudioState>) =>
    setAudioStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { status: "idle", step: "" }), ...next } }));
  const audioCurrent = (id: string) => !removedAudiosRef.current.has(id) && !unmountedRef.current;

  const transcribeAudio = async (id: string, uploadId: string) => {
    if (!requireAi()) {
      setAudioState(id, { status: "error", step: "" });
      return;
    }
    const run = (audioRunRef.current[id] ?? 0) + 1;
    audioRunRef.current[id] = run;
    const isCurrent = () => audioCurrent(id) && audioRunRef.current[id] === run;
    setAudioState(id, { status: "processing", step: "Mentranskrip... rekaman panjang bisa beberapa menit" });
    try {
      const result = await ai.transcribe(uploadId, isCurrent);
      if (!result || !isCurrent()) return;
      setAudios((items) => items.map((a) => (a.id === id ? { ...a, transcript: result.text } : a)));
      setAudioState(id, { status: "done", step: "" });
      if (result.warning) toast.warning("Transkrip belum lengkap", { description: result.warning });
    } catch (error) {
      if (!isCurrent()) return;
      setAudioState(id, { status: "error", step: "" });
      reportAiError("Gagal transkrip audio", error, "Audio tetap tersimpan; coba Transkrip ulang nanti.");
    }
  };

  /** Audio masuk object storage dulu (aman walau transkrip gagal), baru ditranskrip dari sana. */
  const uploadAudio = async (id: string, blob: Blob, fileName: string, backup?: string) => {
    setAudioState(id, { status: "processing", step: "Mengunggah audio...", unsaved: { blob, fileName } });
    let uploadId: string;
    try {
      const asset = await trackUpload(new File([blob], fileName, { type: blob.type || "audio/webm" }), "ai_note_audio");
      uploadId = asset.id;
    } catch (error) {
      if (!audioCurrent(id)) return;
      setAudioState(id, { status: "error", step: "" });
      toast.error(`"${fileName}" gagal diunggah`, {
        description: `${errorMessage(error)} Rekaman masih ada di tab ini: unggah ulang atau unduh, jangan tutup tab.`,
      });
      return;
    }
    if (!audioCurrent(id)) return;
    // Sudah aman di server → cadangan browser tidak diperlukan lagi
    if (backup) void clearBackup(backup);
    setAudioState(id, { unsaved: undefined });
    setAudios((items) => items.map((a) => (a.id === id ? { ...a, uploadId } : a)));
    await transcribeAudio(id, uploadId);
  };

  /** Tambah satu audio (rekaman / unggahan) ke daftar, lalu unggah & transkrip. */
  const addAudio = async (blob: Blob, fileName: string, backup?: string) => {
    if (audiosOf(draft).length >= MAX_NOTE_AUDIOS) {
      toast.error(`Maksimal ${MAX_NOTE_AUDIOS} audio per catatan`);
      return;
    }
    const id = generateId("aud");
    setAudios((items) => [...items, { id, name: fileName, mimeType: blob.type || "audio/webm" }]);
    setAudioState(id, { status: "processing", step: "Menunggu...", localUrl: URL.createObjectURL(blob) });
    await uploadAudio(id, blob, fileName, backup);
  };

  const handleAudioFiles = async (files: File[]) => {
    const room = Math.max(MAX_NOTE_AUDIOS - audios.length, 0);
    if (files.length > room)
      toast.error(`Maksimal ${MAX_NOTE_AUDIOS} audio per catatan`, {
        description: `${files.length - room} berkas tidak ditambahkan.`,
      });
    // Satu per satu: transkrip memakai kuota AI
    for (const file of files.slice(0, room)) await addAudio(file, file.name);
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (audios.length >= MAX_NOTE_AUDIOS) {
      toast.error(`Maksimal ${MAX_NOTE_AUDIOS} audio per catatan`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
      const startedAt = nowMs();
      const key = recordingKey;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recordingStartedRef.current = startedAt;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        chunksRef.current.push(e.data);
        // Cadangan di browser: rekaman bisa dipulihkan bila tab tertutup sebelum dihentikan
        void appendBackup(key, e.data, recorder.mimeType || "audio/webm", startedAt);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void addAudio(
          new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }),
          `rekaman-${new Date(startedAt).toLocaleString("sv-SE").replace(/[: ]/g, "-")}.webm`,
          key,
        );
      };
      recorder.start(BACKUP_SLICE_MS);
      setRecording(true);
    } catch (error) {
      toast.error("Gagal mengakses mikrofon", { description: errorMessage(error) });
      setRecording(false);
    }
  };

  const removeAudio = (id: string) => {
    removedAudiosRef.current.add(id);
    const state = audioStates[id];
    if (state?.localUrl) URL.revokeObjectURL(state.localUrl);
    setAudios((items) => items.filter((a) => a.id !== id));
    setAudioStates((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const restoreRecording = async () => {
    if (!recovered) return;
    const backup = recovered;
    setRecovered(null);
    await addAudio(
      new Blob(backup.chunks, { type: backup.mimeType }),
      `rekaman-pulihan-${new Date(backup.startedAt).toLocaleString("sv-SE").replace(/[: ]/g, "-")}.webm`,
      backup.key,
    );
  };

  const discardRecovered = () => {
    if (recovered) void clearBackup(recovered.key);
    setRecovered(null);
  };

  // ---------------------------------------------------------------- Dokumen
  const patchDocuments = (update: (docs: NoteFileAttachment[]) => NoteFileAttachment[]) => {
    setDraft((prev) => ({ ...prev, fileAttachments: update(prev.fileAttachments ?? []) }));
    setDirty(true);
  };
  const setDocState = (id: string, state: DocumentState) => setDocStates((prev) => ({ ...prev, [id]: state }));

  const processDocument = async (id: string, file: File) => {
    const isCurrent = () => !removedDocsRef.current.has(id) && !unmountedRef.current;
    if (!isCurrent()) return;
    setDocState(id, { status: "processing", step: "Mengunggah..." });
    try {
      const asset = await trackUpload(file, "ai_note_file");
      if (!isCurrent()) return;
      patchDocuments((docs) => docs.map((doc) => (doc.id === id ? { ...doc, uploadId: asset.id } : doc)));
      setDocState(id, { status: "processing", step: "Membaca isi..." });
      const { text } = await readFileText({
        assetId: asset.id,
        file,
        canUseAi: ai.isConfigured,
        generate: ai.generate,
        isCancelled: () => !isCurrent(),
      });
      if (!isCurrent()) return;
      setDraft((prev) => ({ ...prev, documentTexts: { ...prev.documentTexts, [id]: clampContext(text) } }));
      setDocState(id, { status: "done", step: "" });
    } catch (error) {
      if (error instanceof CancelledError || !isCurrent()) return;
      setDocState(id, { status: "error", step: "" });
      reportAiError(`"${file.name}" tidak terbaca`, error, "Berkas tetap terlampir; hapus dan unggah ulang nanti.");
    }
  };

  const handleFiles = async (selected: File[]) => {
    const room = Math.max(MAX_NOTE_DOCUMENTS - documents.length, 0);
    const accepted = selected.slice(0, room).map((file) => ({ file, id: generateId("doc") }));
    if (accepted.length < selected.length) {
      toast.error(`Maksimal ${MAX_NOTE_DOCUMENTS} dokumen per catatan`, {
        description: `${selected.length - accepted.length} berkas tidak ditambahkan.`,
      });
    }
    if (!accepted.length) return;
    patchDocuments((docs) => [
      ...docs,
      ...accepted.map(({ file, id }) => ({ id, name: file.name, mimeType: file.type })),
    ]);
    setDocStates((prev) => ({
      ...prev,
      ...Object.fromEntries(accepted.map(({ id }) => [id, { status: "processing" as const, step: "Menunggu..." }])),
    }));
    // Satu per satu: OCR dokumen scan memakai kuota AI
    for (const { file, id } of accepted) await processDocument(id, file);
  };

  const removeDocument = (id: string) => {
    removedDocsRef.current.add(id);
    patchDocuments((docs) => docs.filter((doc) => documentKey(doc) !== id));
    setDraft((prev) => {
      const { [id]: _removed, ...rest } = prev.documentTexts ?? {};
      return { ...prev, documentTexts: rest };
    });
    setDocStates((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  // ---------------------------------------------------------------- Ringkasan
  const startGenerate = () => {
    if (!hasSummarySource(draft)) {
      toast.error("Data kurang", {
        description: "Isi minimal Catatan Kasar, atau sediakan audio/dokumen berstatus Siap terlebih dahulu.",
      });
      return;
    }
    if (processing) {
      toast.error("Proses masih berjalan", {
        description: "Tunggu transkrip/pembacaan dokumen selesai (status Siap).",
      });
      return;
    }
    if (requireAi()) setStyleOpen(true);
  };

  const generate = async (style: SummaryStyle, customInstruction: string) => {
    setStyleOpen(false);
    setGenerating(true);
    setMode("preview");
    const prompt = buildSummaryPrompt({
      style,
      customInstruction,
      title: draft.title,
      dateLabel: draft.date ? formatFullDate(parseLocalYMD(draft.date)) : undefined,
      agendaLabel: linkedSchedule ? agendaLabel(linkedSchedule) : undefined,
      content: draft.content,
      audioTranscript: draft.audioTranscript,
      documents: documentSources(draft),
    });
    try {
      const summary = await ai.generate(prompt);
      if (!unmountedRef.current) patch({ aiSummary: summary });
    } catch (error) {
      reportAiError("Gagal membuat ringkasan", error, "Silakan coba Buat Ringkasan lagi setelah beberapa saat.");
    } finally {
      setGenerating(false);
    }
  };

  // ---------------------------------------------------------------- Simpan / keluar
  const leave = () => {
    leavingRef.current = true;
    if (blocker.state === "blocked") blocker.proceed();
    else onExit();
  };

  const cancelLeave = () => {
    setBackRequested(false);
    if (blocker.state === "blocked") blocker.reset();
  };

  /** Simpan draf; false bila belum bisa disimpan. */
  const persist = () => {
    if (pendingUploads > 0 || processing) {
      toast.error("Tunggu sebentar", { description: "Berkas masih diunggah atau diproses." });
      return false;
    }
    if (recording) {
      toast.error("Rekaman masih berjalan", { description: "Hentikan rekaman dulu agar audionya ikut tersimpan." });
      return false;
    }
    if (unsavedAudios.length) {
      toast.error("Audio belum tersimpan di server", {
        description: "Unggah ulang atau hapus audionya dulu. Bila disimpan sekarang, rekaman akan hilang.",
      });
      return false;
    }
    if (!draft.title.trim()) {
      toast.error("Judul notes wajib diisi.");
      return false;
    }
    // Dokumen yang gagal diunggah tidak punya berkas untuk disimpan
    const toSave = {
      ...draft,
      fileAttachments: draft.fileAttachments?.filter((doc) => doc.uploadId),
      ...audioFields(audiosOf(draft).filter((a) => a.uploadId)),
    };
    onPersist(toSave);
    const unused = unreferencedUploads([...uploadIdsOf(note), ...sessionUploadsRef.current], draft);
    if (!note.share) releaseUploads(unused, sessionUploadsRef.current);
    else if (unused.length) {
      // Notes AI bersama: berkas milik pemilik tidak boleh dihapus kolaborator → dicatat untuk dibersihkan pemilik
      const saved = toSave;
      void removeUploadsCollectForbidden(unused).then(
        (forbidden) =>
          forbidden.length &&
          onPersist({ ...saved, orphanUploadIds: mergeOrphanIds(saved.orphanUploadIds, forbidden) }),
      );
    }
    releaseSessionUploads();
    setDirty(false);
    return true;
  };

  /** Berkas sesi ini sudah tersimpan (atau sudah dihapus) → tidak lagi dicatat sebagai upload yang tertunda. */
  const releaseSessionUploads = () => {
    for (const id of sessionUploadsRef.current) untrackPendingUpload(id);
  };

  const save = () => {
    if (persist()) leave();
  };

  const discard = () => {
    discardUploads(unreferencedUploads(sessionUploadsRef.current, note));
    releaseSessionUploads();
    leave();
  };

  const back = () => (guardActive ? setBackRequested(true) : onExit());

  const leaveDialogOpen = backRequested || blocker.state === "blocked";
  const busy = pendingUploads > 0 || processing;
  // Rekaman yang masih berjalan akan hilang bila disimpan & editor ditutup → hentikan dulu
  const saveBlocked = busy || recording;

  return (
    <Card className="animate-in fade-in slide-in-from-right-4">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 border-b pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Kembali" onClick={back}>
              <ChevronLeft />
            </Button>
            <h3 className="truncate text-lg font-bold">Detail Notes AI</h3>
            {dirty && !readOnly && (
              <Badge variant="outline" className="hidden sm:inline-flex">
                Belum disimpan
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <SharedBadge item={note} recordType="ai_note" />
            <ShareButton item={note} recordType="ai_note" title={draft.title} iconOnly />
            {!readOnly && (
              <Button
                onClick={save}
                disabled={saveBlocked}
                title={recording ? "Hentikan rekaman dulu sebelum menyimpan" : undefined}
              >
                {busy ? (
                  <>
                    <Spinner /> {pendingUploads > 0 ? "Mengunggah..." : "Memproses..."}
                  </>
                ) : recording ? (
                  "Sedang merekam..."
                ) : (
                  "Simpan"
                )}
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ainote-title">Judul / Topik</FieldLabel>
            <Input
              id="ainote-title"
              readOnly={readOnly}
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ainote-date">Tanggal</FieldLabel>
            <Input
              id="ainote-date"
              type="date"
              readOnly={readOnly}
              value={draft.date ?? ""}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </Field>
          <Field className="md:col-span-2">
            <FieldLabel htmlFor="ainote-agenda">Agenda Terkait (Opsional)</FieldLabel>
            <div className="flex gap-2">
              <SearchableSelect
                id="ainote-agenda"
                className="min-w-0 flex-1"
                disabled={readOnly}
                value={draft.linkedScheduleId || NO_SCHEDULE}
                placeholder={draft.linkedScheduleId ? "Agenda sudah dihapus" : "Pilih agenda Planner"}
                searchPlaceholder="Cari agenda..."
                emptyText="Agenda tidak ditemukan."
                options={[{ value: NO_SCHEDULE, label: "Tanpa agenda" }, ...agendaOptions(schedules)]}
                onChange={(v) => {
                  const id = v === NO_SCHEDULE ? "" : v;
                  const selected = schedules.find((s) => s.id === id);
                  patch({ linkedScheduleId: id, title: draft.title || selected?.title || "" });
                }}
              />
              {linkedSchedule && (
                <Button
                  type="button"
                  variant="outline"
                  title="Buka agenda di Planner"
                  onClick={() => void navigate(links.schedule(linkedSchedule.id))}
                >
                  <ExternalLink /> <span className="hidden sm:inline">Buka</span>
                </Button>
              )}
            </div>
          </Field>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            {/* Audio sumber */}
            <section
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-3 transition-colors",
                recording ? "border-destructive/40 bg-destructive/6" : "bg-muted/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase">
                  <Mic className="size-3.5" /> Audio Sumber
                </span>
                {audios.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {audios.length}/{MAX_NOTE_AUDIOS}
                  </span>
                )}
              </div>
              {recovered && !readOnly && !recording && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
                  <TriangleAlert className="size-4 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    Ada rekaman yang terputus ({formatDuration(backupSummary(recovered).seconds)},{" "}
                    {(backupSummary(recovered).bytes / 1024 / 1024).toFixed(1)} MB) — tersimpan di browser ini.
                  </span>
                  <Button type="button" size="sm" onClick={() => void restoreRecording()}>
                    <Upload /> Pulihkan
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={discardRecovered}>
                    Buang
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="icon-lg"
                  disabled={readOnly}
                  variant={recording ? "destructive" : "outline"}
                  className={cn("shrink-0 rounded-full", recording && "animate-pulse bg-destructive text-white")}
                  title={recording ? "Hentikan rekaman" : "Rekam suara"}
                  aria-label={recording ? "Hentikan rekaman" : "Rekam suara"}
                  onClick={() => void toggleRecording()}
                >
                  {recording ? <Square /> : <Mic />}
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="icon-lg"
                  className="shrink-0 rounded-full"
                  title="Unggah berkas audio (bisa beberapa sekaligus)"
                >
                  <label className={cn((readOnly || recording) && "pointer-events-none opacity-50")}>
                    <Upload />
                    <input
                      type="file"
                      accept="audio/*"
                      multiple
                      className="hidden"
                      aria-label="Unggah berkas audio"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length) void handleAudioFiles(files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </Button>
                {recording ? (
                  <span className="text-xs font-medium text-destructive tabular-nums">
                    Merekam {formatDuration(recordingSeconds)}
                  </span>
                ) : (
                  audios.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      Rekam atau unggah audio (bisa beberapa berkas, mis. sesi pagi & siang).
                    </span>
                  )
                )}
              </div>
              {recording && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
                >
                  <TriangleAlert className="mt-px size-4 shrink-0" />
                  <span>
                    <strong>Jangan tutup tab atau browser.</strong> Rekaman dicadangkan di browser ini tiap 10 detik:
                    bila tab tertutup, buka catatan ini lagi untuk memulihkannya.
                  </span>
                </p>
              )}
              {audios.map((audio, index) => (
                <AudioRow
                  key={audio.id}
                  audio={audio}
                  index={index}
                  multiple={audios.length > 1}
                  state={audioStates[audio.id]}
                  readOnly={readOnly || recording}
                  onRemove={() => removeAudio(audio.id)}
                  onRetryUpload={(blob, fileName) => void uploadAudio(audio.id, blob, fileName)}
                  onTranscribe={() => audio.uploadId && void transcribeAudio(audio.id, audio.uploadId)}
                />
              ))}
            </section>

            {/* Dokumen tambahan */}
            <section className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase">
                  <Paperclip className="size-3.5" /> Dokumen Tambahan
                </span>
                {documents.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {documents.length}/{MAX_NOTE_DOCUMENTS}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Pelengkap ringkasan; bila ada audio, isi ringkasan tetap mengikuti rekaman.
              </p>
              <label
                className={cn(
                  "flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed bg-background/60 px-3 text-center text-xs text-muted-foreground transition-colors hover:border-module hover:text-module",
                  (readOnly || documents.length >= MAX_NOTE_DOCUMENTS) && "pointer-events-none opacity-60",
                )}
              >
                <Upload className="size-5" />
                Klik untuk unggah satu atau beberapa dokumen (PDF, DOCX, XLSX, teks, atau gambar)
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  multiple
                  className="hidden"
                  aria-label="Unggah dokumen"
                  onChange={(e) => {
                    const selected = [...(e.target.files ?? [])];
                    e.target.value = "";
                    if (selected.length) void handleFiles(selected);
                  }}
                />
              </label>
              {documents.map((doc) => {
                const id = documentKey(doc);
                const state = docStates[id];
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-module/25 bg-module-soft px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-xs">
                      <FileText className="size-4 shrink-0 text-module" />
                      <span className="truncate">{doc.name}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusBadge
                        status={state?.status ?? (draft.documentTexts?.[id]?.trim() ? "done" : "idle")}
                        processingLabel={state?.step || "Memproses..."}
                      />
                      {doc.uploadId && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void openAttachment({ uploadId: doc.uploadId, name: doc.name })}
                        >
                          <Eye /> Buka
                        </Button>
                      )}
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={`Hapus ${doc.name}`}
                          aria-label={`Hapus ${doc.name}`}
                          className="hover:text-destructive"
                          onClick={() => removeDocument(id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>

            <Field className="flex-1">
              <FieldLabel htmlFor="ainote-content" className="flex w-full justify-between">
                <span>Catatan Kasar</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  (wajib diisi bila tanpa audio/dokumen)
                </span>
              </FieldLabel>
              <Textarea
                id="ainote-content"
                rows={8}
                readOnly={readOnly}
                placeholder="Ketik ide, coretan rapat, atau ringkasan manual di sini..."
                value={draft.content ?? ""}
                onChange={(e) => patch({ content: e.target.value })}
              />
            </Field>
          </div>

          {/* Ringkasan AI */}
          <section className="flex min-h-96 flex-col overflow-hidden rounded-2xl border border-module/25">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-module-soft px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-bold text-module uppercase">
                <Bot className="size-3.5" /> Ringkasan AI
              </span>
              <div className="flex items-center gap-2">
                {draft.aiSummary && (
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={mode}
                    onValueChange={(v) => v && setMode(v as "preview" | "edit")}
                  >
                    <ToggleGroupItem value="preview">
                      <Eye /> Lihat
                    </ToggleGroupItem>
                    <ToggleGroupItem value="edit" disabled={readOnly}>
                      <PencilLine /> Ubah
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
                {!readOnly && (
                  <Button size="sm" onClick={startGenerate} disabled={generating}>
                    {generating ? <Spinner /> : <Sparkles />}{" "}
                    {generating ? "Memproses AI..." : draft.aiSummary ? "Buat Ulang" : "Buat Ringkasan"}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {draft.aiSummary ? (
                mode === "preview" ? (
                  <Markdown content={draft.aiSummary} />
                ) : (
                  <Textarea
                    aria-label="Ubah ringkasan AI"
                    className="min-h-80 resize-none border-none bg-transparent font-mono text-sm shadow-none focus-visible:ring-0"
                    value={draft.aiSummary}
                    onChange={(e) => patch({ aiSummary: e.target.value })}
                  />
                )
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="bg-module-soft text-module">
                      <Sparkles />
                    </EmptyMedia>
                    <EmptyDescription>
                      Isi catatan kasar, rekam/unggah audio, atau unggah dokumen (tunggu status "Siap"), lalu klik "Buat
                      Ringkasan".
                    </EmptyDescription>
                    {!ai.isConfigured && (
                      <p className="rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-semibold text-destructive">
                        AI belum diatur. Atur model di Akai (Pengaturan → Model AI).
                      </p>
                    )}
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </section>
        </div>
        <CommentsPanel recordType="ai_note" item={note} />
      </CardContent>

      <SummaryStyleDialog open={styleOpen} onOpenChange={setStyleOpen} onConfirm={(s, c) => void generate(s, c)} />

      <AlertDialog open={leaveDialogOpen} onOpenChange={(open) => !open && cancelLeave()}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{recording ? "Rekaman masih berjalan" : "Simpan perubahan?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {recording
                ? `Sudah merekam ${formatDuration(recordingSeconds)}. Bila keluar sekarang, rekaman ini hilang dan tidak bisa dikembalikan. Untuk menyimpannya, lanjutkan lalu tekan tombol stop.`
                : busy
                  ? "Berkas masih diunggah atau diproses. Bila keluar sekarang, perubahan pada catatan ini tidak disimpan."
                  : "Ada perubahan yang belum disimpan. Bila keluar tanpa menyimpan, perubahan dan berkas yang baru diunggah dibuang."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{recording ? "Lanjut merekam" : "Batal"}</AlertDialogCancel>
            <Button variant="destructive" onClick={discard}>
              {recording ? "Buang rekaman" : "Buang"}
            </Button>
            {!busy && !recording && (
              <Button
                onClick={() => {
                  if (!persist()) cancelLeave();
                  else leave();
                }}
              >
                Simpan
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function AudioRow({
  audio,
  index,
  multiple,
  state,
  readOnly,
  onRemove,
  onRetryUpload,
  onTranscribe,
}: {
  audio: NoteAudioItem;
  index: number;
  multiple: boolean;
  state?: AudioState;
  readOnly: boolean;
  onRemove: () => void;
  onRetryUpload: (blob: Blob, fileName: string) => void;
  onTranscribe: () => void;
}) {
  const remoteUrl = useAssetUrl(state?.localUrl ? null : audio.uploadId);
  const url = state?.localUrl ?? remoteUrl;
  const status: ProcessStatus = state?.status ?? (audio.transcript ? "done" : "idle");
  const idle = status !== "processing";
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={audio.name}>
          {multiple && <span className="text-muted-foreground">{index + 1}. </span>}
          {audio.name}
        </span>
        <StatusBadge status={status} processingLabel={state?.step || "Memproses..."} />
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon-xs"
            title="Hapus audio"
            aria-label={`Hapus ${audio.name}`}
            className="hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {url ? (
        <audio controls src={url} className="h-9 w-full" />
      ) : (
        <span className="text-xs text-muted-foreground">Audio terlampir</span>
      )}
      {!readOnly && idle && state?.unsaved && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">Belum tersimpan di server dan hanya ada di tab ini.</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onRetryUpload(state.unsaved!.blob, state.unsaved!.fileName)}
          >
            <Upload /> Unggah ulang
          </Button>
          {state.localUrl && (
            <Button asChild variant="outline" size="xs">
              <a href={state.localUrl} download={state.unsaved.fileName}>
                <Download /> Unduh
              </a>
            </Button>
          )}
        </div>
      )}
      {!readOnly && idle && audio.uploadId && !audio.transcript && (
        <Button type="button" variant="outline" size="xs" className="self-start" onClick={onTranscribe}>
          <Mic /> {status === "error" ? "Transkrip ulang" : "Buat transkrip"}
        </Button>
      )}
      {!readOnly && idle && audio.uploadId && audio.transcript?.includes(": gagal ditranskrip]") && (
        <Button type="button" variant="outline" size="xs" className="self-start" onClick={onTranscribe}>
          <Mic /> Transkrip bagian yang gagal
        </Button>
      )}
      {audio.transcript && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-muted-foreground">Transkrip</summary>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2 leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {audio.transcript}
          </div>
        </details>
      )}
    </div>
  );
}
