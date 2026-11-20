import { describe, it, expect } from "vitest";
import {
  aiProviderRoutingSchema,
  aiRoutingHarness,
  aiRoutingModel,
  createAiConnectionSchema,
  isAiConnectionCompatible,
  isAiRoutingCompatible,
} from "@pilibalaai/shared";
import { managedProviderRouting } from "../services/ai-provider-routing.js";

describe("provider routing", () => {
  it("routes managed OpenRouter accounts to direct and native Pi without OpenCode configuration", () => {
    const routing = aiProviderRoutingSchema.parse({ kind: "openrouter", protocol: "chat" });
    expect(aiRoutingHarness("pilibala_runner", "acpx", "pi")).toBe("pi_local");
    for (const adapterType of ["pi_local", "pilibala_runner"]) {
      expect(isAiConnectionCompatible({ provider: "openrouter", method: "api_key", routing }, adapterType, "openrouter/anthropic/model", "acpx", "pi")).toBe(true);
    }
    expect(aiRoutingModel(routing, "pi_local", "anthropic/model")).toBe("openrouter/anthropic/model");
    expect(aiRoutingModel(routing, "pi_local", "openrouter/anthropic/model")).toBe("openrouter/anthropic/model");
    const projected = managedProviderRouting(routing, "pi_local", "selected-pi-key", "anthropic/model");
    expect(projected).toMatchObject({ config: { model: "openrouter/anthropic/model" }, env: { OPENROUTER_API_KEY: "selected-pi-key" } });
    expect(projected.env).not.toHaveProperty("OPENCODE_CONFIG_CONTENT");
    expect(isAiConnectionCompatible({ provider: "openai", method: "api_key", routing: aiProviderRoutingSchema.parse({ kind: "gateway", protocol: "chat", baseUrl: "https://gateway.example/v1" }) }, "pi_local", "custom/model")).toBe(true);
  });
  it("projects a managed gateway connection to Pi via PILIBALA_PI_PROVIDERS", () => {
    const routing = aiProviderRoutingSchema.parse({ kind: "gateway", protocol: "chat", baseUrl: "https://gateway.example/v1", auth: "api_key", models: ["model-a", "model-b"] });
    expect(isAiRoutingCompatible(routing, "pi_local")).toBe(true);
    const projected = managedProviderRouting(routing, "pi_local", "gw-secret-key", "model-a");
    expect(projected.config).toMatchObject({ model: "pilibala/model-a" });
    expect(projected.env.PILIBALA_PI_GATEWAY_KEY).toBe("gw-secret-key");
    const providers = JSON.parse(projected.env.PILIBALA_PI_PROVIDERS!);
    const provider = providers.pilibala;
    expect(provider.baseUrl).toBe("https://gateway.example/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.apiKey).toBe("{env:PILIBALA_PI_GATEWAY_KEY}");
    expect(provider.models.map((m: { id: string }) => m.id)).toEqual(["model-a", "model-b"]);
    // the projected providers config carries only the {env:VAR} placeholder —
    // the literal credential travels in its own env var, never inline.
    expect(projected.env.PILIBALA_PI_PROVIDERS).not.toContain("gw-secret-key");
  });
  it("projects an auth-less gateway connection to Pi without any key material", () => {
    const routing = aiProviderRoutingSchema.parse({ kind: "gateway", protocol: "chat", baseUrl: "http://127.0.0.1:8123/v1", auth: "none", models: ["model-x"] });
    const projected = managedProviderRouting(routing, "pi_local", "", "model-x");
    const providers = JSON.parse(projected.env.PILIBALA_PI_PROVIDERS!);
    expect(providers.pilibala.apiKey).toBeUndefined();
    expect(projected.env).not.toHaveProperty("PILIBALA_PI_GATEWAY_KEY");
    expect(projected.config).toMatchObject({ model: "pilibala/model-x" });
  });
  it.each(["openai", "anthropic", "google", "openrouter"] as const)("accepts Pi %s API keys only for matching models", provider => {
    expect(isAiConnectionCompatible({ provider, method: "api_key" }, "pilibala_runner", `${provider}/model`, "acpx", "pi")).toBe(true);
    expect(isAiConnectionCompatible({ provider, method: "subscription" }, "pi_local", `${provider}/model`)).toBe(false);
    expect(isAiConnectionCompatible({ provider, method: "subscription", mode: "responsible_user" }, "pi_local", `${provider}/model`)).toBe(true);
    expect(isAiConnectionCompatible({ provider, method: "api_key" }, "pi_local", "different/model")).toBe(false);
  });
  it.each([
    "https://user:secret@gateway.example/v1",
    "https://gateway.example/v1?key=secret",
    "http://169.254.169.254/",
    "file:///tmp/secret",
    "https://gateway.example/#secret",
  ])("rejects unsafe or credential-bearing endpoint %s", (baseUrl) => {
    expect(
      aiProviderRoutingSchema.safeParse({
        kind: "gateway",
        protocol: "responses",
        baseUrl,
      }).success,
    ).toBe(false);
  });
  it("requires exactly the selected credential and disallows routed subscriptions", () => {
    const input = {
      provider: "openai",
      method: "api_key",
      name: "Local",
      ownership: "personal",
      routing: {
        kind: "local",
        protocol: "responses",
        auth: "none",
        baseUrl: "http://localhost:11434/v1",
      },
    };
    expect(createAiConnectionSchema.safeParse(input).success).toBe(true);
    expect(
      createAiConnectionSchema.safeParse({ ...input, apiKey: "unwanted" })
        .success,
    ).toBe(false);
    expect(
      createAiConnectionSchema.safeParse({
        ...input,
        method: "subscription",
        loginSessionId: "session",
      }).success,
    ).toBe(false);
  });
  it("rejects unsupported protocols and excluded remote adapters", () => {
    const routing = aiProviderRoutingSchema.parse({
      kind: "gateway",
      protocol: "chat",
      baseUrl: "https://gateway.example/v1",
    });
    for (const adapter of [
      "codex_local",
      "claude_local",
      "http",
      "process",
      "openclaw_gateway",
      "hermes_gateway",
      "acpx_local",
    ])
      expect(
        isAiConnectionCompatible(
          { provider: "openai", method: "api_key", routing },
          adapter,
        ),
      ).toBe(false);
    expect(
      isAiConnectionCompatible(
        { provider: "openai", method: "api_key", routing },
        "opencode_local",
      ),
    ).toBe(true);
    expect(
      isAiConnectionCompatible(
        { provider: "openai", method: "api_key", routing },
        "pilibala_runner",
        "model",
        "aws_agentcore",
      ),
    ).toBe(false);
  });
  it("projects managed opencode models with resolvable pilibala effort variants", () => {
    const routing = aiProviderRoutingSchema.parse({ kind: "gateway", protocol: "chat", auth: "bearer", baseUrl: "https://integrate.api.nvidia.com/v1" });
    const projected = managedProviderRouting(routing, "opencode_local", "selected-key", "nvidia/minimaxai/minimax-m3.1-flash");
    const content = JSON.parse(projected.env.OPENCODE_CONFIG_CONTENT as string);
    const variants = content.provider.pilibala.models["nvidia/minimaxai/minimax-m3.1-flash"].variants;
    expect(variants["pilibala-low"]).toEqual({ reasoning_effort: "low" });
    expect(variants["pilibala-high"]).toEqual({ reasoning_effort: "high" });
  });
  it.each(["gateway", "openrouter"] as const)("uses a terminal-filtered secret variable for Hermes %s authentication", kind => {
    const route = aiProviderRoutingSchema.parse({ kind, protocol: "chat", auth: "bearer", ...(kind === "gateway" ? { baseUrl: "https://gateway.example/v1" } : {}) });
    const projected = managedProviderRouting(route, "hermes_local", "selected-key", "fixture-model");
    // Hermes scrubs known credential env keys from task children; the gateway
    // credential travels under a provider-scoped custom name that the
    // projected config's model.key_env pointer resolves at turn level.
    const gatewayKeyName = kind === "openrouter" ? "PILIBALA_OPENROUTER_KEY" : "PILIBALA_CUSTOM_KEY";
    expect(projected.env.OPENAI_API_KEY).toBe("selected-key");
    expect(projected.env[gatewayKeyName]).toBe("selected-key");
    expect(projected.env.PILIBALA_AI_PROVIDER_KEY).toBeUndefined();
    expect(projected.hermesConfig).toContain(`key_env: "${gatewayKeyName}"`);
    expect(projected.hermesConfig).toContain(`api_key: "\${${gatewayKeyName}}"`);
    expect(projected.hermesConfig).not.toContain("selected-key");
    expect(Object.entries(projected.env).filter(([, value]) => value === "selected-key").map(([name]) => name)).toEqual(kind === "openrouter" ? ["OPENAI_API_KEY", "OPENROUTER_API_KEY", gatewayKeyName] : ["OPENAI_API_KEY", gatewayKeyName]);
  });
  it("keeps an explicit provider association on a managed NVIDIA Hermes gateway", () => {
    const routing = aiProviderRoutingSchema.parse({
      kind: "gateway",
      protocol: "chat",
      auth: "bearer",
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });
    const projected = managedProviderRouting(routing, "hermes_local", "selected-key", "z-ai/glm-5.3-flash");
    expect(projected.config.provider).toBe("nvidia");
    expect(projected.hermesConfig).toContain("\"nvidia\"");
  });
  it("routes OpenRouter through each harness's protocol without putting secrets in Codex config", () => {
    const routing = aiProviderRoutingSchema.parse({
      kind: "openrouter",
      protocol: "responses",
    });
    const codex = managedProviderRouting(
      routing,
      "codex_local",
      "fixture-secret",
      "openai/gpt-5.4",
    );
    expect(codex.codexConfig).toContain('wire_api = "responses"');
    expect(codex.codexConfig).not.toContain("fixture-secret");
    const claude = managedProviderRouting(
      routing,
      "claude_local",
      "fixture-secret",
      "anthropic/claude-sonnet-4.6",
    );
    expect(claude.env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
    expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe("fixture-secret");
    expect(claude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
      "anthropic/claude-sonnet-4.6",
    );
    const opencode = managedProviderRouting(
      routing,
      "opencode_local",
      "fixture-secret",
      "anthropic/claude-sonnet-4.6",
    );
    expect(opencode.config.model).toBe(
      "openrouter/anthropic/claude-sonnet-4.6",
    );
  });
  it("projects only a Bedrock API key and rejects general AWS access keys", () => {
    const routing = aiProviderRoutingSchema.parse({
      kind: "bedrock",
      protocol: "bedrock",
      auth: "bearer",
      region: "us-east-1",
    });
    const projected = managedProviderRouting(
      routing,
      "claude_local",
      "fixture-bedrock-key",
      "bedrock-model",
    );
    expect(projected.env).toMatchObject({
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_REGION: "us-east-1",
      AWS_BEARER_TOKEN_BEDROCK: "fixture-bedrock-key",
      AWS_EC2_METADATA_DISABLED: "true",
    });
    expect(aiProviderRoutingSchema.safeParse({ ...routing, auth: "aws_credentials" }).success).toBe(false);
    for (const key of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) expect(projected.env).not.toHaveProperty(key);
  });
});
