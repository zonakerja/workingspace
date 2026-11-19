import { useQuery } from "@tanstack/react-query";
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
