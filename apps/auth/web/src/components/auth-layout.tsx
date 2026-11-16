import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Wordmark } from "@workingspace/ui/brand";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";

const POINTS = ["Satu akun untuk semua aplikasi", "PIN keamanan bersama", "Keluar sekali, keluar di mana-mana"];

/** Kerangka halaman masuk / daftar SSO: panel aurora identitas ekosistem + kartu isi. */
export function AuthLayout({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-aurora-soft p-4 sm:p-8">
      <div
        className={`grid w-full overflow-hidden rounded-[28px] border bg-card shadow-lift ${wide ? "max-w-5xl md:grid-cols-[0.8fr_1.4fr]" : "max-w-4xl md:grid-cols-[1fr_1.1fr]"}`}
      >
        <section className="relative flex flex-col justify-between gap-10 overflow-hidden bg-aurora p-8 text-ink-foreground md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-grid" />
          <div className="pointer-events-none absolute -right-16 -bottom-24 size-72 rounded-full bg-lime/20 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3">
            <Wordmark subtitle="Single sign on" />
            <ThemeToggle onDark />
          </div>
          <div className="relative">
            <p className="font-display text-2xl leading-tight font-bold md:text-3xl">
              Satu akun untuk <span className="text-gradient">semua ruang kerja</span> Anda.
            </p>
            <ul className="mt-6 hidden flex-col gap-2.5 md:flex">
              {POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2.5 text-sm opacity-85">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs font-medium opacity-60">© 2026 workingspace.id</p>
        </section>
        <section className="flex min-w-0 flex-col justify-center p-6 sm:p-8 md:p-12">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">{title}</h1>
            {description && <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>}
          </div>
          {children}
        </section>
      </div>
    </div>
  );
}

/** Kotak pesan di dalam kartu (galat / berhasil / info). */
export function Notice({ tone, children }: { tone: "error" | "success" | "info"; children: ReactNode }) {
  const style =
    tone === "error"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "success"
        ? "border-success/30 bg-success/10 text-success"
        : "border-info/30 bg-info/10 text-info";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2.5 text-sm ${style}`}>
      {children}
    </div>
  );
}
