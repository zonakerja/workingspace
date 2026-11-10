import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentActionsApi } from "@/lib/api/endpoints";
import type { AgentActionInfo } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Riwayat aksi agen (dipantau berkala agar permintaan baru dari agen langsung terlihat). */
export function useAgentActions(status?: AgentActionInfo["status"]) {
  return useQuery({
    queryKey: queryKeys.agentActions(status),
    queryFn: () => agentActionsApi.list(status),
    refetchInterval: 30_000,
  });
}

export function usePendingDeleteCount() {
  return useQuery({
    queryKey: queryKeys.agentActionsPending,
    queryFn: agentActionsApi.pendingCount,
    refetchInterval: 60_000,
  });
}

/** Batalkan / setujui / tolak; data modul, Sampah, dan daftar aksi dimuat ulang. */
export function useAgentActionMutations() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["agent-actions"] });
    void client.invalidateQueries({ queryKey: ["records"] });
    void client.invalidateQueries({ queryKey: queryKeys.trash });
  };
  return {
    undo: useMutation({
      mutationFn: ({ id, force }: { id: string; force?: boolean }) => agentActionsApi.undo(id, force),
      onSuccess: refresh,
    }),
    approve: useMutation({ mutationFn: agentActionsApi.approve, onSuccess: refresh }),
    reject: useMutation({
      mutationFn: ({ id, note }: { id: string; note?: string }) => agentActionsApi.reject(id, note),
      onSuccess: refresh,
    }),
  };
}
