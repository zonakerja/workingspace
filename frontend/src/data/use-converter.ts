import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { converterApi } from "@/lib/api/endpoints";
import type { ConverterMode, ConverterPrefs, ConverterReconvertScope } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Status service converter; dipantau tiap 5 dtk selama model Docling belum siap. */
export function useConverterStatus() {
  return useQuery({
    queryKey: queryKeys.converterStatus,
    queryFn: converterApi.status,
    refetchInterval: (query) => (query.state.data?.reachable && !query.state.data.ready ? 5_000 : false),
  });
}

export function useConverterPrefs() {
  return useQuery({ queryKey: queryKeys.converterPrefs, queryFn: converterApi.preferences });
}

export function useUpdateConverterPrefs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ConverterPrefs>) => converterApi.updatePreferences(input),
    // Optimistis: sakelar langsung berpindah; galat → dikembalikan
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: queryKeys.converterPrefs });
      const previous = client.getQueryData<ConverterPrefs>(queryKeys.converterPrefs);
      if (previous) client.setQueryData(queryKeys.converterPrefs, { ...previous, ...input });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(queryKeys.converterPrefs, context.previous);
    },
    onSuccess: (prefs) => client.setQueryData(queryKeys.converterPrefs, prefs),
  });
}

export function useConverterStats(enabled = true) {
  return useQuery({ queryKey: queryKeys.converterStats, queryFn: converterApi.stats, enabled });
}

export function useConvertFile() {
  return useMutation({
    mutationFn: ({
      file,
      ...options
    }: {
      file: File;
      mode?: ConverterMode;
      pdfMode?: ConverterMode;
      enhance?: boolean;
      compareTokens?: boolean;
    }) => converterApi.convert(file, options),
  });
}

export function useReconvert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scope: ConverterReconvertScope) => converterApi.reconvert(scope),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.converterStats }),
  });
}
