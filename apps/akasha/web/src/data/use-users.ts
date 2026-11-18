import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/endpoints";
import { queryKeys } from "@/data/query-keys";
import { isAdminRole, useAuthStore } from "@/stores/auth-store";

export function useUsers() {
  const role = useAuthStore((s) => s.user?.role);
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: usersApi.list,
    enabled: isAdminRole(role),
  });
}

/** Akun dibuat & diubah di SSO workingspace.id; di Akasha hanya hapus akun beserta datanya. */
export function useUserMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.users });
  return {
    remove: useMutation({ mutationFn: (id: string) => usersApi.remove(id), onSuccess: invalidate }),
  };
}
