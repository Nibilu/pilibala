import type { AiConnectionBinding, AiProviderRouting } from "@pilibalaai/shared";

/**
 * Shared connection/provider/model attribution core (AMB-326 P2, PRD v1.1 §5).
 *
 * One place answers "which provider does a model id belong to" for grouping,
 * filtering, and provider-set derivation across every surface that shows a
 * model catalog (settings forms, the composer picker, linkage selects).
 *
 * The rule that used to live (duplicated and wrong) at three sites: derive the
 * provider from the id's first "/" segment. That is only true for catalogs
 * whose ids are registry-qualified (pi/opencode default catalogs:
 * "nvidia/minimaxai/minimax-m3.1-flash" → provider "nvidia"). A managed
 * connection's catalog is connection-attributed instead: one connection = one
 * provider endpoint that serves ids from many vendor namespaces (an nvidia
 * gateway serves "minimaxai/*", "z-ai/*", "google/*" — the prefix is a vendor
 * namespace, not the serving provider), so the attributed provider is the
 * connection's own provider and the catalog locks to it.
 */

export type ModelRoutingKind = "openrouter" | "bedrock" | "gateway" | "local";

export interface ModelAttributionContext {
  routingKind?: ModelRoutingKind;
  /** The serving provider of the managed connection (connection.provider). */
  connectionProvider?: string | null;
}

/** Routing kinds whose catalogs are attributed to the connection itself. */
const CONNECTION_ATTRIBUTED: ReadonlySet<ModelRoutingKind> = new Set(["gateway", "local", "bedrock"]);

/**
 * Derive the routing kind for a catalog the way useConnectionModels resolves
 * it: the connection's routing wins; a legacy OpenRouter connection without
 * routing metadata still routes as openrouter when the binding names it.
 */
export function resolveCatalogRoutingKind(
  routing: AiProviderRouting | undefined,
  binding: AiConnectionBinding | undefined,
): ModelRoutingKind | undefined {
  if (routing) return routing.kind;
  if (binding?.provider === "openrouter") return "openrouter";
  return undefined;
}

/**
 * The provider a model id is attributed to under the given routing context.
 * Connection-attributed catalogs (gateway/local/bedrock managed connections)
 * carry NO provider dimension: the connection's `provider` field is the
 * ACCOUNT type (an "openai"-type connection may be an nvidia NIM gateway), so
 * neither the account name nor the id's vendor prefix is a truthful serving
 * provider — the catalog is presented whole and reached through search.
 * Returns null there and for unattributable ids on prefix-derived catalogs.
 */
export function attributeModelProvider(
  modelId: string,
  context: ModelAttributionContext = {},
): string | null {
  const trimmed = modelId.trim();
  const separator = trimmed.indexOf("/");
  const prefix = separator > 0 ? trimmed.slice(0, separator).trim() : "";
  if (context.routingKind && CONNECTION_ATTRIBUTED.has(context.routingKind)) {
    return null;
  }
  return prefix || null;
}

/**
 * Providers a catalog can serve. Connection-attributed catalogs yield an
 * empty set — no provider filter/lock row renders (the connection IS the
 * endpoint; its `provider` field names the account type, not the serving
 * vendor) and the whole directory stays reachable through search.
 * Prefix-derived catalogs keep the id-prefix derivation.
 */
export function deriveCatalogProviders(
  resolvedModels: ReadonlyArray<{ id: string }>,
  context: ModelAttributionContext = {},
): string[] {
  if (context.routingKind && CONNECTION_ATTRIBUTED.has(context.routingKind)) {
    return [];
  }
  const set = new Set<string>();
  for (const model of resolvedModels) {
    const provider = attributeModelProvider(model.id, context);
    if (provider) set.add(provider);
  }
  return [...set].sort();
}

export interface ProviderModelGroup<T> {
  provider: string;
  entries: T[];
}

/**
 * Group catalog entries by their attributed provider (the ModelDropdown
 * groupByProvider view). `preserveOrder` keeps the adapter's deliberate
 * ordering inside each group; otherwise entries sort alphabetically, matching
 * the previous dropdown behavior.
 */
export function groupModelsByProvider<T extends { id: string }>(
  models: ReadonlyArray<T>,
  context: ModelAttributionContext = {},
  options: { preserveOrder?: boolean } = {},
): Array<ProviderModelGroup<T>> {
  const map = new Map<string, T[]>();
  for (const model of models) {
    const provider = attributeModelProvider(model.id, context) ?? "other";
    const group = map.get(provider) ?? [];
    group.push(model);
    map.set(provider, group);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, entries]) => ({
      provider,
      entries: options.preserveOrder ? entries : [...entries].sort((a, b) => a.id.localeCompare(b.id)),
    }));
}
