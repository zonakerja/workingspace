import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestsApi } from "@/lib/api/endpoints";
import { useMemo } from "react";
import { requestCategoriesApi } from "@/lib/api/endpoints";
import type { RequestCategory, RequestCategoryInput, RequestDetail, RequestUpdate } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Semua pengajuan milik user (disaring per tab di frontend; jumlahnya kecil). */
export function useRequests() {
  return useQuery({ queryKey: [...queryKeys.requests, "list"], queryFn: () => requestsApi.list() });
}

/** Detail pengajuan; dipantau berkala selama berkas pemohon masih dibaca server. */
export function useRequest(id: string | null) {
  return useQuery({
    queryKey: queryKeys.request(id ?? "-"),
    queryFn: () => requestsApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.files.some((f) => f.extraction === "pending" || f.extraction === "extracting") ? 2_000 : false,
  });
}

/** Kategori pengajuan milik pemilik + pembaca label (kunci tak dikenal = kunci itu sendiri). */
export function useRequestCategories() {
  const query = useQuery({ queryKey: queryKeys.requestCategories, queryFn: requestCategoriesApi.list });
  const categories = useMemo(() => query.data ?? [], [query.data]);
  const labels = useMemo(() => new Map(categories.map((c) => [c.key, c.label])), [categories]);
  return {
    ...query,
    categories,
    /** Kategori yang bisa dipilih untuk pengajuan (tidak diarsipkan) */
    active: categories.filter((c) => !c.archived),
    labelOf: (key: string) => labels.get(key) ?? key,
    labels,
  };
}

export function useRequestCategoryMutations() {
  const client = useQueryClient();
  const onSuccess = (rows: RequestCategory[]) => client.setQueryData(queryKeys.requestCategories, rows);
  return {
    create: useMutation({ mutationFn: requestCategoriesApi.create, onSuccess }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: RequestCategoryInput }) =>
        requestCategoriesApi.update(id, input),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: requestCategoriesApi.remove, onSuccess }),
  };
}

export function useRequestTemplateFields(templateId: string | null) {
  return useQuery({
    queryKey: queryKeys.requestTemplateFields(templateId ?? "-"),
    queryFn: () => requestsApi.templateFields(templateId!),
    enabled: !!templateId,
  });
}

/** Detail baru dari server → pasang ke cache detail + muat ulang daftar. */
function useApplyRequest() {
  const client = useQueryClient();
  return (request: RequestDetail) => {
    client.setQueryData(queryKeys.request(request.id), request);
    void client.invalidateQueries({ queryKey: [...queryKeys.requests, "list"] });
  };
}

export function useRequestMutations() {
  const client = useQueryClient();
  const apply = useApplyRequest();
  return {
    create: useMutation({ mutationFn: requestsApi.create, onSuccess: apply }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: RequestUpdate }) => requestsApi.update(id, input),
      onSuccess: apply,
    }),
    remove: useMutation({
      mutationFn: requestsApi.remove,
      onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.requests }),
    }),
    analyze: useMutation({ mutationFn: requestsApi.analyze, onSuccess: (r) => apply(r.request) }),
    reclassify: useMutation({ mutationFn: requestsApi.reclassify, onSuccess: apply }),
    checkItem: useMutation({
      mutationFn: ({
        id,
        itemId,
        ...input
      }: {
        id: string;
        itemId: string;
        result: "lolos" | "bermasalah" | null;
        note?: string;
      }) => requestsApi.checkItem(id, itemId, input),
      onSuccess: apply,
    }),
    review: useMutation({ mutationFn: requestsApi.review, onSuccess: (r) => apply(r.request) }),
    suggestValues: useMutation({
      mutationFn: ({ id, templateId }: { id: string; templateId: string }) => requestsApi.suggestValues(id, templateId),
    }),
    createDocument: useMutation({
      mutationFn: ({
        id,
        ...input
      }: {
        id: string;
        templateId: string;
        values: Record<string, string>;
        name?: string;
      }) => requestsApi.createDocument(id, input),
      onSuccess: (r) => apply(r.request),
    }),
    removeDocument: useMutation({
      mutationFn: ({ id, uploadId }: { id: string; uploadId: string }) => requestsApi.removeDocument(id, uploadId),
      onSuccess: apply,
    }),
  };
}
