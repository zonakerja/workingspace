import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

/** Kerangka halaman SSO: panel identitas ekosistem + kartu isi. */
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
    <div className="flex min-h-svh items-center justify-center bg-background p-4 sm:p-8">
      <div
        className={`grid w-full overflow-hidden rounded-3xl border bg-card shadow-2xl shadow-primary/10 ${wide ? "max-w-5xl md:grid-cols-[0.8fr_1.4fr]" : "max-w-4xl md:grid-cols-[1fr_1.1fr]"}`}
      >
        <section
          data-module="overview"
          className="relative flex flex-col justify-between gap-8 overflow-hidden bg-module-gradient p-8 text-white md:p-10"
        >
          <div className="pointer-events-none absolute inset-0 bg-dots opacity-70" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-white/15 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-lg">
              <ShieldCheck className="size-7" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-2xl font-extrabold tracking-wider">WORKINGSPACE</p>
              <p className="mt-0.5 text-xs font-bold tracking-widest text-white/80 uppercase">Akun ekosistem</p>
            </div>
          </div>
          <p className="relative text-xl leading-snug font-bold md:text-2xl">
            Satu akun untuk Akasha dan aplikasi workingspace.id lainnya.
          </p>
          <p className="relative text-xs font-medium text-white/75">© 2026 workingspace.id</p>
        </section>
        <section className="flex min-w-0 flex-col justify-center p-6 sm:p-8 md:p-12">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
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
