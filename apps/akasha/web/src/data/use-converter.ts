import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { converterApi } from "@/lib/api/endpoints";
import type { ConvertedDocumentSummary, ConverterMode, ConverterPrefs, ConverterReconvertScope } from "@/types/api";
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

export function useReconvert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (scope: ConverterReconvertScope) => converterApi.reconvert(scope),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.converterStats }),
  });
}

const isPending = (status: string) => status === "queued" || status === "processing";

/** Pustaka hasil konversi; dipantau tiap 2 dtk selama ada dokumen yang masih diproses. */
export function useConvertedDocuments() {
  return useQuery({
    queryKey: queryKeys.convertedDocuments,
    queryFn: converterApi.documents,
    refetchInterval: (query) => (query.state.data?.some((doc) => isPending(doc.status)) ? 2_000 : false),
  });
}

/** Satu dokumen lengkap (dengan Markdown); dipantau selama belum selesai. */
export function useConvertedDocument(id: string | null) {
  return useQuery({
    queryKey: queryKeys.convertedDocument(id ?? ""),
    queryFn: () => converterApi.document(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data && isPending(query.state.data.status) ? 2_000 : false),
  });
}

export function useCreateConvertedDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, ...options }: { file: File; mode?: ConverterMode; enhance?: boolean }) =>
      converterApi.createDocument(file, options),
    onSuccess: (doc) => {
      if (!doc.reused)
        client.setQueryData<ConvertedDocumentSummary[]>(queryKeys.convertedDocuments, (prev) => [doc, ...(prev ?? [])]);
      void client.invalidateQueries({ queryKey: queryKeys.convertedDocuments });
    },
  });
}

export function useRenameConvertedDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => converterApi.renameDocument(id, title),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.convertedDocuments }),
  });
}

export function useRemoveConvertedDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => converterApi.removeDocument(id),
    onSuccess: (_data, id) => {
      client.setQueryData<ConvertedDocumentSummary[]>(queryKeys.convertedDocuments, (prev) =>
        prev?.filter((doc) => doc.id !== id),
      );
      client.removeQueries({ queryKey: queryKeys.convertedDocument(id) });
    },
  });
}
