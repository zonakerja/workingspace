import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";
import { errorMessage } from "@/lib/api/client";
import { type AgentMenu, type AgentRun, agentApi } from "@/lib/api/endpoints";
import type { AgentPolicyInput } from "@/types/api";
import { queryKeys } from "./query-keys";

export function useAgentStatus() {
  return useQuery({ queryKey: queryKeys.agentStatus, queryFn: agentApi.status, refetchInterval: 30_000 });
}

export function useAgentSkills(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.agentSkills, queryFn: agentApi.skills, enabled });
}

export function useAgentRuns(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.agentRuns, queryFn: agentApi.runs, enabled, refetchInterval: 15_000 });
}

/** Fitur buatan agen; dipakai sidebar, jadi dimuat untuk semua akun (selain pemilik agen = kosong). */
export function useAgentMenus() {
  return useQuery({ queryKey: queryKeys.agentMenus, queryFn: agentApi.menus, refetchInterval: 60_000 });
}

export function useAgentMenuRuns(id: string, enabled = true) {
  return useQuery({ queryKey: queryKeys.agentMenuRuns(id), queryFn: () => agentApi.menuRuns(id), enabled });
}

export function useAgentMenuMutations() {
  const client = useQueryClient();
  const onSuccess = () => client.invalidateQueries({ queryKey: queryKeys.agentMenus });
  return {
    setStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: AgentMenu["status"] }) => agentApi.setMenuStatus(id, status),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: agentApi.removeMenu, onSuccess }),
  };
}

/** Agen siap dipakai user ini (diatur, pemilik, Hermes menyala). */
export function useAgentReady() {
  const { data } = useAgentStatus();
  return !!data?.configured && !!data.owner && !!data.reachable;
}

/**
 * Pantau satu tugas agen (run) sampai selesai: poll tiap 1,5 detik. `onDone` dipanggil sekali saat run selesai
 * (mis. memuat ulang pengajuan yang diubah agen).
 */
export function useAgentRunWatcher(runId: string | null, onDone?: (run: AgentRun) => void) {
  const client = useQueryClient();
  const [run, setRun] = useState<AgentRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = useEffectEvent((r: AgentRun) => {
    onDone?.(r);
    void client.invalidateQueries({ queryKey: queryKeys.agentRuns });
  });

  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await agentApi.run(runId);
        if (stopped) return;
        setRun(r);
        setError(null);
        if (r.done) return finish(r);
      } catch (e) {
        if (stopped) return;
        setError(errorMessage(e));
      }
      timer = setTimeout(() => void tick(), 1_500);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);

  // Run lain dimulai → tampilan run lama dibuang (bandingkan saat render, bukan lewat efek)
  const current = run?.runId === runId ? run : null;
  return { run: current, error: runId ? error : null };
}

/** Kebijakan Otomatis (docs/AI-AGENT.md §24): aturan pemilik agen + sakelar darurat. */
export function useAgentPolicies(enabled = true) {
  return useQuery({ queryKey: queryKeys.agentPolicies, queryFn: agentApi.policies, enabled });
}

export function useAgentPolicyMutations() {
  const client = useQueryClient();
  const done = () => void client.invalidateQueries({ queryKey: queryKeys.agentPolicies });
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: AgentPolicyInput }) =>
        id ? agentApi.updatePolicy(id, input) : agentApi.createPolicy(input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: agentApi.removePolicy, onSuccess: done }),
    pause: useMutation({ mutationFn: agentApi.pausePolicies, onSuccess: done }),
    cancelAuto: useMutation({
      mutationFn: agentApi.cancelAuto,
      onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.requests }),
    }),
  };
}

/** Riwayat percakapan AI Agent (tersimpan di server). */
export function useAgentConversations(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.agentConversations, queryFn: agentApi.conversations, enabled });
}

export function useAgentConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agentConversation(id ?? ""),
    queryFn: () => agentApi.conversation(id!),
    enabled: !!id,
    retry: false,
  });
}

export function useAgentConversationMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.agentConversations });
  return {
    update: useMutation({
      mutationFn: ({ id, ...patch }: { id: string; title?: string; pinned?: boolean }) =>
        agentApi.updateConversation(id, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: agentApi.removeConversation, onSuccess: refresh }),
  };
}
