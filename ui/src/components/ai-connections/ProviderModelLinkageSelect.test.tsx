// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AiConnectionBinding, AiManagedConnectionSummary } from "@pilibalaai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { useProviderModelLinkage, ProviderModelLinkageModelSelect } from "./ProviderModelLinkageSelect";

vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: { list: vi.fn() } }));

const companyAccount: AiManagedConnectionSummary = {
  id: "a0000000-0000-4000-8000-00000000000a", grantId: "a0000000-0000-4000-8000-0000000000aa", companyId: "company", provider: "openrouter", method: "api_key",
  name: "Company OpenRouter", ownership: "shared", isDefault: false, status: "connected",
  routing: { kind: "openrouter", protocol: "chat", auth: "bearer", models: [{ id: "openrouter/z-ai/glm-5" }] },
};
const claudeAccount: AiManagedConnectionSummary = {
  id: "b0000000-0000-4000-8000-00000000000b", grantId: "b0000000-0000-4000-8000-0000000000bb", companyId: "company", provider: "openrouter", method: "api_key",
  name: "Claude via OpenRouter", ownership: "shared", isDefault: false, status: "connected",
  routing: { kind: "openrouter", protocol: "chat", auth: "bearer", models: [{ id: "openrouter/anthropic/claude-sonnet-4.5" }] },
};

const bindingA: AiConnectionBinding = { provider: "openrouter", method: "api_key", mode: "shared", connectionId: "a0000000-0000-4000-8000-00000000000a", grantId: "a0000000-0000-4000-8000-0000000000aa" };

let root: Root | null = null;
let client: QueryClient | null = null;

