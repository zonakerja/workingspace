import { AkaiMark } from "@workingspace/ui/brand";

/** Tanda Akasha AI (Akai) — satu sumber di packages/ui (dipakai juga halaman depan & dashboard SSO). */
export { AkaiMark };

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
