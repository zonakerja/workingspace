import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, FilePen, FilePlus2, FileText, Loader2, PenLine, Printer, Send } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSimanRequests, useSrikandiOutgoings } from "@/data/collections";
import { useRequest } from "@/data/use-requests";
import { RegisterDialog } from "@/features/srikandi/register-dialog";
import { emptyOutgoing } from "@/features/srikandi/register-logic";
import { openOfficeEditor } from "@/features/tools/onlyoffice/office-editor-host";
import { officeApi, robotApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import { links } from "@/lib/deep-links";
import { generateId } from "@/lib/ids";
import type { SimanRequest, SimanTicketDocument, SrikandiOutgoing } from "@/types/entities";

const KIND_LABEL: Record<SimanTicketDocument["kind"], string> = {
  analysis: "Dokumen Analisis",
  decree: "Konsep KM PSP",
};

const nowIso = () => new Date().toISOString();

/** Hal naskah bawaan di Register SRIKANDI. */
function registerSubject(doc: SimanTicketDocument, item: SimanRequest) {
  const satker = item.satkerName || item.satkerCode || "";
  return doc.kind === "decree"
    ? `Keputusan Menteri Perhubungan tentang Penetapan Status Penggunaan Barang Milik Negara pada ${satker}`
    : `Dokumen Analisis Usulan Penetapan Status Penggunaan BMN ${satker} (${item.ticket})`;
}

/**
 * Dokumen hasil workflow Penetapan SIMAN untuk satu tiket: dibuka & diubah di ONLYOFFICE (suntingan dibaca agen untuk
 * dipelajari). Setelah oke: konsep KM PSP dinaikkan ke SRIKANDI lewat Register; Dokumen Analisis memilih cara
 * **konvensional** (cetak & tanda tangan basah, tidak ke SRIKANDI) atau **digital** (lewat Register SRIKANDI). Isian
 * SRIKANDI yang belum diketahui ditanyakan lewat formulir Register.
 */
export function TicketDocuments({ item }: { item: SimanRequest }) {
  const navigate = useNavigate();
  const { upsert } = useSimanRequests();
  const { items: registers } = useSrikandiOutgoings();
  const docs = item.documents ?? [];
  const { data } = useQuery({
    queryKey: ["siman", "documents", item.ticket],
    queryFn: () => robotApi.simanDocuments(item.ticket),
    enabled: docs.length > 0,
    refetchInterval: 30_000,
  });
  const status = new Map((data?.tiket[0]?.dokumen ?? []).map((d) => [d.uploadId, d] as const));
  const [entry, setEntry] = useState<{ value: SrikandiOutgoing; doc: SimanTicketDocument } | null>(null);
  // Naskah baru boleh ke SRIKANDI setelah pengajuan Approval-nya disetujui (pemilik / Kebijakan Otomatis)
  const { data: request } = useRequest(item.requestId ?? null);
  const approved = !item.requestId || request?.status === "disetujui" || request?.status === "dikirim";
  const [saving, setSaving] = useState<string | null>(null);

  const updateDoc = (uploadId: string, patch: Partial<SimanTicketDocument>) =>
    upsert({ ...item, documents: docs.map((d) => (d.uploadId === uploadId ? { ...d, ...patch } : d)) });

  const toSrikandi = async (doc: SimanTicketDocument) => {
    const existing = doc.registerId ? registers.find((r) => r.id === doc.registerId) : undefined;
    if (existing) {
      void navigate(links.srikandiRegister(existing.id));
      return;
    }
    setSaving(doc.uploadId);
    // Isi terakhir ONLYOFFICE disimpan dulu agar yang didaftarkan = hasil review pemilik
    await officeApi.forceSave(doc.uploadId).catch(() => undefined);
    setSaving(null);
    if (doc.kind === "analysis") updateDoc(doc.uploadId, { method: "digital" });
    setEntry({
      doc,
      value: {
        ...emptyOutgoing(generateId("reg")),
        createdAt: nowIso(),
        subject: registerSubject(doc, item),
        file: { uploadId: doc.uploadId, name: doc.name },
        uploadId: doc.uploadId,
        ...(item.requestId
          ? { sourceType: "request" as const, sourceId: item.requestId }
          : { sourceType: "file" as const }),
        sourceTitle: `SIMAN ${item.ticket} · ${KIND_LABEL[doc.kind]}`,
      },
    });
  };

  if (!docs.length) {
    return (
      <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
        Belum ada dokumen hasil. Jalankan workflow Penetapan SIMAN; AI agent membuat Dokumen Analisis dan konsep KM PSP
        di sini untuk Anda periksa dan ubah di ONLYOFFICE.
      </p>
    );
  }
  return (
    <div className="grid gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Dokumen hasil ({docs.length})</p>
        {item.requestId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate(`/requests?request=${encodeURIComponent(item.requestId!)}`)}
          >
            <ClipboardCheck /> Buka di Approval
          </Button>
        )}
      </div>
      {item.requestId && (
        <p className="text-[11px] text-muted-foreground">
          Hasil kerja AI agent masuk antrian Approval (Menunggu verifikasi). Periksa, ubah, lalu putuskan di Approval.
        </p>
      )}
      {docs.map((doc) => {
        const s = status.get(doc.uploadId);
        const edited = s && "disuntingPemilik" in s && s.disuntingPemilik;
        return (
          <div key={doc.uploadId} className="grid gap-2 rounded-lg bg-muted/40 p-2.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <FileText className="size-4 shrink-0 text-module" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={doc.name}>
                {doc.name}
              </span>
              <Badge variant="secondary">{KIND_LABEL[doc.kind]}</Badge>
              {edited ? (
                <Badge className="bg-info/12 text-info">Disunting (versi {s.versi})</Badge>
              ) : (
                <Badge variant="outline">Buatan AI agent</Badge>
              )}
              {s && "ada" in s && !s.ada && (
                <Badge className="bg-destructive/12 text-destructive">Berkas dihapus</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dibuat {formatDateTime(doc.createdAt)}
              {doc.method === "konvensional" && " · Ditandatangani konvensional (tidak lewat SRIKANDI)"}
              {doc.registerId && " · Sudah di Register SRIKANDI"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openOfficeEditor({ uploadId: doc.uploadId, name: doc.name })}
              >
                <PenLine /> Periksa & ubah
              </Button>
              {doc.kind === "analysis" && !doc.registerId && (
                <Button
                  size="sm"
                  variant={doc.method === "konvensional" ? "secondary" : "outline"}
                  onClick={() => {
                    updateDoc(doc.uploadId, { method: doc.method === "konvensional" ? undefined : "konvensional" });
                    if (doc.method !== "konvensional")
                      toast.success("Dokumen Analisis ditandai konvensional.", {
                        description: "Cetak dari ONLYOFFICE (menu File → Cetak) lalu tanda tangani basah.",
                      });
                  }}
                >
                  <Printer /> {doc.method === "konvensional" ? "Konvensional (batalkan)" : "Konvensional"}
                </Button>
              )}
              {(doc.kind === "decree" || doc.method !== "konvensional") && (
                <Button
                  size="sm"
                  disabled={saving === doc.uploadId || (!doc.registerId && !approved)}
                  title={!doc.registerId && !approved ? "Setujui pengajuan di Approval dulu" : undefined}
                  onClick={() => void toSrikandi(doc)}
                >
                  {saving === doc.uploadId ? (
                    <Loader2 className="animate-spin" />
                  ) : doc.registerId ? (
                    <FilePen />
                  ) : doc.kind === "decree" ? (
                    <Send />
                  ) : (
                    <FilePlus2 />
                  )}
                  {doc.registerId
                    ? "Buka Register SRIKANDI"
                    : doc.kind === "decree"
                      ? "Naikkan ke SRIKANDI"
                      : "Digital (SRIKANDI)"}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">
        Suntingan Anda di ONLYOFFICE dibaca AI agent untuk dipelajari pada tiket berikutnya.{" "}
        {approved
          ? "Pengajuan sudah disetujui: naikkan ke SRIKANDI — isian SRIKANDI yang belum diketahui (klasifikasi, penandatangan, tujuan, …) diisi di formulir Register."
          : "Naik ke SRIKANDI terbuka setelah pengajuan disetujui di Approval (atau oleh Kebijakan Otomatis)."}
      </p>
      <RegisterDialog
        open={!!entry}
        entry={entry?.value ?? null}
        isNew
        onClose={() => setEntry(null)}
        onSaved={(saved) => {
          if (entry) updateDoc(entry.doc.uploadId, { registerId: saved.id });
          toast.success("Register naskah keluar disimpan.", {
            description: "Daftarkan ke SRIKANDI dari menu SRIKANDI → Register Naskah Keluar.",
            action: { label: "Buka Register", onClick: () => void navigate(links.srikandiRegister(saved.id)) },
          });
        }}
      />
    </div>
  );
}
