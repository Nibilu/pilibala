import { OPENROUTER_ATTRIBUTION_HEADERS, isOpenRouterUrl, openRouterClaudeHeaders, openRouterCodexHeaders } from "@pilibalaai/shared/openrouter-attribution";
import {
  aiRoutingBaseUrl,
  aiRoutingModel,
  type AiProviderRouting,
} from "@pilibalaai/shared";

function hermesProviderForRoute(route: AiProviderRouting, baseUrl: string): string {
  if (route.kind === "openrouter") return "openrouter";
  try {
    if (new URL(baseUrl).hostname.toLowerCase() === "integrate.api.nvidia.com") return "nvidia";
  } catch {
    // fall through to the generic custom-provider projection
  }
  return "custom";
}

/** Projects one authoritative connection into an isolated harness environment. */
export function managedProviderRouting(
  route: AiProviderRouting,
  harness: string,
  credential: string,
  model: string,
) {
  const env: Record<string, string> = {};
  const config: Record<string, unknown> = {};
  let codexConfig = "";
  let hermesConfig = "";
  const baseUrl = aiRoutingBaseUrl(route, harness);
  const openrouter = isOpenRouterUrl(baseUrl);
  if (route.kind === "bedrock") {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    env.AWS_REGION = route.region!;
    env.AWS_DEFAULT_REGION = route.region!;
    env.AWS_EC2_METADATA_DISABLED = "true";
    env.AWS_BEARER_TOKEN_BEDROCK = credential;
  } else if (harness === "codex_local") {
    env.PILIBALA_AI_PROVIDER_KEY = credential;
    codexConfig = `model_provider = "pilibala"\n[model_providers.pilibala]\nname = "Pilibala connection"\nbase_url = ${JSON.stringify(baseUrl)}\nwire_api = "responses"\nrequires_openai_auth = false\n${route.auth === "none" ? "" : 'env_key = "PILIBALA_AI_PROVIDER_KEY"\n'}`;
    if (openrouter) codexConfig += openRouterCodexHeaders();
  } else if (harness === "claude_local") {
    env.ANTHROPIC_BASE_URL = baseUrl;
    if (openrouter) env.ANTHROPIC_CUSTOM_HEADERS = openRouterClaudeHeaders();
    env[
      route.auth === "api_key" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
    ] = credential;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    if (model) {
      env.ANTHROPIC_MODEL = model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
      env.CLAUDE_CODE_SUBAGENT_MODEL = model;
    }
  } else if (harness === "pi_local" && route.kind === "openrouter") {
    env.OPENROUTER_API_KEY = credential;
    config.model = aiRoutingModel(route, harness, model);
  } else if (harness === "pi_local") {
    // Generic gateway/local (chat_completions + baseUrl): pi has no base-url
    // CLI flag or env var, so the connection is projected as a models.json
    // providers entry via PILIBALA_PI_PROVIDERS. The pi-local adapter's
    // preparePiRuntimeConfig materializes it into a managed PI_CODING_AGENT_DIR
    // and expands {env:VAR} placeholders server-side, so the credential rides
    // the child env only — never a literal in a persisted config.
    const gatewayKeyName = "PILIBALA_PI_GATEWAY_KEY";
    if (route.auth !== "none") env[gatewayKeyName] = credential;
    const routingModels = Array.isArray(route.models) ? route.models : [];
    const modelIds = [...new Set([...routingModels, ...(model ? [model] : [])])];
    env.PILIBALA_PI_PROVIDERS = JSON.stringify({
      pilibala: {
        baseUrl,
        api: "openai-completions",
        ...(route.auth === "none" ? {} : { apiKey: `{env:${gatewayKeyName}}` }),
        models: modelIds.map((id) => ({ id, name: id, input: ["text"] })),
      },
    });
    config.model = model ? `pilibala/${model}` : "";
  } else if (harness === "opencode_local") {
    const provider = route.kind === "openrouter" ? "openrouter" : "pilibala";
    if (route.kind === "openrouter") env.OPENROUTER_API_KEY = credential;
    else {
      env.PILIBALA_AI_PROVIDER_KEY = credential;
      env.PILIBALA_AI_PROVIDER_URL = baseUrl;
    }
    const id = model.startsWith(`${provider}/`)
      ? model.slice(provider.length + 1)
      : model;
    // Opencode resolves --variant against the model's own variant map; the
    // runner driver already injects pilibala-* variants for OpenRouter models
    // (opencode-server-driver.ts). Mirror that here for managed connections so
    // the effort lanes (pilibala-low/medium/high) resolve on every projected
    // model, with the body key each protocol actually accepts — variants stay
    // inert until a --variant references them. Shape matches the pinned
    // opencode v1 schema (variants as an object map).
    const effortVariants = openrouter
      ? {
          "pilibala-low": { reasoning: { effort: "low" } },
          "pilibala-medium": { reasoning: { effort: "medium" } },
          "pilibala-high": { reasoning: { effort: "high" } },
        }
      : {
          "pilibala-low": { reasoning_effort: "low" },
          "pilibala-medium": { reasoning_effort: "medium" },
          "pilibala-high": { reasoning_effort: "high" },
        };
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      provider: {
        [provider]: {
          ...(provider === "pilibala"
            ? { npm: "@ai-sdk/openai-compatible", name: "Pilibala connection" }
            : {}),
          options: { baseURL: baseUrl, apiKey: credential, ...(openrouter ? { headers: OPENROUTER_ATTRIBUTION_HEADERS } : {}) },
          models: id ? { [id]: { name: id, variants: effortVariants } } : {},
        },
      },
      enabled_providers: [provider],
    });
    env.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
    config.model = aiRoutingModel(route, harness, model);
  } else if (harness === "hermes_local") {
    env.OPENAI_BASE_URL = baseUrl;
    env.OPENAI_API_KEY = credential;
    env.OPENROUTER_API_KEY = route.kind === "openrouter" ? credential : "";
    const provider = hermesProviderForRoute(route, baseUrl);
    // Hermes scrubs KNOWN credential env keys (OPENAI_API_KEY, NVIDIA_API_KEY,
    // …) from terminal/task children, so a turn-level run would resolve the
    // provider to "no usable credentials". Hermes' own escape hatch is the
    // model-level `key_env` pointer: the config names a variable and the CLI
    // reads it from the environment. The name must stay provider-scoped —
    // empirically a generic gateway name is dropped during the CLI's env
    // hand-off to the turn, while a provider-bearing name survives — so the
    // credential travels as PILIBALA_<PROVIDER>_KEY. Config-only, no
    // hermes-side changes.
    const gatewayKeyName = `PILIBALA_${provider.toUpperCase()}_KEY`;
    if (route.auth !== "none") {
      env[gatewayKeyName] = credential;
    }
    // The provider registry still resolves its own env key at launch time
    // (ACP lane reads it server-side); keep it projected as well.
    if (provider === "nvidia") env.NVIDIA_API_KEY = credential;
    config.provider = provider;
    // Hermes now reads custom endpoint routing from config.yaml, not OPENAI_BASE_URL.
    // Hermes strips OPENAI_API_KEY from terminal children. A custom variable
    // would expose the reusable gateway key to task-controlled shell commands.
    hermesConfig = `model:\n  provider: ${JSON.stringify(provider)}\n  default: ${JSON.stringify(model)}\n  base_url: ${JSON.stringify(baseUrl)}\n  api_mode: "chat_completions"\n${route.auth === "none" ? "" : `  key_env: ${JSON.stringify(gatewayKeyName)}\n  api_key: "\${${gatewayKeyName}}"\n`}`;
  }
  if (openrouter && hermesConfig) hermesConfig += `  default_headers: ${JSON.stringify(OPENROUTER_ATTRIBUTION_HEADERS)}\n`;
  return { env, config, codexConfig, hermesConfig };
}
