import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "cn";
import { type ThemePreference, setTheme, useTheme } from "./theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "system", label: "Ikuti sistem", icon: Monitor },
];

/** Pengatur tema tiga pilihan (Terang / Gelap / Ikuti sistem). `onDark` = di atas panel aurora. */
export function ThemeToggle({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  const theme = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Tema tampilan"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full p-0.5 ring-1",
        onDark ? "bg-white/10 ring-white/15" : "bg-muted ring-border",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-colors",
              active
                ? onDark
                  ? "bg-white text-ink"
                  : "bg-card text-foreground shadow-soft"
                : onDark
                  ? "text-white/70 hover:text-white"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
