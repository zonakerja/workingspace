import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Tanda Akai: monogram "A" — dua garis tebal yang bertemu di puncak membulat (gerbang langit, *akasha*) — dengan titik lime di
 * tengahnya (percikan percakapan), di atas kotak tinta workingspace.id. Sengaja tanpa bintang/percikan berujung empat dan tanpa
 * gradien biru penuh agar tidak menyerupai logo asisten AI lain. Salinan favicon: public/favicon.svg (ubah keduanya bersamaan).
 */
export function AkaiMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1d2350" />
          <stop offset="1" stopColor="#0f1330" />
        </linearGradient>
        <linearGradient id={`${id}-a`} x1="11" y1="31" x2="29" y2="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--brand-indigo)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--brand-cyan)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-lime)" }} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-bg)`} />
      <rect x="0.5" y="0.5" width="39" height="39" rx="10.5" fill="none" stroke="white" strokeOpacity="0.14" />
      <path
        d="M11 30.5 19.1 10.6a1 1 0 0 1 1.8 0L29 30.5"
        fill="none"
        stroke={`url(#${id}-a)`}
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="24.2" r="3.1" style={{ fill: "var(--brand-lime)" }} />
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
