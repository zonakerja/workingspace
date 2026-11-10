import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trashApi } from "@/lib/api/endpoints";
import { queryKeys } from "./query-keys";

export function useTrash() {
  return useQuery({ queryKey: queryKeys.trash, queryFn: trashApi.list });
}

/** Pulihkan / hapus permanen; data modul & daftar berkas dimuat ulang agar item yang kembali langsung terlihat. */
export function useTrashActions() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.trash });
    void client.invalidateQueries({ queryKey: ["records"] });
    void client.invalidateQueries({ queryKey: queryKeys.uploads });
  };
  return {
    restore: useMutation({ mutationFn: trashApi.restore, onSuccess: refresh }),
    purge: useMutation({ mutationFn: trashApi.purge, onSuccess: refresh }),
  };
}
