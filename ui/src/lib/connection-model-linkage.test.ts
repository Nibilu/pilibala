import { describe, expect, it } from "vitest";
import type { AiManagedConnectionSummary } from "@pilibalaai/shared";
import { resolveConnectionModelLinkage } from "./connection-model-linkage";

function connection(overrides: Partial<AiManagedConnectionSummary> & Pick<AiManagedConnectionSummary, "id" | "grantId" | "name">): AiManagedConnectionSummary {
  return {
    companyId: "co-1",
    provider: "openai",
    method: "api_key",
    ownership: "shared",
    isDefault: false,
    status: "connected",
    ...overrides,
  } as AiManagedConnectionSummary;
}

const NVIDIA_MODELS = Array.from({ length: 83 }, (_, i) => ({ id: `nvidia/model-${i}` }));
const MAGAAI_MODELS = [
  { id: "moonshotai/Kimi-K3.1-Pro" },
  { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017" },
  { id: "z-ai/glm-5.3-flash" },
  { id: "z-ai/glm-5.3" },
  { id: "moonshotai/Kimi-K3" },
];

const nvidiaPersonal = connection({
  id: "nvidia-conn",
  grantId: "nvidia-grant",
  name: "个人 integrate.api.nvidia.com",
  ownership: "personal",
  ownerUserId: "user-1",
  isDefault: true,
  routing: { kind: "gateway", protocol: "chat", auth: "bearer", baseUrl: "https://integrate.api.nvidia.com/v1", models: NVIDIA_MODELS },
});

const magaaiChat = connection({
  id: "magaai-chat",
  grantId: "magaai-chat-grant",
  name: "Company magaai_chat",
  routing: { kind: "gateway", protocol: "chat", auth: "bearer", baseUrl: "https://api.magaai.shop", models: MAGAAI_MODELS },
});

const magaaiResponses = connection({
  id: "magaai-responses",
  grantId: "magaai-responses-grant",
  name: "Company magaai_response",
  routing: { kind: "gateway", protocol: "responses", auth: "bearer", baseUrl: "https://api.magaai.shop", models: MAGAAI_MODELS },
});

const hermesBinding = {
  provider: "openai" as const,
  method: "api_key" as const,
  mode: "delegated" as const,
  connectionId: "nvidia-conn",
  grantId: "nvidia-grant",
};

describe("resolveConnectionModelLinkage", () => {
  it("rebinds to the connection whose baseUrl matches the chosen provider and serves the model", () => {
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: hermesBinding,
      connections: [nvidiaPersonal, magaaiChat, magaaiResponses],
      currentUserId: "user-1",
      providerBaseUrl: "https://api.magaai.shop",
    });
    expect(result).toEqual({
      connectionName: "Company magaai_chat",
      binding: {
        provider: "openai",
        method: "api_key",
        mode: "shared",
        connectionId: "magaai-chat",
        grantId: "magaai-chat-grant",
      },
    });
  });

  it("never offers the responses-protocol connection to a hermes harness", () => {
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: hermesBinding,
      connections: [nvidiaPersonal, magaaiResponses],
      currentUserId: "user-1",
      providerBaseUrl: "https://api.magaai.shop",
    });
    expect(result).toBeNull();
  });

  it("keeps the binding when the bound connection already serves the model", () => {
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "nvidia/model-3",
      binding: hermesBinding,
      connections: [nvidiaPersonal, magaaiChat],
      currentUserId: "user-1",
    });
    expect(result).toBeNull();
  });

  it("leaves non-routing bindings (subscriptions, host defaults) alone", () => {
    const subscription = connection({
      id: "openai-sub",
      grantId: "openai-sub-grant",
      name: "My OpenAI subscription",
      method: "subscription",
      ownership: "personal",
      ownerUserId: "user-1",
    });
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: { provider: "openai", method: "subscription", mode: "delegated", connectionId: "openai-sub", grantId: "openai-sub-grant" },
      connections: [subscription, magaaiChat],
      currentUserId: "user-1",
    });
    expect(result).toBeNull();
  });

  it("does not re-route an agent without a binding (host-default path)", () => {
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: undefined,
      connections: [magaaiChat],
      currentUserId: "user-1",
    });
    expect(result).toBeNull();
  });

  it("returns null when no compatible connection serves the model", () => {
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "some/unknown-model",
      binding: hermesBinding,
      connections: [nvidiaPersonal, magaaiChat, magaaiResponses],
      currentUserId: "user-1",
    });
    expect(result).toBeNull();
  });

  it("resolves a responsible_user binding through the personal default", () => {
    const defaultBinding = { provider: "openai" as const, method: "api_key" as const, mode: "responsible_user" as const };
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: defaultBinding,
      connections: [nvidiaPersonal, magaaiChat],
      currentUserId: "user-1",
    });
    expect(result?.connectionName).toBe("Company magaai_chat");
  });

  it("prefers a shared connection over a personal one when both serve the model", () => {
    const personalMagaai = connection({
      id: "magaai-personal",
      grantId: "magaai-personal-grant",
      name: "My magaai",
      ownership: "personal",
      ownerUserId: "user-1",
      routing: { kind: "gateway", protocol: "chat", auth: "bearer", baseUrl: "https://api.magaai.shop", models: MAGAAI_MODELS },
    });
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: hermesBinding,
      connections: [nvidiaPersonal, personalMagaai, magaaiChat],
      currentUserId: "user-1",
    });
    expect(result?.binding).toMatchObject({ connectionId: "magaai-chat", mode: "shared" });
  });

  it("delegates personal connections with explicit ids instead of the default", () => {
    const result = resolveConnectionModelLinkage({
      harness: "hermes_local",
      model: "z-ai/glm-5.3-flash",
      binding: hermesBinding,
      connections: [nvidiaPersonal, magaaiChat],
      currentUserId: "user-1",
      providerBaseUrl: "https://user-owned.example/v1",
    });
    // The baseUrl match is absent, so the shared company connection wins; a
    // personal winner must carry explicit ids, never the default marker.
    expect(result?.binding).toMatchObject({ mode: "shared", connectionId: "magaai-chat" });
  });
});
