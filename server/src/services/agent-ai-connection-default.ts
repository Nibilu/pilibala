import { type Db } from "@pilibalaai/db";
import {
  AI_PROVIDERS,
  aiRuntimeConnectionBindingSchema,
  isAiConnectionCompatible,
  type AiConnectionBinding,
  type AiRuntimeConnectionBinding,
  type AiProvider,
} from "@pilibalaai/shared";

import { aiConnectionService } from "./ai-connections.js";

// Only keys read by the child's provider express a child auth override.
// A config copied from another provider can retain unrelated keys.
const PROVIDER_AUTH_ENV_KEYS: Record<AiProvider, readonly string[]> = {
  github: ["COPILOT_GITHUB_TOKEN"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GEMINI_BASE_URL"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"],
  openai: ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_HOME", "OPENAI_BASE_URL"],
  openrouter: ["OPENROUTER_API_KEY", "OPENCODE_AUTH_JSON", "OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "PILIBALA_OPENCODE_PROVIDERS"],
  xai: ["XAI_API_KEY", "GROK_API_KEY", "GROK_HOME", "XAI_BASE_URL"],
};

/** A hire inherits a connection choice, never its manager's credentials or identity. */
export function defaultAiConnectionForHire(
  adapterType: string,
  config: Record<string, unknown>,
  managerBinding: unknown,
): AiRuntimeConnectionBinding | undefined {
  const compatible = (binding: AiConnectionBinding) =>
    isAiConnectionCompatible(binding, adapterType, config.model, config.provider, config.acpxAgent);
  const inherited = aiRuntimeConnectionBindingSchema.safeParse(managerBinding);
  // Unmanaged parents keep their existing login and credential-reference paths.
  if (!inherited.success) return undefined;
  const env = config.env && typeof config.env === "object" ? config.env as Record<string, unknown> : {};
  const hasChildAuth = (provider: AiProvider) =>
    PROVIDER_AUTH_ENV_KEYS[provider].some((key) => env[key] !== undefined);
  const withChildAuthPrecedence = (binding: AiConnectionBinding) =>
    hasChildAuth(binding.provider) ? undefined : binding;
  if (inherited.data.mode === "router") {
    // The host validates pool membership, access and harness compatibility for
    // the new agent. Never silently replace an incompatible pool with local auth.
    // OpenCode also supports explicitly configured providers whose models are
    // outside the managed OpenRouter catalog. Their auth still takes precedence.
    const childProvider = adapterType === "opencode_local"
      || (adapterType === "pilibala_runner" && config.provider === "opencode")
      ? "openrouter"
      : AI_PROVIDERS.find((provider) =>
        compatible({ provider, method: "api_key", mode: "responsible_user" }));
    return childProvider && hasChildAuth(childProvider) ? undefined : inherited.data;
  }
  if (inherited.data.mode !== "delegated" && compatible(inherited.data)) {
    const binding = inherited.data.mode === "shared"
      ? { provider: inherited.data.provider, method: "api_key" as const, mode: "responsible_user" as const }
      : inherited.data;
    return withChildAuthPrecedence(binding);
  }
  // The selected provider's personal default supplies the actual sign-in method
  // at run time. A provider without an account can be connected on the first task.
  for (const provider of AI_PROVIDERS) {
    const binding = { provider, method: "api_key", mode: "responsible_user" } as const;
    if (compatible(binding)) return withChildAuthPrecedence(binding);
  }
  return undefined;
}

interface RunConnectionSummary {
  status?: string;
  ownership?: string;
  isDefault?: boolean;
  id: string;
  grantId: string;
  provider: AiProvider;
}

/**
 * Pick the connection a run should hire when the agent chose "Default
 * connection" (no explicit runtime binding). The user's marked default wins,
 * then a sole compatible candidate; with several candidates prefer the
 * company-shared one. Ambiguous multi-candidate boards resolve to nothing so
 * the run keeps its explicit host-config fallback rather than guessing.
 */
export function pickDefaultRunConnection<T extends RunConnectionSummary>(
  summaries: T[],
  compatible: (summary: T) => boolean,
): T | undefined {
  const candidates = summaries.filter(
    (summary) => (summary.status === undefined || summary.status === "connected") && compatible(summary),
  );
  if (!candidates.length) return undefined;
  return (
    candidates.find((summary) => summary.isDefault) ??
    candidates.find((summary) => summary.ownership === "shared") ??
    (candidates.length === 1 ? candidates[0] : undefined)
  );
}

/**
 * Run-time resolution of the "Default connection" agent choice: the agent runs
 * against the responsible user's default compatible connection instead of the
 * raw host config. Selecting the option never deletes or modifies any
 * connection — it only makes the default the agent's active one.
 */
export async function resolveAgentDefaultRunBinding(
  db: Db,
  agent: { companyId: string; adapterType: string },
  config: Record<string, unknown>,
  responsibleUserId: string,
): Promise<AiConnectionBinding | undefined> {
  const summaries = await aiConnectionService(db).list(agent.companyId, responsibleUserId);
  const compatible = (summary: RunConnectionSummary) =>
    isAiConnectionCompatible(
      { provider: summary.provider, method: "api_key" },
      agent.adapterType,
      config.model,
      config.provider,
      config.acpxAgent,
    );
  const picked = pickDefaultRunConnection(summaries, compatible);
  if (!picked) return undefined;
  return picked.ownership === "shared"
    ? { mode: "shared", method: "api_key", grantId: picked.grantId, provider: picked.provider, connectionId: picked.id }
    : { mode: "responsible_user", provider: picked.provider, method: "api_key" };
}
