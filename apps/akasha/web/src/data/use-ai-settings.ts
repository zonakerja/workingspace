import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/data/query-keys";

/** Status AI akun: model per tugas di Akai dan sakelar indeks pengetahuan. */
export function useAiSettings() {
  return useQuery({ queryKey: queryKeys.aiSettings, queryFn: aiApi.settings, refetchOnMount: "always" });
}

/** Sakelar indeks pengetahuan (RAG). */
export function useUpdateAiSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: aiApi.update,
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.aiSettings, settings);
      void client.invalidateQueries({ queryKey: queryKeys.aiIndex });
    },
  });
}

/** Status indeks pengetahuan; diperbarui tiap 5 detik selama masih ada job indeks berjalan. */
export function useAiIndexStatus() {
  return useQuery({
    queryKey: queryKeys.aiIndex,
    queryFn: aiApi.indexStatus,
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.data?.pendingJobs ? 5000 : false),
  });
}

export function useRebuildAiIndex() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: aiApi.rebuildIndex,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.aiIndex }),
  });
}

export function useSearchAiIndex() {
  return useMutation({ mutationFn: (q: string) => aiApi.searchIndex(q) });
}
