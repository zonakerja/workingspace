import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { aiApi } from "@/lib/api/endpoints";
import type { SmartSearchMode } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Pencarian Pintar (Ctrl+K): kosong / < 2 huruf = tidak mencari. Hasil sebelumnya tetap tampil selama memuat. */
export function useSmartSearch(query: string, mode: SmartSearchMode) {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.smartSearch(q, mode),
    queryFn: () => aiApi.smartSearch(q, mode),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
