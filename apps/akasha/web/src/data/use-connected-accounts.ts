import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarFeedApi, mailApi } from "@/lib/api/endpoints";
import type { CalendarFeedStatus, MailAccount, MailAccountInput } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Langganan kalender ICS (Pengaturan → Akun Tersambung). */
export function useCalendarFeed() {
  return useQuery({ queryKey: queryKeys.calendarFeed, queryFn: calendarFeedApi.status });
}

export function useCalendarFeedMutations() {
  const client = useQueryClient();
  const set = (data: CalendarFeedStatus) => client.setQueryData(queryKeys.calendarFeed, data);
  return {
    update: useMutation({ mutationFn: calendarFeedApi.update, onSuccess: set }),
    rotate: useMutation({ mutationFn: calendarFeedApi.rotate, onSuccess: set }),
    remove: useMutation({ mutationFn: calendarFeedApi.remove, onSuccess: set }),
  };
}

export function useMailPresets() {
  return useQuery({ queryKey: queryKeys.mailPresets, queryFn: mailApi.presets, staleTime: Infinity });
}

export function useMailAccounts() {
  return useQuery({ queryKey: queryKeys.mailAccounts, queryFn: mailApi.accounts });
}

export function useMailAccountMutations() {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.mailAccounts });
  const replace = (account: MailAccount) => {
    client.setQueryData<MailAccount[]>(queryKeys.mailAccounts, (prev) =>
      prev?.map((a) => (a.id === account.id ? account : a)),
    );
  };
  return {
    create: useMutation({ mutationFn: mailApi.create, onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: MailAccountInput }) => mailApi.update(id, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: mailApi.remove, onSuccess: refresh }),
    // Uji & kirim ringkasan mengubah status akun walau gagal → muat ulang di kedua jalur
    test: useMutation({
      mutationFn: ({ id, to }: { id: string; to?: string }) => mailApi.test(id, to),
      onSuccess: replace,
      onError: refresh,
    }),
    digest: useMutation({ mutationFn: mailApi.digest, onSuccess: replace, onError: refresh }),
  };
}
