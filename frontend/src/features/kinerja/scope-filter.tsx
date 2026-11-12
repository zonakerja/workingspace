import { ListFilter, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAreas, useProjects } from "@/data/collections";
import { useRenaksiScope } from "@/data/use-robot";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { type RenaksiCandidate, type ScopeOption, scopeOptions, scopeSummary } from "./lib/renaksi-candidates";

/**
 * Filter cakupan kegiatan renaksi (pilih banyak): Area, Project, dan kegiatan Lepas. Yang dilepas centangnya
 * dikecualikan — tidak tampil di daftar dan tidak ditawarkan ke agen saat menyusun usulan. Disimpan per akun.
 * `candidates` = semua kegiatan bulan ini sebelum disaring (untuk jumlah per cakupan).
 */
export function ScopeFilter({ candidates }: { candidates: RenaksiCandidate[] }) {
  const { items: areas } = useAreas();
  const { items: projects } = useProjects();
  const { excluded, save } = useRenaksiScope();
  const options = scopeOptions(areas, projects, candidates);

  const setExcluded = (next: string[]) => save.mutate(next, { onError: (e) => toast.error(errorMessage(e)) });
  const toggle = (key: string, include: boolean) =>
    setExcluded(include ? excluded.filter((k) => k !== key) : [...new Set([...excluded, key])]);

  const row = (option: ScopeOption) => {
    // Area dikecualikan → project di dalamnya ikut dikecualikan
    const viaArea = !!option.areaKey && excluded.includes(option.areaKey);
    const included = !viaArea && !excluded.includes(option.key);
    return (
      <label
        key={option.key}
        className={cn(
          "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60",
          viaArea && "opacity-50",
        )}
      >
        <Checkbox
          className="mt-0.5"
          checked={included}
          disabled={viaArea || save.isPending}
          onCheckedChange={(v) => toggle(option.key, v === true)}
        />
        <span className="min-w-0 flex-1">
          <span className="break-words">{option.label}</span>
          {option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}
        </span>
        {option.count > 0 && <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>}
      </label>
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={excluded.length ? "secondary" : "outline"}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <ListFilter />} {scopeSummary(excluded)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-80 flex-col gap-2 p-2"
      >
        <div className="shrink-0 px-2 pt-1">
          <p className="text-sm font-semibold">Cakupan kegiatan</p>
          <p className="text-xs text-muted-foreground">
            Lepas centang Area / Project yang tidak masuk e-Kinerja (mis. pribadi, titipan). Berlaku juga saat membuat
            usulan otomatis. Angka = kegiatan bulan ini.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {options.areas.length > 0 && (
            <>
              <p className="px-2 pt-1 text-xs font-semibold text-muted-foreground">Area</p>
              {options.areas.map(row)}
            </>
          )}
          {options.projects.length > 0 && (
            <>
              <p className="px-2 pt-2 text-xs font-semibold text-muted-foreground">Project</p>
              {options.projects.map(row)}
            </>
          )}
          <p className="px-2 pt-2 text-xs font-semibold text-muted-foreground">Lainnya</p>
          {row(options.loose)}
        </div>
        <div className="flex shrink-0 justify-between gap-2 border-t px-1 pt-2">
          <Button size="xs" variant="ghost" disabled={!excluded.length} onClick={() => setExcluded([])}>
            Sertakan semua
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setExcluded([...options.areas, ...options.projects, options.loose].map((o) => o.key))}
          >
            Kecualikan semua
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
