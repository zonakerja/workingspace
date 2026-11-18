import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronRight, File, Folder, HardDrive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SearchInput } from "@/components/common/search-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useDriveAccounts } from "@/data/use-drive";
import { errorMessage } from "@/lib/api/client";
import { driveApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import type { DriveAccountInfo } from "@/types/api";
import { formatSize, isPickerMessage, PROVIDER_DRIVE_LABEL } from "./drive-utils";

/**
 * Tombol "Dari Drive" di form lampiran & Resource (docs/AKUN-TERSAMBUNG.md tahap 4a): berkas dari Google Drive (jendela Google Picker)
 * atau OneDrive (dijelajahi di sini) diambil server lalu diserahkan ke `onPick` sebagai File, sehingga pemanggil mengunggahnya seperti
 * berkas dari komputer (Ringkas AI, File Control, buang saat batal tetap berlaku). Tidak tampil bila belum ada akun berizin Drive.
 */
export function DriveFilePicker({ disabled, onPick }: { disabled?: boolean; onPick: (file: File) => void }) {
  const { data } = useDriveAccounts();
  const [choose, setChoose] = useState(false);
  const [browse, setBrowse] = useState<DriveAccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const accounts = (data?.accounts ?? []).filter((a) => a.status === "ok");
  if (!accounts.length) return null;

  const fetchFile = async (accountId: string, fileId: string) => {
    setBusy(true);
    try {
      onPick(await driveApi.file(accountId, fileId));
    } catch (error) {
      toast.error("Berkas Drive gagal diambil", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  /** Google: jendela Picker dibuka langsung dari klik (agar tidak diblokir penahan pop-up). */
  const openGooglePicker = (account: DriveAccountInfo) => {
    if (!data?.pickerReady) {
      toast.error("Picker Google belum diatur di server (GOOGLE_PICKER_API_KEY / GOOGLE_PICKER_APP_ID).");
      return;
    }
    cleanup.current?.();
    const request = crypto.randomUUID();
    const win = window.open(
      `/drive-picker?${new URLSearchParams({ account: account.id, request })}`,
      "akasha-drive-picker",
      "width=900,height=680",
    );
    if (!win) {
      toast.error("Jendela Google Drive diblokir browser. Izinkan pop-up untuk Akasha lalu coba lagi.");
      return;
    }
    setBusy(true);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isPickerMessage(event.data, request)) return;
      done();
      if (event.data.error) toast.error(event.data.error);
      else if (event.data.fileId) void fetchFile(account.id, event.data.fileId);
    };
    const timer = window.setInterval(() => win.closed && done(), 800);
    const done = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      cleanup.current = null;
      setBusy(false);
    };
    window.addEventListener("message", onMessage);
    cleanup.current = done;
  };

  const start = (account: DriveAccountInfo) => {
    setChoose(false);
    if (account.provider === "google") openGooglePicker(account);
    else setBrowse(account);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        title="Salin berkas dari Google Drive / OneDrive"
        onClick={() => (accounts.length === 1 ? start(accounts[0]) : setChoose(true))}
      >
        {busy ? <Spinner /> : <HardDrive />} Dari Drive
      </Button>
      <Dialog open={choose} onOpenChange={setChoose}>
        <DialogContent className="grid-cols-1 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pilih Drive</DialogTitle>
            <DialogDescription>Berkas disalin ke Akasha; berkas di Drive tidak berubah.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {accounts.map((a) => (
              <Button key={a.id} variant="outline" className="justify-start" onClick={() => start(a)}>
                <HardDrive /> {PROVIDER_DRIVE_LABEL[a.provider]}{" "}
                <span className="truncate text-muted-foreground">{a.email}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {browse && (
        <OneDriveBrowser
          account={browse}
          maxMb={data?.maxMb ?? 300}
          onClose={() => setBrowse(null)}
          onPick={(fileId) => {
            setBrowse(null);
            void fetchFile(browse.id, fileId);
          }}
        />
      )}
    </>
  );
}

/** Penjelajah OneDrive: folder, naik satu tingkat, cari. */
function OneDriveBrowser({
  account,
  maxMb,
  onClose,
  onPick,
}: {
  account: DriveAccountInfo;
  maxMb: number;
  onClose: () => void;
  onPick: (fileId: string) => void;
}) {
  const [folder, setFolder] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 400);
    return () => window.clearTimeout(t);
  }, [query]);
  const listing = useQuery({
    queryKey: ["drive", "items", account.id, folder ?? "", q],
    queryFn: () => driveApi.items(account.id, q ? { q } : { folder }),
  });
  const items = listing.data?.items ?? [];
  const current = listing.data?.folder;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90svh] grid-cols-1 flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="size-4 text-module" /> OneDrive
          </DialogTitle>
          <DialogDescription>
            {account.email} · berkas disalin ke Akasha (maks. {maxMb} MB), berkas di OneDrive tidak berubah.
          </DialogDescription>
        </DialogHeader>
        <SearchInput value={query} onChange={setQuery} placeholder="Cari di OneDrive…" className="md:w-full" />
        {!q && (
          <div className="flex min-w-0 items-center gap-1 text-sm">
            <Button size="xs" variant="ghost" onClick={() => setFolder(undefined)}>
              OneDrive
            </Button>
            {current && (
              <>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">{current.name}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setFolder(current.parentId ?? undefined)}
                >
                  <ArrowUp /> Naik
                </Button>
              </>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 divide-y overflow-y-auto rounded-xl border">
          {listing.isLoading ? (
            <p className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
              <Spinner /> Memuat…
            </p>
          ) : listing.isError ? (
            <p className="p-4 text-center text-sm text-destructive">{errorMessage(listing.error)}</p>
          ) : !items.length ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {q ? "Tidak ada berkas yang cocok." : "Folder kosong."}
            </p>
          ) : (
            items.map((item) => {
              const tooBig = !item.folder && item.size !== null && item.size > maxMb * 1024 * 1024;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={tooBig}
                  title={tooBig ? `Lebih dari ${maxMb} MB` : undefined}
                  onClick={() => {
                    if (item.folder) {
                      setQuery("");
                      setQ("");
                      setFolder(item.id);
                    } else onPick(item.id);
                  }}
                  className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                >
                  {item.folder ? (
                    <Folder className="size-4 shrink-0 text-warning" />
                  ) : (
                    <File className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[formatSize(item.size), item.modifiedAt && formatDateTime(item.modifiedAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
