import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { driveApi } from "@/lib/api/endpoints";
import type { ColdStorageSettings, DriveBackupSettings } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Akun dengan izin Drive (tombol "Dari Drive" di form lampiran & Resource). */
export function useDriveAccounts() {
  return useQuery({ queryKey: queryKeys.driveAccounts, queryFn: driveApi.accounts, staleTime: 60_000 });
}

/** Arsip dingin (Pengaturan → Akun Tersambung). Dipantau tiap 3 dtk selama putaran berjalan. */
export function useColdStorage() {
  return useQuery({
    queryKey: queryKeys.coldStorage,
    queryFn: driveApi.cold,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
}

export function useColdStorageMutations() {
  const client = useQueryClient();
  const set = (data: Awaited<ReturnType<typeof driveApi.cold>>) => client.setQueryData(queryKeys.coldStorage, data);
  return {
    update: useMutation({
      mutationFn: (input: Partial<ColdStorageSettings>) => driveApi.updateCold(input),
      onSuccess: set,
    }),
    run: useMutation({ mutationFn: driveApi.runCold, onSuccess: set }),
    restore: useMutation({ mutationFn: driveApi.restoreCold, onSuccess: set }),
  };
}

/** Berkas di arsip dingin (dialog daftar). */
export function useColdFiles(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.coldFiles, queryFn: driveApi.coldFiles, enabled });
}

export function useRestoreColdFile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: driveApi.restoreColdFile,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.coldFiles });
      void client.invalidateQueries({ queryKey: queryKeys.coldStorage });
    },
  });
}

/** Backup ke Google Drive / OneDrive. Dipantau tiap 3 dtk selama backup berjalan. */
export function useDriveBackup(enabled = true) {
  return useQuery({
    queryKey: queryKeys.driveBackup,
    queryFn: driveApi.backup,
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
}

export function useDriveBackupMutations() {
  const client = useQueryClient();
  const set = (data: Awaited<ReturnType<typeof driveApi.backup>>) => client.setQueryData(queryKeys.driveBackup, data);
  return {
    update: useMutation({
      mutationFn: (input: Partial<DriveBackupSettings>) => driveApi.updateBackup(input),
      onSuccess: set,
    }),
    run: useMutation({ mutationFn: driveApi.runBackup, onSuccess: set }),
  };
}
