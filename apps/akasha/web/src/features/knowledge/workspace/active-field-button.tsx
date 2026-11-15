import { Check, Layers, Loader2, Plus, Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useKnowledgeActions, useKnowledgePrefs, useKnowledgeTree } from "@/data/use-knowledge-workspace";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { fieldCounts, sameField } from "./knowledge-logic";

/**
 * Bidang aktif: membatasi jawaban chatbot, agen, dan bot WhatsApp ke satu bidang pengetahuan (properti `bidang` catatan),
 * mis. saat pindah tim. Bidang lain tetap tersimpan dan tetap bisa dibuka serta dicari di menu Knowledge.
 */
export function ActiveFieldButton() {
  const { prefs, save } = useKnowledgePrefs();
  const { data: tree } = useKnowledgeTree();
  const { assignField } = useKnowledgeActions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { fields, untagged } = fieldCounts(tree?.notes ?? []);
  const active = prefs.activeField ?? null;
  const known =
    active && !fields.some((f) => sameField(f.name, active)) ? [{ name: active, count: 0 }, ...fields] : fields;

  const choose = (field: string | null) => {
    void save({ ...prefs, activeField: field });
    setOpen(false);
    toast.success(field ? `Bidang aktif: ${field}` : "AI menjawab dari semua bidang");
  };
  const assign = (field: string) =>
    assignField.mutate(field, {
      onSuccess: (r) =>
        toast.success(`${r.notes} catatan ditandai bidang ${field}.`, {
          description: r.failed.length ? `${r.failed.length} catatan dilewati karena propertinya rusak.` : undefined,
        }),
      onError: (e) => toast.error(errorMessage(e)),
    });
  const addNew = () => {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    choose(name);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" title="Bidang pengetahuan yang dipakai AI untuk menjawab">
          <Layers /> Bidang: {active ?? "Semua"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-80 gap-3">
        <div>
          <p className="text-sm font-semibold">Bidang aktif</p>
          <p className="text-xs text-muted-foreground">
            Chatbot, agen, dan bot WhatsApp hanya menjawab dari bidang ini. Bidang lain tetap bisa dibuka dan dicari di
            sini.
          </p>
        </div>
        <div className="grid max-h-48 gap-1 overflow-y-auto">
          <FieldRow label="Semua bidang" selected={!active} onClick={() => choose(null)} />
          {known.map((field) => (
            <FieldRow
              key={field.name}
              label={field.name}
              count={field.count}
              selected={!!active && sameField(field.name, active)}
              onClick={() => choose(field.name)}
            />
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addNew();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Bidang baru, mis. Keuangan"
            maxLength={60}
            aria-label="Nama bidang baru"
          />
          <Button type="submit" size="icon" variant="outline" disabled={!draft.trim()} aria-label="Tambah bidang">
            <Plus />
          </Button>
        </form>
        {untagged > 0 && (
          <div className="grid gap-1.5 rounded-lg bg-muted/50 p-2 text-xs">
            <p>
              <b>{untagged} catatan belum punya bidang</b> dan tetap dipakai di bidang apa pun.
            </p>
            {active ? (
              <Button size="sm" variant="outline" disabled={assignField.isPending} onClick={() => assign(active)}>
                {assignField.isPending ? <Loader2 className="animate-spin" /> : <Tags />} Tandai semuanya: {active}
              </Button>
            ) : (
              <p className="text-muted-foreground">Pilih bidang aktif dulu untuk menandainya sekaligus.</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FieldRow({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
        selected && "bg-module-soft font-semibold text-module",
      )}
    >
      <Check className={cn("size-3.5 shrink-0", !selected && "invisible")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
    </button>
  );
}
