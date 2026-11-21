import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRequestCategories } from "@/data/use-requests";
import { cn } from "@/lib/utils";

/** Nilai khusus pilihan "ditentukan otomatis dari kata kunci kategori". */
export const AUTO_CATEGORY = "auto";

/**
 * Pilihan kategori pengajuan dari kategori milik pemilik (yang diarsipkan disembunyikan, kecuali sedang dipakai).
 * `allowAuto` = pilihan otomatis (pengajuan baru), `allLabel` = pilihan "semua" untuk saringan.
 */
export function RequestCategorySelect({
  value,
  onChange,
  allowAuto,
  allLabel,
  disabled,
  className,
  size,
}: {
  value: string;
  onChange: (value: string) => void;
  allowAuto?: boolean;
  allLabel?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
}) {
  const { categories } = useRequestCategories();
  const options = categories.filter((c) => !c.archived || c.key === value);
  const known = value === AUTO_CATEGORY || value === "all" || options.some((c) => c.key === value);
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={cn("w-full", className)} size={size}>
        <SelectValue placeholder="Pilih kategori" />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value="all">{allLabel}</SelectItem>}
        {allowAuto && <SelectItem value={AUTO_CATEGORY}>Otomatis (dari kata kunci kategori)</SelectItem>}
        {options.map((c) => (
          <SelectItem key={c.key} value={c.key}>
            {c.label}
            {c.archived ? " (diarsipkan)" : ""}
          </SelectItem>
        ))}
        {!known && value && <SelectItem value={value}>{value}</SelectItem>}
      </SelectContent>
    </Select>
  );
}
