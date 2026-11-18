import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mailApi } from "@/lib/api/endpoints";
import type { MailAccount, MailInboxSettingsInput, MailMessageDetail, MailStatus } from "@/types/api";
import { queryKeys } from "./query-keys";

/** Daftar email (menu Email), dimuat bertahap 50 per halaman. */
export function useMailMessages(filter: { accountId?: string; status?: MailStatus; q?: string }) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.mailMessages, "list", filter],
    queryFn: ({ pageParam }) => mailApi.messages({ ...filter, take: 50, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.messages.at(-1)?.sentAt : undefined),
    refetchInterval: 120_000,
  });
}

export function useMailMessage(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.mailMessages, "detail", id],
    queryFn: () => mailApi.message(id!),
    enabled: !!id,
  });
}

export function useMailMessageMutations() {
  const client = useQueryClient();
  const done = (detail: MailMessageDetail) => {
    client.setQueryData([...queryKeys.mailMessages, "detail", detail.id], detail);
    void client.invalidateQueries({ queryKey: [...queryKeys.mailMessages, "list"] });
  };
  return {
    status: useMutation({
      mutationFn: ({ id, status }: { id: string; status: MailStatus }) => mailApi.setMessageStatus(id, status),
      onSuccess: done,
    }),
    todo: useMutation({
      mutationFn: ({ id, input }: { id: string; input: { title: string; date: string; priority: string } }) =>
        mailApi.messageTodo(id, input),
      onSuccess: (detail) => {
        done(detail);
        void client.invalidateQueries({ queryKey: queryKeys.records("todo") });
      },
    }),
    agenda: useMutation({
      mutationFn: ({
        id,
        input,
      }: {
        id: string;
        input: { title: string; startDate: string; startTime?: string; endTime?: string };
      }) => mailApi.messageAgenda(id, input),
      onSuccess: (detail) => {
        done(detail);
        void client.invalidateQueries({ queryKey: queryKeys.records("schedule") });
      },
    }),
  };
}

/** Pengaturan & sinkron kotak masuk per akun (Pengaturan → Akun Tersambung, menu Email). */
export function useInboxMutations() {
  const client = useQueryClient();
  const replace = (account: MailAccount) =>
    client.setQueryData<MailAccount[]>(queryKeys.mailAccounts, (prev) =>
      prev?.map((a) => (a.id === account.id ? account : a)),
    );
  return {
    settings: useMutation({
      mutationFn: ({ id, input }: { id: string; input: MailInboxSettingsInput }) => mailApi.inboxSettings(id, input),
      onSuccess: replace,
    }),
    sync: useMutation({
      mutationFn: (id: string) => mailApi.inboxSync(id),
      onSuccess: (result) => {
        replace(result.account);
        void client.invalidateQueries({ queryKey: [...queryKeys.mailMessages, "list"] });
      },
      onError: () => void client.invalidateQueries({ queryKey: queryKeys.mailAccounts }),
    }),
  };
}
