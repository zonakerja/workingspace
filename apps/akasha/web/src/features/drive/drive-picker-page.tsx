import { HardDrive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSearchParam } from "@/hooks/use-search-param";
import { errorMessage } from "@/lib/api/client";
import { driveApi } from "@/lib/api/endpoints";
import { pickGoogleFile } from "./google-picker";
import { PICKER_MESSAGE, type PickerMessage } from "./drive-utils";

/**
 * Jendela kecil berisi Google Picker (`/drive-picker?account=&request=`), dibuka tombol "Dari Drive". Picker tidak bisa dipakai di dalam
 * modal aplikasi (modal mengunci fokus & klik), jadi dibuka di jendela sendiri; ID berkas terpilih dikirim kembali ke jendela pembuka
 * lewat postMessage (asal yang sama saja), lalu jendela ditutup.
 */
export function Component() {
  const [account] = useSearchParam("account");
  const [request] = useSearchParam("request");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !account || !request) return;
    started.current = true;
    const send = (fileId: string | null, err?: string) => {
      const msg: PickerMessage = { type: PICKER_MESSAGE, request, fileId, error: err };
      window.opener?.postMessage(msg, window.location.origin);
    };
    void (async () => {
      try {
        const fileId = await pickGoogleFile(await driveApi.picker(account));
        send(fileId);
        window.close();
      } catch (e) {
        setError(errorMessage(e));
        send(null, errorMessage(e));
      }
    })();
  }, [account, request]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6 text-sm">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <HardDrive className="size-8 text-muted-foreground" />
        {error ? (
          <>
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => window.close()}>
              Tutup
            </Button>
          </>
        ) : !account || !request ? (
          <p className="text-muted-foreground">Buka jendela ini dari tombol "Dari Drive" di form Akasha.</p>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Membuka Google Drive…
          </p>
        )}
      </div>
    </div>
  );
}