beforeEach(() => {
  vi.mocked(aiConnectionsApi.list).mockResolvedValue({
    currentUserId: "you",
    connections: [companyAccount, claudeAccount],
    canManageConnections: true,
  });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  client?.clear();
  client = null;
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

function mount(ui: React.ReactNode, queryData: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (queryData) {
    // Seed both caches — the repo's hook tests seed rather than await the
    // mock fetch (useConnectionModels.test.tsx does the same).
    const accounts = { currentUserId: "you", connections: [companyAccount, claudeAccount], canManageConnections: true };
    client.setQueryData(["ai-connections-linkage", "company"], accounts);
    client.setQueryData(["ai-connections", "company"], accounts);
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <StrictMode>
        <QueryClientProvider client={client!}>
          <TooltipProvider>{ui}</TooltipProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
  return container;
}

describe("useProviderModelLinkage", () => {
  it("falls back to the site catalog when no binding is set", async () => {
    let snapshot: ReturnType<typeof useProviderModelLinkage> | null = null;
    const fallback = [{ id: "host-default-model", label: "Host model" }];
    function Probe() {
      snapshot = useProviderModelLinkage({
        companyId: "company",
        harness: "opencode_local",
        linkageDisabled: false,
        onAutoRebind: vi.fn(),
        onModelSelect: vi.fn(),
        modelValue: "host-default-model",
        binding: undefined,
        fallbackModels: fallback,
        providerBaseUrl: null,
      });
      return null;
    }
    mount(<Probe />, true);
    await act(async () => {});
    expect(snapshot!.connectionModels).toBeUndefined();
    expect(snapshot!.models).toEqual(fallback);
    expect(snapshot!.autoReboundConnection).toBeNull();
  });

  it("uses the bound connection's catalog and prefixes model ids for the harness", async () => {
    let snapshot: ReturnType<typeof useProviderModelLinkage> | null = null;
    function Probe() {
      snapshot = useProviderModelLinkage({
        companyId: "company",
        harness: "opencode_local",
        linkageDisabled: false,
        onAutoRebind: vi.fn(),
        onModelSelect: vi.fn(),
        modelValue: "openrouter/z-ai/glm-5",
        binding: bindingA,
        fallbackModels: [],
        providerBaseUrl: null,
      });
      return null;
    }
    mount(<Probe />, true);
    await act(async () => {});
    await vi.waitFor(() => {
      expect(snapshot!.connectionModels).toBeDefined();
    });
    expect(snapshot!.models.map((m) => m.id)).toContain("openrouter/z-ai/glm-5");
  });

  it("rebinds to the compatible connection that serves the chosen model, once", async () => {
    const onAutoRebind = vi.fn();
    let snapshot: ReturnType<typeof useProviderModelLinkage> | null = null;
    function Probe() {
      snapshot = useProviderModelLinkage({
        companyId: "company",
        harness: "opencode_local",
        linkageDisabled: false,
        onAutoRebind,
        onModelSelect: vi.fn(),
        // Chosen model lives on the Claude connection, not the bound one.
        modelValue: "openrouter/anthropic/claude-sonnet-4.5",
        binding: bindingA,
        fallbackModels: [],
        providerBaseUrl: null,
      });
      return null;
    }
    mount(<Probe />, true);
    await act(async () => {});
    expect(onAutoRebind).toHaveBeenCalledTimes(1);
    expect(onAutoRebind).toHaveBeenCalledWith("Claude via OpenRouter", {
      provider: "openrouter",
      method: "api_key",
      mode: "shared",
      connectionId: "b0000000-0000-4000-8000-00000000000b",
      grantId: "b0000000-0000-4000-8000-0000000000bb",
    });
    expect(snapshot!.autoReboundConnection).toBe("Claude via OpenRouter");
    // A re-render with the same inputs must not re-fire the rebind.
    await act(async () => {});
    expect(onAutoRebind).toHaveBeenCalledTimes(1);
  });

  it("does not rebind when the bound connection serves the chosen model", async () => {
    const onAutoRebind = vi.fn();
    function Probe() {
      useProviderModelLinkage({
        companyId: "company",
        harness: "opencode_local",
        linkageDisabled: false,
        onAutoRebind,
        onModelSelect: vi.fn(),
        modelValue: "openrouter/z-ai/glm-5",
        binding: bindingA,
        fallbackModels: [],
        providerBaseUrl: null,
      });
      return null;
    }
    mount(<Probe />, true);
    await act(async () => {});
    expect(onAutoRebind).not.toHaveBeenCalled();
  });

  it("does not rebind when linkage is disabled", async () => {
    const onAutoRebind = vi.fn();
    function Probe() {
      useProviderModelLinkage({
        companyId: "company",
        harness: "opencode_local",
        linkageDisabled: true,
        onAutoRebind,
        onModelSelect: vi.fn(),
        modelValue: "openrouter/anthropic/claude-sonnet-4.5",
        binding: bindingA,
        fallbackModels: [],
        providerBaseUrl: null,
      });
      return null;
    }
    mount(<Probe />, true);
    await act(async () => {});
    expect(onAutoRebind).not.toHaveBeenCalled();
  });
});

describe("ProviderModelLinkageModelSelect", () => {
  it("renders the dropdown with the fallback catalog and surfaces the rebind notice", async () => {
    const container = mount(
      <ProviderModelLinkageModelSelect
        companyId="company"
        harness="opencode_local"
        linkageDisabled={false}
        onAutoRebind={vi.fn()}
        onModelSelect={vi.fn()}
        modelValue="openrouter/anthropic/claude-sonnet-4.5"
        binding={bindingA}
        fallbackModels={[]}
        providerBaseUrl={null}
        modelDropdownProps={{ allowDefault: false, required: true, groupByProvider: false }}
      />,
      true,
    );
    await act(async () => {});
    expect(container.querySelector('[role="listbox"][aria-label="Model"]')).toBeNull(); // dropdown starts closed
    expect(document.body.querySelector('[role="combobox"], button, [role="button"]')).not.toBeNull();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Switched the AI connection to “Claude via OpenRouter” so the selected model is served by its catalog.",
      );
    }, { timeout: 4000, interval: 50 });
  });
});
