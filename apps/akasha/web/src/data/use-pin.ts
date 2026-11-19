import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { securityApi } from "@/lib/api/endpoints";
import { useAuthStore } from "@/stores/auth-store";
import type { PinStatus } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Status PIN keamanan akun & sesi ini. */
export function usePinStatus() {
  const user = useAuthStore((s) => s.user);
  return useQuery({ queryKey: queryKeys.pinStatus, queryFn: securityApi.status, enabled: !!user, staleTime: 30_000 });
}

/**
 * Setelah status sesi berubah (PIN dibuka / dikunci / diatur), semua data dimuat ulang: item terkunci datang utuh
 * (terbuka) atau kembali sebagai kerangka (terkunci).
 */
function useApplyPinStatus() {
  const client = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  return (status: PinStatus) => {
    client.setQueryData(queryKeys.pinStatus, status);
    if (user && user.hasPin !== status.hasPin) setUser({ ...user, hasPin: status.hasPin });
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.pinStatus[0] });
  };
}

export function useUnlockPin() {
  const apply = useApplyPinStatus();
  return useMutation({ mutationFn: (pin: string) => securityApi.unlock(pin), onSuccess: apply });
}

export function useLockPin() {
  const apply = useApplyPinStatus();
  return useMutation({ mutationFn: () => securityApi.lock(), onSuccess: apply });
}

/** Kunci otomatis PIN (menit tanpa aktivitas; null = sampai logout). */
export function useSetPinAutoLock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (minutes: number | null) => securityApi.setAutoLock(minutes),
    onSuccess: ({ autoLockMinutes }) =>
      client.setQueryData<PinStatus>(queryKeys.pinStatus, (prev) => (prev ? { ...prev, autoLockMinutes } : prev)),
  });
}
