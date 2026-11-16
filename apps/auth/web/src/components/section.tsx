import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Kartu bagian halaman akun & admin: label kecil, judul display, aksi di kanan. */
export function Section({
  id,
  icon,
  eyebrow,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 rounded-3xl border bg-card p-5 shadow-soft sm:p-6", className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-linear-135 from-indigo/15 to-cyan/15 text-primary ring-1 ring-primary/15 [&_svg]:size-[18px]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{eyebrow}</p>
            )}
            <h2 className="text-lg leading-tight font-bold">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Pil status kecil berwarna (aktif, belum verifikasi, nonaktif, …). */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: "success" | "warning" | "danger" | "info" | "brand" | "muted";
  children: ReactNode;
  className?: string;
}) {
  const style = {
    success: "bg-success/12 text-success ring-success/25",
    warning: "bg-warning/15 text-warning-foreground ring-warning/35 dark:text-warning",
    danger: "bg-destructive/12 text-destructive ring-destructive/25",
    info: "bg-info/12 text-info ring-info/25",
    brand: "bg-primary/12 text-primary ring-primary/25",
    muted: "bg-muted text-muted-foreground ring-border",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 [&_svg]:size-3",
        style,
        className,
      )}
    >
      {children}
    </span>
  );
}
