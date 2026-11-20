import {
  aiRoutingModel,
  isAiConnectionCompatible,
  type AiConnectionBinding,
  type AiConnectionMetadata,
  type AiManagedConnectionSummary,
} from "@pilibalaai/shared";

/**
 * Resolve the compatibility requirement for a saved binding against the
 * connections list, the same way the backend select() does: judge against the
 * RESOLVED connection's metadata (routing included), never the bare binding.
 * A bare binding carries no routing, so pi_local would fall into the
 * fixed-binding branch whose model-prefix rule ("openai/...") is meant for
 * native provider credentials only — gateway connections enumerate bare model
 * ids and would always render a false "incompatible" verdict in the UI.
 */
export function aiConnectionCompatRequirement(
  connections: AiManagedConnectionSummary[],
  value: AiConnectionBinding,
  currentUserId: string,
): AiConnectionMetadata | AiConnectionBinding {
  const connection = value.mode === "responsible_user"
    ? connections.find((c) => c.provider === value.provider && c.isDefault
        && c.ownerUserId === currentUserId && c.ownership === "personal")
    : connections.find((c) => c.id === value.connectionId && c.grantId === value.grantId);
  if (!connection) return value;
  return {
    provider: connection.provider,
    method: connection.method,
    mode: value.mode,
    ...(connection.routing ? { routing: connection.routing } : {}),
  };
}

/**
 * Connection ↔ model linkage for the harness/runtime and create-agent forms.
 *
 * The adapter's (provider, model) pair and the managed AI connection binding
 * are two independent fields. When the user routes the agent to a different
 * provider, the persisted binding keeps serving its own catalog, and the save
 * rejects the chosen model with "Choose a default model available on the
 * selected connection". This helper identifies the compatible company
 * connection that actually serves the chosen model so the form can rebind
 * without a manual trip through the connection picker.
 */
export interface ConnectionModelLinkageInput {
  /** Harness identity the binding is validated against (aiRoutingHarness result). */
  harness: string;
  /** Chosen adapter model, already transport-resolved (aiRoutingModel applied). */
  model: string | undefined;
  /** Current runtime binding, when the agent has one. */
  binding: AiConnectionBinding | undefined;
  connections: AiManagedConnectionSummary[];
  /** Current user id, needed to resolve a responsible_user default binding. */
  currentUserId?: string;
  /** baseUrl of the chosen adapter-catalog provider, when the catalog exposes one. */
  providerBaseUrl?: string | null;
}

export interface ConnectionModelLinkage {
  binding: AiConnectionBinding;
  connectionName: string;
}

const normalizeBaseUrl = (url: string | undefined | null): string =>
  (url ?? "").replace(/\/+$/, "").toLowerCase();

function connectionServesModel(
  connection: AiManagedConnectionSummary,
  harness: string,
  model: string,
): boolean {
  const routing = connection.routing;
  if (!routing) return false;
  return routing.models.some((entry) => aiRoutingModel(routing, harness, entry.id) === model);
}

export function resolveConnectionModelLinkage(
  input: ConnectionModelLinkageInput,
): ConnectionModelLinkage | null {
  const { harness, model, binding, connections, currentUserId, providerBaseUrl } = input;
  if (!model || connections.length === 0) return null;

  // Resolve the connection the current binding points at. An unresolvable
  // binding (deleted connection) also counts as a mismatch worth repairing.
  const boundConnection = !binding
    ? undefined
    : binding.mode === "responsible_user"
      ? connections.find(
          (c) =>
            c.provider === binding.provider &&
            c.isDefault &&
            c.ownership === "personal" &&
            c.ownerUserId === currentUserId,
        )
      : connections.find((c) => c.id === binding.connectionId && c.grantId === binding.grantId);

  // Only repair an actual mismatch: a routing-bound connection that does not
  // serve the chosen model. Non-routing bindings (subscriptions, host
  // defaults) have no static catalog to contradict the model, and an absent
  // binding means the host-default path, which must not be silently re-routed.
  if (!binding || !boundConnection) return null;
  if (!boundConnection.routing) return null;
  if (connectionServesModel(boundConnection, harness, model)) return null;

  const candidates = connections
    .filter(
      (c) =>
        c.id !== boundConnection.id &&
        c.status === "connected" &&
        connectionServesModel(c, harness, model) &&
        isAiConnectionCompatible(c, harness, model),
    )
    .sort((a, b) => {
      const baseUrl = normalizeBaseUrl(providerBaseUrl);
      const aMatches = baseUrl && normalizeBaseUrl(a.routing?.baseUrl) === baseUrl ? 1 : 0;
      const bMatches = baseUrl && normalizeBaseUrl(b.routing?.baseUrl) === baseUrl ? 1 : 0;
      if (aMatches !== bMatches) return bMatches - aMatches;
      const aShared = a.ownership === "shared" ? 1 : 0;
      const bShared = b.ownership === "shared" ? 1 : 0;
      if (aShared !== bShared) return bShared - aShared;
      return a.name.localeCompare(b.name);
    });

  const best = candidates[0];
  if (!best) return null;
  return {
    connectionName: best.name,
    binding: {
      provider: best.provider,
      method: best.method,
      mode: best.ownership === "shared" ? "shared" : "delegated",
      connectionId: best.id,
      grantId: best.grantId,
    },
  };
}
