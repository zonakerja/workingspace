import { useId } from "react";
import { cn } from "cn";

/** Tanda Workingspace: dua blok bertumpuk (ruang kerja) di atas gradien aurora. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--brand-indigo, #5b55f0)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--brand-cyan, #3cc4e2)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-lime, #c3f05a)" }} />
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

/**
 * Tanda Akasha AI (Akai): monogram "A" — dua garis tebal yang bertemu di puncak membulat (gerbang langit, *akasha*) — dengan titik
 * lime (percikan percakapan), di atas kotak tinta. Sengaja tanpa bintang berujung empat & tanpa gradien biru penuh agar tidak
 * menyerupai logo asisten AI lain. Salinan favicon Akai web: apps/akai/web/public/favicon.svg (ubah keduanya bersamaan).
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
          <stop offset="0" style={{ stopColor: "var(--brand-indigo, #5b55f0)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--brand-cyan, #3cc4e2)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-lime, #c3f05a)" }} />
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
      <circle cx="20" cy="24.2" r="3.1" style={{ fill: "var(--brand-lime, #c3f05a)" }} />
    </svg>
  );
}

/** Tanda Akasha: kisi 2×2 di atas gradien indigo → sian, satu sel lime — "Where Ideas Find Their Place". */
export function AkashaMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--brand-indigo, #5b55f0)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-cyan, #3cc4e2)" }} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-bg)`} />
      <rect x="9.5" y="9.5" width="9.5" height="9.5" rx="2.8" fill="white" fillOpacity="0.95" />
      <rect x="21" y="9.5" width="9.5" height="9.5" rx="2.8" fill="white" fillOpacity="0.45" />
      <rect x="9.5" y="21" width="9.5" height="9.5" rx="2.8" fill="white" fillOpacity="0.45" />
      <rect x="21" y="21" width="9.5" height="9.5" rx="2.8" style={{ fill: "var(--brand-lime, #c3f05a)" }} />
    </svg>
  );
}

/** Tanda Cendekia: dua chevron naik (bertumbuh) dengan titik lime di puncak, di atas gradien coral → indigo. */
export function CendekiaMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="40" x2="40" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--brand-coral, #f08c6c)" }} />
          <stop offset="1" style={{ stopColor: "var(--brand-indigo, #5b55f0)" }} />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${id}-bg)`} />
      <path
        d="M11 29 20 21l9 8M11 22.5 20 14.5l9 8"
        fill="none"
        stroke="white"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.95"
      />
      <circle cx="20" cy="9.5" r="2.6" style={{ fill: "var(--brand-lime, #c3f05a)" }} />
    </svg>
  );
}

/** Tanda produk menurut kunci aplikasi SSO; kunci lain = huruf awal di atas aurora. */
export function ProductMark({ appKey, name, className }: { appKey: string; name?: string; className?: string }) {
  if (appKey === "akasha") return <AkashaMark className={className} />;
  if (appKey === "akai") return <AkaiMark className={className} />;
  if (appKey === "cendekia") return <CendekiaMark className={className} />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-display flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-aurora text-base font-bold text-white",
        className,
      )}
    >
      {(name ?? appKey).slice(0, 1).toUpperCase()}
    </span>
  );
}
