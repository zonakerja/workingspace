import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_MODELS_PER_TASK, TASK_HINT, modelFitsTask, moveItem } from "@/lib/akai-logic";
import { type TaskRoute, api } from "@/lib/api";
import { type SettingsData, attempt } from "@/lib/use-settings";

/** Tab Pembagian tugas: per tugas model utama + cadangan berurutan (maks. 5). Perubahan langsung disimpan. */
export function TasksTab({ data, reload }: { data: SettingsData; reload: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Model pertama dipakai lebih dulu. Bila kuota habis, saldo kurang, atau sumber sibuk, Akai mencoba cadangan
        berikutnya secara berurutan. Key ditolak / model tidak ada tidak dialihkan (galatnya terlihat).
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data.tasks.map((route) => (
          <TaskCard key={route.task} route={route} data={data} reload={reload} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ route, data, reload }: { route: TaskRoute; data: SettingsData; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const byId = new Map(data.models.map((m) => [m.id, m]));
  const options = data.models.filter((m) => modelFitsTask(route.task, m) && !route.modelIds.includes(m.id));

  async function save(modelIds: string[]) {
    setSaving(true);
    await attempt(() => api.setTask(route.task, modelIds));
    await reload();
    setSaving(false);
  }

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 shadow-soft" aria-busy={saving}>
      <div>
        <h3 className="font-semibold">{route.label}</h3>
        <p className="text-xs text-muted-foreground">{TASK_HINT[route.task]}</p>
      </div>
      {route.modelIds.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground">Belum ada model.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {route.modelIds.map((id, index) => {
            const model = byId.get(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-xl border px-3 py-2">
                <Badge variant={index === 0 ? "default" : "outline"} className="shrink-0">
                  {index === 0 ? "Utama" : `Cadangan ${index}`}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{model?.label ?? "Model tidak ada"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{model?.source.label}</span>
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={saving || index === 0}
                  onClick={() => save(moveItem(route.modelIds, index, -1))}
                  aria-label="Naikkan"
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={saving || index === route.modelIds.length - 1}
                  onClick={() => save(moveItem(route.modelIds, index, 1))}
                  aria-label="Turunkan"
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => save(route.modelIds.filter((x) => x !== id))}
                  aria-label="Lepas"
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      {route.modelIds.length < MAX_MODELS_PER_TASK && (
        <Select
          value=""
          onValueChange={(id) => save([...route.modelIds, id])}
          disabled={saving || options.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                options.length === 0
                  ? "Tidak ada model yang cocok (nyalakan di tab Model)"
                  : route.modelIds.length === 0
                    ? "Pilih model utama…"
                    : "Tambah cadangan…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label} · {m.source.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </article>
  );
}
