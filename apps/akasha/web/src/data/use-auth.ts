import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { authApi, type ProfileInput } from "@/lib/api/endpoints";
import { isRecordingActive } from "@/lib/recording-guard";
import { flushPendingWrites } from "@/data/use-collection";
import { queryKeys } from "@/data/query-keys";
import { useAuthStore } from "@/stores/auth-store";

/** Konfigurasi masuk SSO; tanpa backend (galat) dianggap SSO belum diatur. */
export function useSsoConfig() {
  return useQuery({
    queryKey: ["auth", "sso-config"],
    queryFn: () => authApi.ssoConfig().catch(() => ({ enabled: false, accountUrl: null })),
    staleTime: 5 * 60_000,
  });
}

export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    // Logout membongkar seluruh halaman: rekaman yang masih di memori tab akan hilang tanpa peringatan
    if (isRecordingActive()) {
      toast.error("Rekaman masih berjalan", { description: "Hentikan dan simpan rekaman dulu sebelum keluar." });
      return;
    }
    await flushPendingWrites();
    const result = await authApi.logout().catch(() => undefined);
    useAuthStore.getState().clear();
    client.clear();
    // Masuk lewat SSO: keluar juga dari akun Workingspace di browser ini (SSO mengembalikan ke /login)
    if (result?.ssoLogoutUrl) window.location.assign(result.ssoLogoutUrl);
    else void navigate("/login", { replace: true });
  };
}

/** Sinkronkan profil user dari server (mis. setelah diubah di perangkat lain). */
export function useProfileSync() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: queryKeys.profile,
    enabled: !!user,
    queryFn: async () => {
      const profile = await authApi.me();
      setUser(profile);
      return profile;
    },
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const setUser = useAuthStore((s) => s.setUser);
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => authApi.updateMe(input),
    onSuccess: (profile) => {
      setUser(profile);
      client.setQueryData(queryKeys.profile, profile);
    },
  });
}
