import { useId } from "react";
import { cn } from "cn";

/** Tanda Workingspace: dua blok bertumpuk (ruang kerja) di atas gradien aurora. */
export function LogoMark({ className }: { className?: string }) {
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
      <rect x="9" y="9" width="13" height="13" rx="3.5" fill="white" fillOpacity="0.95" />
      <rect x="18" y="18" width="13" height="13" rx="3.5" fill="white" fillOpacity="0.55" />
    </svg>
  );
}

/** Logo + nama: "workingspace" dengan ".id" bergradien. */
export function Wordmark({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <LogoMark />
      <span className="min-w-0">
        <span className="font-display block truncate text-[17px] leading-[1.3] font-bold tracking-tight">
          workingspace<span className="text-gradient">.id</span>
        </span>
        {subtitle && (
          <span className="block truncate text-[11px] leading-[1.4] font-medium tracking-wide opacity-70">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}

const AVATAR_TONES = [
  "from-indigo to-cyan",
  "from-coral to-indigo",
  "from-indigo to-coral",
  "from-indigo via-cyan to-lime",
  "from-coral to-cyan",
  "from-indigo to-indigo/60",
];

/** Inisial nama (maks. 2 huruf). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

/** Indeks warna avatar yang stabil dari teks (id / email). */
export function avatarTone(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % AVATAR_TONES.length;
}

export function UserAvatar({ name, seed, className }: { name: string; seed: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-display flex size-10 shrink-0 items-center justify-center rounded-full bg-linear-135 text-sm font-bold text-white shadow-soft [text-shadow:0_1px_2px_rgb(0_0_0/25%)]",
        AVATAR_TONES[avatarTone(seed)],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
