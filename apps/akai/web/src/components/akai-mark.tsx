import { useId } from "react";
import { cn } from "@/lib/utils";

/** Tanda Akai: percikan (asisten AI) di atas gradien aurora workingspace.id. */
export function AkaiMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--brand-indigo)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--brand-cyan)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-lime)" }} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-bg)`} />
      <path
        d="M20 8c1.2 6.4 5.6 10.8 12 12-6.4 1.2-10.8 5.6-12 12-1.2-6.4-5.6-10.8-12-12 6.4-1.2 10.8-5.6 12-12z"
        fill="white"
        fillOpacity="0.95"
      />
    </svg>
  );
}

/** Logo + nama "Akai" + keterangan kecil. */
export function AkaiWordmark({ subtitle = "workingspace.id" }: { subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <AkaiMark />
      <span className="min-w-0">
        <span className="font-display block truncate text-[17px] leading-[1.3] font-bold tracking-tight">
          Ak<span className="text-gradient">ai</span>
        </span>
        <span className="block truncate text-[11px] leading-[1.4] font-medium tracking-wide opacity-70">
          {subtitle}
        </span>
      </span>
    </span>
  );
}
