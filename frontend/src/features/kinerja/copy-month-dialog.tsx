import { CopyPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActionPlanEntries, useSkps, useSkpTargets } from "@/data/collections";
import { useOpenSession } from "@/hooks/use-retained";
import { generateId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { entryStatus, periodLabel, shiftPeriod } from "./lib/action-plan";
import { copiedEntry, copyCandidates } from "./lib/copy-month";

const nowIso = () => new Date().toISOString();

/**
 * Salin butir rutin dari bulan lalu ke bulan ini (Renaksi, Realisasi, RHK & indikator). Butir yang sudah ada di bulan ini
 * tidak bisa dipilih; bukti data dukung tidak ikut disalin (bukti tiap bulan harus dokumen bulan itu).
 */
export function CopyMonthDialog({
  open,
  onOpenChange,
  period,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
}) {
  const session = useOpenSession(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <CopyPlus className="size-5 text-module" /> Salin dari {periodLabel(shiftPeriod(period, -1))}
          </DialogTitle>
          <DialogDescription>
            Pilih butir rutin yang diulang di {periodLabel(period)}. Bukti data dukung tidak ikut disalin — lengkapi
            setelah disalin.
          </DialogDescription>
        </DialogHeader>
        {open && <CopyMonthForm key={session} period={period} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CopyMonthForm({ period, onDone }: { period: string; onDone: () => void }) {
  const { items: entries, upsert } = useActionPlanEntries();
  const { items: targets } = useSkpTargets();
  const { items: skps } = useSkps();
  const candidates = copyCandidates(entries, targets, skps, period);
  // Bawaan: semua yang belum ada di bulan ini
  const [picked, setPicked] = useState<string[]>(() => candidates.filter((c) => !c.exists).map((c) => c.entry.id));
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  const copy = () => {
    const chosen = candidates.filter((c) => !c.exists && picked.includes(c.entry.id));
    const now = nowIso();
    for (const c of chosen) {
      const next = copiedEntry(c, period, generateId("renaksi"), now);
      next.status = entryStatus(
        next,
        targets.find((t) => t.id === next.targetId),
      );
      upsert(next);
    }
    toast.success(`${chosen.length} butir disalin ke ${periodLabel(period)}.`, {
      description: "Lengkapi bukti data dukung bulan ini lewat Ubah, lalu Kirim ke e-Kinerja.",
    });
    onDone();
  };

  const selectable = candidates.filter((c) => !c.exists);
  return (
    <>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {candidates.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
            Belum ada isian di {periodLabel(shiftPeriod(period, -1))}.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {candidates.map((c) => (
              <li key={c.entry.id} className={cn("px-3 py-2", c.exists && "opacity-60")}>
                <label className="flex items-start gap-2.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={!c.exists && picked.includes(c.entry.id)}
                    disabled={c.exists}
                    onCheckedChange={(v) => toggle(c.entry.id, v === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium break-words">{c.entry.description}</span>
                    {c.entry.realization && (
                      <span className="block text-xs break-words text-muted-foreground">
                        Realisasi: {c.entry.realization}
                      </span>
                    )}
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {c.targetName ? (
                        <span className="min-w-0 break-words text-muted-foreground">RHK: {c.targetName}</span>
                      ) : (
                        <span className="text-warning">RHK tidak ada di SKP bulan ini — pilih setelah disalin</span>
                      )}
                      {c.exists && <Badge variant="secondary">sudah ada</Badge>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter className="shrink-0">
        {selectable.length > 0 && (
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => setPicked(picked.length === selectable.length ? [] : selectable.map((c) => c.entry.id))}
          >
            {picked.length === selectable.length ? "Kosongkan pilihan" : "Pilih semua"}
          </Button>
        )}
        <Button variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button disabled={!picked.some((id) => selectable.some((c) => c.entry.id === id))} onClick={copy}>
          <CopyPlus /> Salin ({selectable.filter((c) => picked.includes(c.entry.id)).length})
        </Button>
      </DialogFooter>
    </>
  );
}
