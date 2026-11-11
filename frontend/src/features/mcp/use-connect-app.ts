import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { queryKeys } from "@/data/query-keys";
import { useMcpConnectionMutations } from "@/data/use-mcp-connections";
import { errorMessage } from "@/lib/api/client";
import { mcpConnectionsApi } from "@/lib/api/endpoints";
import type { McpConnectionInfo } from "@/types/api";
import { STATUS_LABEL } from "./mcp-utils";

/** Pantau status setelah jendela izin dibuka: tiap 3 dtk, berhenti saat tersambung/gagal atau setelah 5 menit. */
const POLL_MS = 3_000;
const POLL_LIMIT_MS = 5 * 60_000;

/**
 * Sambungkan satu koneksi. OAuth: jendela izin dibuka saat tombol diklik (agar tidak diblokir penahan pop-up), lalu
 * diarahkan ke halaman izin aplikasi; tab ini memantau status sampai tersambung. Lainnya: langsung diuji.
 */
export function useConnectApp() {
  const m = useMcpConnectionMutations();
  const client = useQueryClient();
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWaitingFor(null);
  };
  // Hentikan pemantauan saat halaman ditinggalkan
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const watch = (connection: McpConnectionInfo) => {
    if (timer.current) clearInterval(timer.current);
    setWaitingFor(connection.id);
    const started = Date.now();
    timer.current = setInterval(() => {
      void mcpConnectionsApi
        .get(connection.id)
        .then((fresh) => {
          if (fresh.status === "connected") {
            toast.success(`${fresh.name} tersambung.`, { description: `${fresh.tools.length} alat tersedia.` });
          } else if (fresh.status === "error") {
            toast.error(fresh.statusMessage ?? "Gagal tersambung.");
          } else if (Date.now() - started < POLL_LIMIT_MS) {
            return;
          }
          stop();
          void client.invalidateQueries({ queryKey: queryKeys.mcpConnections });
        })
        .catch(() => undefined);
    }, POLL_MS);
  };

  /** `opened` = jendela yang sudah dibuka pemanggil saat klik (mis. dialog tambah); selain itu dibuka di sini. */
  const start = (connection: McpConnectionInfo, opened?: Window | null) => {
    const popup =
      opened !== undefined ? opened : connection.authType === "oauth" ? window.open("about:blank", "_blank") : null;
    m.connect.mutate(connection.id, {
      onSuccess: (result) => {
        if (result.authorizationUrl) {
          if (popup) popup.location.href = result.authorizationUrl;
          else window.open(result.authorizationUrl, "_blank");
          watch(connection);
          toast.info("Selesaikan izin di jendela yang terbuka, lalu kembali ke sini.");
          return;
        }
        popup?.close();
        const status = result.connection?.status;
        if (status === "connected") toast.success(`${connection.name} tersambung.`);
        else toast.error(result.connection?.statusMessage ?? (status ? STATUS_LABEL[status] : "Gagal tersambung."));
      },
      onError: (error) => {
        popup?.close();
        toast.error(errorMessage(error));
      },
    });
  };

  return { start, pending: m.connect.isPending, waitingFor };
}
