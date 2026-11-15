import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { authApi, type ProfileInput } from "@/lib/api/endpoints";
import { isRecordingActive } from "@/lib/recording-guard";
import { flushPendingWrites } from "@/data/use-collection";
import { queryKeys } from "@/data/query-keys";
import { useAuthStore } from "@/stores/auth-store";
import { markLoginPinPrompt } from "@/features/security/pin-prompt";

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => authApi.login(email.trim(), password),
    onSuccess: (session) => {
      client.clear();
      // Akun ber-PIN: setelah masuk ditawarkan membuka item terkunci dengan PIN atau lanjut tanpa PIN
      if (session.user.hasPin) markLoginPinPrompt();
      setSession(session);
    },
  });
}

/** Cara masuk yang tersedia; tanpa backend (galat) dianggap hanya kata sandi lokal. */
export function useSsoConfig() {
  return useQuery({
    queryKey: ["auth", "sso-config"],
    queryFn: () => authApi.ssoConfig().catch(() => ({ enabled: false, passwordLogin: true, accountUrl: null })),
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

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(currentPassword, newPassword),
  });
}
