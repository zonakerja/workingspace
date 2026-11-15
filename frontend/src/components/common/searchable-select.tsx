import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Teks kecil di bawah label */
  hint?: string;
}

export interface OptionGroup {
  heading?: string;
  options: SelectOption[];
}

interface SearchableSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  /** Alternatif `options` dengan pengelompokan */
  groups?: OptionGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** Nilai terpilih yang panjang ditampilkan utuh (beberapa baris) di tombol, bukan dipotong "…" */
  wrap?: boolean;
}

/** Dropdown dengan pencarian (combobox). */
export function SearchableSelect({
  value,
  onChange,
  options,
  groups,
  placeholder = "Pilih...",
  searchPlaceholder = "Cari...",
  emptyText = "Tidak ditemukan.",
  className,
  disabled,
  id,
  wrap,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const allGroups: OptionGroup[] = groups ?? [{ options: options ?? [] }];
  const selected = allGroups.flatMap((g) => g.options).find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          title={selected?.label}
          className={cn(
            "w-full justify-between font-normal",
            wrap && "h-auto min-h-9 rounded-xl py-1.5 text-left whitespace-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className={wrap ? "min-w-0 break-words" : "truncate"}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) max-w-[calc(100vw-1rem)] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {allGroups.map((group, index) =>
              group.options.length === 0 ? null : (
                <CommandGroup key={group.heading ?? index} heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={`${option.label} ${option.value}`}
                      onSelect={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      {/* Teks panjang (nama unit, jabatan) dibungkus ke baris berikutnya, tidak dipotong */}
                      <div
                        className="min-w-0 flex-1"
                        title={option.hint ? `${option.label} — ${option.hint}` : option.label}
                      >
                        <p className="break-words whitespace-normal">{option.label}</p>
                        {option.hint && (
                          <p className="text-xs break-words whitespace-normal text-muted-foreground">{option.hint}</p>
                        )}
                      </div>
                      <Check className={cn("ml-auto", option.value === value ? "opacity-100" : "opacity-0")} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
