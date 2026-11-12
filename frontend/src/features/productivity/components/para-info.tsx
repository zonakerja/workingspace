import { ChevronDown, type LucideIcon } from "lucide-react";

/**
 * Penjelasan kategori PARA: satu baris ringkas (judul + awal penjelasan); klik untuk membaca utuh.
 * Sengaja tidak memakan tinggi agar daftar di bawahnya langsung terlihat.
 */
export function ParaInfo({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <details className="group rounded-xl border border-module/20 bg-module-soft px-3 py-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden">
        <Icon className="size-4 shrink-0 text-module" />
        <span className="shrink-0 font-bold">{title}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground group-open:invisible">{description}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <p className="pt-1 pb-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </details>
  );
}
