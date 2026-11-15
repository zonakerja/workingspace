import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type McpConnectionInput, mcpConnectionsApi } from "@/lib/api/endpoints";
import { queryKeys } from "./query-keys";

/** Koneksi aplikasi MCP milik user. Saat menunggu izin OAuth (jendela otorisasi terbuka) daftar dipantau tiap 3 dtk. */
export function useMcpConnections(options: { watching?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.mcpConnections,
    queryFn: mcpConnectionsApi.list,
    refetchInterval: options.watching ? 3_000 : false,
  });
}

export function useMcpPresets() {
  return useQuery({ queryKey: queryKeys.mcpPresets, queryFn: mcpConnectionsApi.presets, staleTime: Infinity });
}

export function useMcpConnectionMutations() {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: queryKeys.mcpConnections });
  return {
    create: useMutation({ mutationFn: mcpConnectionsApi.create, onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: McpConnectionInput }) => mcpConnectionsApi.update(id, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: mcpConnectionsApi.remove, onSuccess: refresh }),
    connect: useMutation({ mutationFn: mcpConnectionsApi.connect, onSuccess: refresh }),
    refresh: useMutation({ mutationFn: mcpConnectionsApi.refresh, onSuccess: refresh }),
    call: useMutation({
      mutationFn: ({ id, tool, args }: { id: string; tool: string; args: Record<string, unknown> }) =>
        mcpConnectionsApi.call(id, tool, args),
    }),
  };
}
