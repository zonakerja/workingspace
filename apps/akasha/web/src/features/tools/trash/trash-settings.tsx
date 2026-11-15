import { Bot, RotateCcw, Trash2, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageLoader } from "@/components/common/page-loader";
import { PaginationControl } from "@/components/common/pagination-control";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTrash, useTrashActions } from "@/data/use-trash";
import { useToday } from "@/hooks/use-today";
import { usePagination } from "@/hooks/use-pagination";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { daysLeft, filterTrash, groupTrash, itemLabel, type TrashGroup } from "./trash-utils";

type Pending = { kind: "group"; group: TrashGroup } | { kind: "item"; id: string; title: string } | { kind: "all" };

/**
 * Sampah: semua yang dihapus (oleh Anda maupun agen atas persetujuan Anda) bisa dipulihkan selama 30 hari, lalu
 * dihapus permanen otomatis. Item yang dihapus bersamaan dipulihkan bersama.
 */
export function TrashSettings() {
  const { data, isLoading } = useTrash();
  const { restore, purge } = useTrashActions();
  const today = useToday();
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const groups = groupTrash(filterTrash(data ?? [], query));
  const { pageItems, setPage, controlProps } = usePagination(groups, 10);

  const runRestore = (selector: { ids?: string[]; batchId?: string }) =>
    restore.mutate(selector, {
      onSuccess: (r) => {
        if (r.restored.length) toast.success(`${r.restored.length} item dipulihkan.`);
        for (const f of r.failed) toast.error(`${f.title}: ${f.message}`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const runPurge = () => {
    if (!confirm) return;
    const selector =
      confirm.kind === "all"
        ? { all: true }
        : confirm.kind === "group"
          ? { batchId: confirm.group.batchId }
          : { ids: [confirm.id] };
    purge.mutate(selector, {
      onSuccess: (r) => toast.success(`${r.purged} item dihapus permanen.`),
      onError: (e) => toast.error(errorMessage(e)),
    });
    setConfirm(null);
  };

  if (isLoading) return <PageLoader />;
  const total = data?.length ?? 0;

  return (
    <SectionCard
      icon={Trash2}
      title="Sampah"
      description="Yang Anda hapus, dan yang dihapus agen setelah Anda setujui, bisa dipulihkan selama 30 hari. Setelah itu dihapus permanen otomatis."
      action={
        total > 0 && (
          <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: "all" })}>
            <Trash2 /> Kosongkan
          </Button>
        )
      }
      contentClassName="grid grid-cols-1 gap-3"
    >
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sampah kosong.</p>
      ) : (
        <>
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="Cari judul atau jenis…"
          />
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada yang cocok.</p>
          )}
          <ul className="grid grid-cols-1 gap-2">
            {pageItems.map((group) => (
              <li key={group.batchId} className="min-w-0 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Dihapus {formatDateTime(group.deletedAt)}</span>
                  <Badge variant="secondary" className="gap-1">
                    {group.source === "agent" ? <Bot className="size-3" /> : <User className="size-3" />}
                    {group.source === "agent" ? "Agen (disetujui)" : "Anda"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {daysLeft(group.expiresAt, today)} hari lagi dihapus permanen
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={restore.isPending}
                      onClick={() => runRestore({ batchId: group.batchId })}
                    >
                      <RotateCcw /> {group.items.length > 1 ? `Pulihkan semua (${group.items.length})` : "Pulihkan"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Hapus permanen"
                      onClick={() => setConfirm({ kind: "group", group })}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </div>
                <ul className="mt-2 grid grid-cols-1 gap-1">
                  {group.items.map((item) => (
                    <li key={item.id} className="group flex min-w-0 items-center gap-2 text-sm">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {itemLabel(item)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {group.items.length > 1 && (
                        <span className="flex shrink-0 gap-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={restore.isPending}
                            onClick={() => runRestore({ ids: [item.id] })}
                          >
                            <RotateCcw /> Pulihkan
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label="Hapus permanen"
                            onClick={() => setConfirm({ kind: "item", id: item.id, title: item.title })}
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <PaginationControl {...controlProps} />
        </>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        onConfirm={runPurge}
        title={confirm?.kind === "all" ? "Kosongkan Sampah?" : "Hapus permanen?"}
        description="Tindakan ini tidak bisa dibatalkan. Data dan berkasnya dihapus selamanya."
        itemName={
          confirm?.kind === "all"
            ? `${total} item`
            : confirm?.kind === "group"
              ? `${confirm.group.items.length} item yang dihapus bersamaan`
              : confirm?.kind === "item"
                ? confirm.title
                : undefined
        }
        confirmLabel="Hapus permanen"
      />
    </SectionCard>
  );
}
