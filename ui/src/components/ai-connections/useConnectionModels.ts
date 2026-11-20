import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { aiRoutingModel, type AiConnectionBinding, type AiProviderRouting } from "@pilibalaai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { agentsApi } from "@/api/agents";
import { useQueryView } from "@/components/QueryView";
import { queryKeys } from "@/lib/queryKeys";

export function useConnectionModelsState(
  companyId: string | null | undefined,
  binding: AiConnectionBinding | undefined,
  harness: string,
) {
  const client = useQueryClient();
  const [refreshingRouting, setRefreshingRouting] = useState(false);
  const accounts = useQuery({
    queryKey: ["ai-connections", companyId],
    queryFn: () => aiConnectionsApi.list(companyId!),
    enabled: Boolean(companyId && binding),
  });
  const connection = accounts.data?.connections.find((c) =>
    binding?.mode === "responsible_user"
      ? c.provider === binding.provider && c.isDefault && c.ownerUserId === accounts.data?.currentUserId && c.ownership === "personal"
      : c.id === binding?.connectionId && c.grantId === binding?.grantId,
  );
  const routing = connection?.routing;
  const openRouter = routing?.kind === "openrouter" || (!routing && binding?.provider === "openrouter");
  const discover = openRouter && !routing?.models.length;
  // Reuse the existing public catalog and its query cache. It returns OpenCode IDs;
  // strip only that transport prefix for other harnesses (openrouter/auto is
  // itself a valid upstream model ID).
  const catalog = useQuery({
    queryKey: queryKeys.agents.adapterModels(companyId ?? "none", "opencode_local", null, "openrouter"),
    queryFn: () => agentsApi.adapterModels(companyId!, "opencode_local", { provider: "openrouter" }),
    enabled: Boolean(companyId && discover),
    staleTime: 60_000,
  });
  const catalogView = useQueryView(catalog);
  const effectiveRouting: AiProviderRouting | undefined = routing ?? (openRouter
    ? { kind: "openrouter", protocol: "chat", auth: "bearer", models: [] }
    : undefined);
  const rawModels = discover
    ? (catalog.data ?? []).map((m) => ({ ...m, id: ["opencode_local", "pi_local"].includes(harness) ? m.id : m.id.replace(/^openrouter\//, "") }))
    : routing?.models ?? [];
  const routingForModels = effectiveRouting;
  // The catalog must show exactly what the connection serves: dedupe by the
  // transport-resolved id so repeated upstream entries never double-list.
  const seenIds = new Set<string>();
  const modelOptions = routingForModels
    ? rawModels.filter((m) => {
        const resolved = aiRoutingModel(routingForModels, harness, m.id);
        if (seenIds.has(resolved)) return false;
        seenIds.add(resolved);
        return true;
      })
    : rawModels;
  // Gateway/local connections can re-run server-side discovery against their
  // base URL; the merged catalog lands on the connection's routing.models.
  const refreshRoutingModels = routing && (routing.kind === "gateway" || routing.kind === "local") && connection && companyId
    ? async () => {
        setRefreshingRouting(true);
        try {
          await aiConnectionsApi.refreshModels(companyId, connection.id);
          await client.invalidateQueries({ queryKey: ["ai-connections", companyId] });
        } finally {
          setRefreshingRouting(false);
        }
      }
    : undefined;
  const resolvedModels = routingForModels
    ? modelOptions.map((m) => ({
        id: aiRoutingModel(routingForModels, harness, m.id),
        label: m.label ?? m.id,
      }))
    : [];
  // Providers a connection can serve, derived from its own catalog: the id
  // prefix of "provider/model" entries (gateway/live catalogs are
  // provider-prefixed). A single-provider connection yields one entry and the
  // UI locks the provider to it; multi-provider connections offer the set.
  const providerSet = new Set<string>();
  for (const model of resolvedModels) {
    const separator = model.id.indexOf("/");
    if (separator > 0) providerSet.add(model.id.slice(0, separator));
  }
  const providers = [...providerSet].sort();
  const connectionModels = effectiveRouting
    ? {
        models: resolvedModels,
        providers,
        isLoading: discover && (catalog.isLoading || catalogView.kind === "reconnecting"),
        error: discover && catalogView.kind === "error" ? catalog.error : null,
        refreshing: (discover && catalog.isFetching) || refreshingRouting,
        refreshModels: discover ? async () => { await catalog.refetch(); } : refreshRoutingModels,
        resolveModel: (model: string) =>
          aiRoutingModel(effectiveRouting, harness, model),
      }
    : undefined;
  return {
    connectionModels,
    /** Deterministic "directory not resolved yet" flag (unlike isLoading, it does not flicker false on the first frame). */
    pending: accounts.isPending,
    loading: accounts.isLoading,
    refreshing: accounts.isFetching,
    error: accounts.error,
    refresh: async () => { await accounts.refetch(); },
  };
}

export function useConnectionModels(
  companyId: string | null | undefined,
  binding: AiConnectionBinding | undefined,
  harness: string,
) {
  return useConnectionModelsState(companyId, binding, harness).connectionModels;
}
