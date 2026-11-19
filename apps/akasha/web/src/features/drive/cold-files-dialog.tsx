import { ArchiveRestore, Loader2, Snowflake } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SearchInput } from "@/components/common/search-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useColdFiles, useRestoreColdFile } from "@/data/use-drive";
import { matchesWords, queryWords } from "@/features/planner/lib/planner-search";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { formatSize, PROVIDER_DRIVE_LABEL } from "./drive-utils";

/** Daftar berkas yang sedang di arsip dingin + Kembalikan per berkas (tanpa menunggu dibuka). */
export function ColdFilesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data = [], isLoading } = useColdFiles(open);
  const restore = useRestoreColdFile();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const words = queryWords(query);
  const shown = words.length ? data.filter((f) => matchesWords(words, f.name, f.account)) : data;

  const restoreOne = (id: string, name: string) => {
    setPending(id);
    restore.mutate(id, {
      onSuccess: () => toast.success(`"${name}" dikembalikan ke server.`),
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => setPending(null),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[85svh] grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Snowflake className="size-4 text-module" /> Berkas di arsip dingin
          </DialogTitle>
          <DialogDescription>
            Berkas ini tersimpan di Drive Anda dan diambil kembali otomatis saat dibuka. Kembalikan sekarang bila ingin
            berkasnya ada di server lagi (mis. sebelum memutuskan akun Drive).
          </DialogDescription>
        </DialogHeader>
        {data.length > 8 && (
          <SearchInput value={query} onChange={setQuery} placeholder="Cari nama berkas..." className="md:w-full" />
        )}
        <div className="min-h-0 overflow-y-auto">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Memuat…</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {data.length ? "Tidak ada berkas yang cocok." : "Belum ada berkas di arsip dingin."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border">
              {shown.map((file) => (
                <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={file.name}>
                      {file.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatSize(file.size)} · {PROVIDER_DRIVE_LABEL[file.provider]} {file.account} · dipindah{" "}
                      {formatDateTime(file.movedAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => restoreOne(file.id, file.name)}
                  >
                    {pending === file.id ? <Loader2 className="animate-spin" /> : <ArchiveRestore />} Kembalikan
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
