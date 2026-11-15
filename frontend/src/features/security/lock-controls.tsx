import { Lock, LockOpen } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePinStatus } from "@/data/use-pin";
import { cn } from "@/lib/utils";
import { requestUnlock } from "./pin-prompt";

type Lockable = { locked?: boolean; _locked?: boolean; title?: string };

/** Item (induk atau turunan) yang isinya belum terbuka di sesi ini. */
export const isSealed = (item: Lockable | null | undefined) => !!item?._locked;

/**
 * Pastikan isi item terbuka sebelum dipakai (buka editor, pratinjau berkas, dsb.).
 * true = item tidak terkunci atau PIN berhasil dimasukkan.
 */
export async function ensureUnlocked(item: Lockable | null | undefined) {
  if (!isSealed(item)) return true;
  return requestUnlock(item?.title ? `"${item.title}" terkunci.` : undefined);
}

/**
 * Jalankan aksi atas isi item (arsipkan, hapus, pulihkan) hanya bila isinya terbuka. Item terkunci: minta PIN dulu —
 * aksi tidak dijalankan dari kerangka kosong (snapshot arsip / daftar berkas akan kosong). Setelah PIN benar data dimuat
 * ulang utuh dan user mengulang aksinya.
 */
export function withUnlocked(item: Lockable | null | undefined, action: () => void) {
  if (isSealed(item)) void ensureUnlocked(item);
  else action();
}

/**
 * Kunci / lepas kunci item induk. Mengunci butuh PIN yang sudah diatur; melepas kunci item yang belum terbuka meminta
 * PIN otomatis (server menjawab PIN_REQUIRED).
 */
export function useLockToggle() {
  const { data: status } = usePinStatus();
  const navigate = useNavigate();
  return <T extends Lockable>(item: T, save: (next: T) => void) => {
    if (!item.locked && !status?.hasPin) {
      toast.warning("Atur PIN keamanan dulu", {
        description: "Item dikunci dengan PIN 6 angka yang diatur di Profil Saya.",
        action: { label: "Atur PIN", onClick: () => void navigate("/profile#pin") },
      });
      return;
    }
    save({ ...item, locked: !item.locked });
    toast.success(item.locked ? "Kunci dilepas" : "Item dikunci", {
      description: item.locked
        ? undefined
        : "Isinya hanya terbuka setelah PIN dimasukkan. Judul tetap tampil & bisa dicari.",
    });
  };
}

/** Tombol ikon kunci/lepas kunci (untuk pemilik). */
export function LockToggleButton<T extends Lockable>({
  item,
  onSave,
  className,
  size = "icon-sm",
}: {
  item: T;
  onSave: (next: T) => void;
  className?: string;
  size?: "icon-sm" | "icon-xs";
}) {
  const toggle = useLockToggle();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={item.locked ? "Lepas kunci PIN" : "Kunci dengan PIN"}
          className={cn(item.locked && "text-warning", className)}
          onClick={(e) => {
            e.stopPropagation();
            toggle(item, onSave);
          }}
        >
          {item.locked ? <Lock /> : <LockOpen />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{item.locked ? "Terkunci PIN — klik untuk melepas kunci" : "Kunci dengan PIN"}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Dialog form yang dibuka dengan item terkunci (mis. task milik Area terkunci dari Planner): dialog langsung ditutup dan
 * PIN diminta — form tidak boleh mengisi dari kerangka kosong. Setelah PIN benar, buka lagi dari daftar yang sudah utuh.
 */
export function useSealedGuard(item: Lockable | null | undefined, close: () => void) {
  const sealed = isSealed(item);
  const title = item?.title;
  useEffect(() => {
    if (!sealed) return;
    close();
    void requestUnlock(title ? `"${title}" terkunci.` : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dipicu sekali per item terkunci yang dibuka
  }, [sealed, title]);
  return sealed;
}

/** Penanda kecil "Terkunci" di kartu/baris item. */
export function LockedBadge({ item, className }: { item: Lockable; className?: string }) {
  if (!item.locked && !item._locked) return null;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-warning/40 text-warning", className)}
      title={item._locked ? "Terkunci — masukkan PIN untuk membuka isinya" : "Dikunci PIN (sedang terbuka)"}
    >
      {item._locked ? <Lock /> : <LockOpen />} {item._locked ? "Terkunci" : "PIN"}
    </Badge>
  );
}

/** Pengganti isi item yang belum terbuka (dialog/editor yang dibuka langsung lewat tautan). */
export function LockedNotice({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lock />
        </EmptyMedia>
        <EmptyTitle>{title ? `"${title}" terkunci` : "Item terkunci"}</EmptyTitle>
        <EmptyDescription>Masukkan PIN keamanan untuk melihat isi, lampiran, dan rinciannya.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={() => void requestUnlock(title ? `"${title}" terkunci.` : undefined)}>
          <LockOpen /> Buka dengan PIN
        </Button>
        {children}
      </EmptyContent>
    </Empty>
  );
}
