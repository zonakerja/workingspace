import { CircleCheck, CircleX, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRequestMutations } from "@/data/use-requests";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { RequestChecklistItem } from "@/types/api";
import { CHECK_LABELS, CHECK_TONE } from "./request-utils";

/** Butir yang meminta pemeriksaan pemilik: perlu dicek / diusulkan cek manual oleh AI agent, atau sudah ditandai. */
export const needsManualCheck = (c: RequestChecklistItem) => c.status === "perlu_dicek" || !!c.manual || !!c.check;

/**
 * Satu butir checklist kelengkapan. Butir yang perlu dicek manual punya tombol **Lolos** / **Bermasalah** (+ catatan) —
 * tanda ini dibaca AI agent saat menelaah ulang sehingga butir yang sudah aman tidak diusulkan lagi.
 */
export function ChecklistItemRow({
  requestId,
  item: c,
  readOnly,
}: {
  requestId: string;
  item: RequestChecklistItem;
  readOnly?: boolean;
}) {
  const m = useRequestMutations();
  const [draft, setDraft] = useState<"lolos" | "bermasalah" | null>(null);
  const [note, setNote] = useState("");
  const save = (result: "lolos" | "bermasalah" | null, text?: string) =>
    m.checkItem.mutate(
      { id: requestId, itemId: c.id, result, note: text?.trim() || undefined },
      {
        onSuccess: () => {
          setDraft(null);
          setNote("");
          toast.success(result ? "Tanda cek manual disimpan." : "Tanda cek manual dibatalkan.");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <li className="grid grid-cols-1 gap-1">
      <div className="flex flex-wrap items-start gap-2">
        <Badge className={cn("shrink-0", CHECK_TONE[c.status])}>{CHECK_LABELS[c.status]}</Badge>
        {c.manual && !c.check && (
          <Badge variant="outline" className="shrink-0">
            Cek manual
          </Badge>
        )}
        {c.check && (
          <Badge
            className={cn(
              "shrink-0 gap-1",
              c.check.result === "lolos" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
            )}
            title={`Dicek ${formatDateTime(c.check.at)}`}
          >
            {c.check.result === "lolos" ? <CircleCheck className="size-3" /> : <CircleX className="size-3" />}
            {c.check.result === "lolos" ? "Dicek: lolos" : "Dicek: bermasalah"}
          </Badge>
        )}
        <span className="min-w-0 flex-1">
          {c.dokumen}
          {c.catatan && <span className="text-xs text-muted-foreground"> — {c.catatan}</span>}
          {c.check?.note && <span className="block text-xs text-muted-foreground">Catatan cek: {c.check.note}</span>}
        </span>
        {!readOnly && needsManualCheck(c) && (
          <span className="flex shrink-0 gap-1">
            {c.check ? (
              <Button size="xs" variant="ghost" disabled={m.checkItem.isPending} onClick={() => save(null)}>
                <Undo2 /> Batalkan
              </Button>
            ) : (
              <>
                <Button size="xs" variant="outline" onClick={() => setDraft("lolos")}>
                  <CircleCheck /> Lolos
                </Button>
                <Button size="xs" variant="outline" onClick={() => setDraft("bermasalah")}>
                  <CircleX /> Bermasalah
                </Button>
              </>
            )}
          </span>
        )}
      </div>
      {draft && (
        <div className="grid grid-cols-1 gap-1.5 rounded-lg border bg-muted/40 p-2">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder={
              draft === "lolos"
                ? "Catatan pemeriksaan (opsional), mis. meterai asli dicek pada berkas fisik"
                : "Apa masalahnya? (dibaca AI agent saat menelaah ulang)"
            }
          />
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setDraft(null)}>
              Batal
            </Button>
            <Button size="xs" disabled={m.checkItem.isPending} onClick={() => save(draft, note)}>
              Simpan: {draft === "lolos" ? "lolos" : "bermasalah"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
