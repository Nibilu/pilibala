/**
 * Model catalog discovery for user-managed gateway/local AI connections.
 *
 * Gateway and local connections point at an arbitrary OpenAI-compatible
 * endpoint (routing.baseUrl). The setup UI stores `routing.models` as static
 * metadata, so without discovery every custom gateway shows an empty model
 * list. This helper grabs the live catalog from `<baseUrl>/models`
 * (OpenAI-compatible) so connection creation can fill it in. It only ever
 * sends the credential the user typed for this same connection to the base
 * URL they declared — the runner does exactly that at runtime.
 *
 * Discovery never throws: failures degrade to `{ models: [], discovered: false }`
 * with a reason, and connection creation proceeds with an empty list.
 */

export interface GatewayModelDiscovery {
  models: string[];
  discovered: boolean;
  reason?: string;
}

/** Discovery must never hang connection creation. */
const DISCOVERY_TIMEOUT_MS = 12_000;

/** Never store unbounded catalogs in connection config. */
const MAX_MODELS = 500;

/** Build model-list URL candidates from a user-supplied base URL. */
export function gatewayModelsUrlCandidates(baseUrl: string): string[] {
  const root = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(root)) return [];
  // A base already ending at a version root hosts /models directly; otherwise
  // try the versioned root first, then the bare root.
  return /\/v\d+$/i.test(root)
    ? [`${root}/models`]
    : [`${root}/v1/models`, `${root}/models`];
}

function modelIdsFromPayload(payload: unknown): string[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : [];
  const ids = rows
    .map((row) => (typeof row === "string" ? row : (row as { id?: unknown })?.id))
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
  return [...new Set(ids)];
}

export async function discoverOpenAiCompatibleModels(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayModelDiscovery> {
  const candidates = gatewayModelsUrlCandidates(baseUrl);
  if (!candidates.length) return { models: [], discovered: false, reason: "invalid_base_url" };
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let lastReason = "models_endpoint_not_found";
  for (const url of candidates) {
    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (response.status === 404 || response.status === 405) {
        lastReason = `http_${response.status}`;
        continue; // wrong path shape — try the next candidate
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { models: [], discovered: false, reason: `http_${response.status}` };
      }
      const payload = (await response.json()) as unknown;
      const models = modelIdsFromPayload(payload);
      if (!models.length) return { models: [], discovered: false, reason: "empty_catalog" };
      return { models: models.slice(0, MAX_MODELS), discovered: true };
    } catch {
      lastReason = "request_failed";
    }
  }
  return { models: [], discovered: false, reason: lastReason };
}

/** Anthropic Messages endpoints list models at /v1/models with x-api-key auth. */
export async function discoverAnthropicModels(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayModelDiscovery> {
  const root = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(root)) return { models: [], discovered: false, reason: "invalid_base_url" };
  const url = /\/v\d+$/i.test(root) ? `${root}/models` : `${root}/v1/models`;
  try {
    const response = await fetchImpl(url, {
      headers: { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" },
      redirect: "error",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { models: [], discovered: false, reason: `http_${response.status}` };
    }
    const models = modelIdsFromPayload(await response.json());
    if (!models.length) return { models: [], discovered: false, reason: "empty_catalog" };
    return { models: models.slice(0, MAX_MODELS), discovered: true };
  } catch {
    return { models: [], discovered: false, reason: "request_failed" };
  }
}

/** Gemini endpoints list models at /v1beta/models keyed by x-goog-api-key; ids arrive as "models/<id>". */
export async function discoverGeminiModels(
  baseUrl: string,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayModelDiscovery> {
  const root = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(root)) return { models: [], discovered: false, reason: "invalid_base_url" };
  const url = /\/v\d+\w*$/i.test(root) ? `${root}/models` : `${root}/v1beta/models`;
  try {
    const response = await fetchImpl(url, {
      headers: apiKey ? { "x-goog-api-key": apiKey } : {},
      redirect: "error",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { models: [], discovered: false, reason: `http_${response.status}` };
    }
    const payload = (await response.json()) as { models?: Array<{ name?: unknown }> };
    const ids = (payload.models ?? [])
      .map((row) => (typeof row?.name === "string" ? row.name.replace(/^models\//, "") : ""))
      .filter((id) => id.length > 0);
    if (!ids.length) return { models: [], discovered: false, reason: "empty_catalog" };
    return { models: [...new Set(ids)].slice(0, MAX_MODELS), discovered: true };
  } catch {
    return { models: [], discovered: false, reason: "request_failed" };
  }
}

/**
 * Protocol dispatch keyed by the connection's provider — the same
 * classification as the adapters: anthropic speaks the Messages protocol (its
 * own /v1/models shape), google speaks Gemini's models list, and every other
 * gateway destination (openai, xai, custom OpenAI-compatible gateways) uses
 * the OpenAI-compatible catalog. All shapes answer the same question — the
 * model list the connection's base URL serves — so the runtime can pair any
 * picked id with this connection's route.
 */
export async function discoverGatewayModels(
  baseUrl: string,
  apiKey: string | undefined,
  provider: string,
): Promise<GatewayModelDiscovery> {
  if (provider === "anthropic") return discoverAnthropicModels(baseUrl, apiKey);
  if (provider === "google") return discoverGeminiModels(baseUrl, apiKey);
  return discoverOpenAiCompatibleModels(baseUrl, apiKey);
}
