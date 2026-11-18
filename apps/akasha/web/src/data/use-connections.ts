import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { connectionsApi, mailApi } from "@/lib/api/endpoints";
import { queryKeys } from "./query-keys";

/** Akun Google / Microsoft (OAuth) + kalender dua arah (Pengaturan → Akun Tersambung). */
export function useConnections() {
  return useQuery({ queryKey: queryKeys.connections, queryFn: connectionsApi.list });
}

export function useConnectionMutations() {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.connections });
  return {
    remove: useMutation({
      mutationFn: connectionsApi.remove,
      onSuccess: () => {
        refresh();
        void client.invalidateQueries({ queryKey: queryKeys.mailAccounts });
      },
    }),
    connectCalendar: useMutation({
      mutationFn: connectionsApi.connectCalendar,
      onSettled: () => {
        refresh();
        void client.invalidateQueries({ queryKey: queryKeys.records("schedule") });
      },
    }),
    toggleCalendar: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => connectionsApi.toggleCalendar(id, enabled),
      onSuccess: refresh,
    }),
    syncCalendar: useMutation({
      mutationFn: connectionsApi.syncCalendar,
      onSettled: () => {
        refresh();
        void client.invalidateQueries({ queryKey: queryKeys.records("schedule") });
      },
    }),
    disconnectCalendar: useMutation({ mutationFn: connectionsApi.disconnectCalendar, onSuccess: refresh }),
    useForMail: useMutation({
      mutationFn: mailApi.createOutlook,
      onSuccess: () => {
        refresh();
        void client.invalidateQueries({ queryKey: queryKeys.mailAccounts });
      },
    }),
  };
}

/** Ringkasan hasil sinkron kalender untuk toast. */
export function syncSummary(r: {
  pulledNew: number;
  pulledUpdated: number;
  pulledRemoved: number;
  pushedNew: number;
  pushedUpdated: number;
  pushedDeleted: number;
}) {
  const parts = [
    r.pushedNew + r.pushedUpdated + r.pushedDeleted && `${r.pushedNew + r.pushedUpdated + r.pushedDeleted} dikirim`,
    r.pulledNew + r.pulledUpdated + r.pulledRemoved && `${r.pulledNew + r.pulledUpdated + r.pulledRemoved} diterima`,
  ].filter(Boolean);
  return parts.length ? `Kalender disinkron: ${parts.join(", ")}.` : "Kalender sudah sama.";
}
