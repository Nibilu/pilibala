import { describe, expect, it } from "vitest";

import {
  attributeModelProvider,
  deriveCatalogProviders,
  groupModelsByProvider,
  normalizeModelEntry,
  resolveCatalogRoutingKind,
} from "./model-selection";

describe("normalizeModelEntry", () => {
  it("converts the vendor:model display convention to the slash storage form", () => {
    expect(normalizeModelEntry("minimaxai: minimax-m3.1-flash")).toBe("minimaxai/minimax-m3.1-flash");
    expect(normalizeModelEntry("minimaxai:minimax-m3.1-flash")).toBe("minimaxai/minimax-m3.1-flash");
    expect(normalizeModelEntry("  openrouter:anthropic/claude-sonnet-4.5  ")).toBe("openrouter/anthropic/claude-sonnet-4.5");
  });

  it("leaves Hermes-native custom: references and multi-colon ids untouched", () => {
    expect(normalizeModelEntry("custom:proxy-router:qwen2.5-72b-instruct")).toBe("custom:proxy-router:qwen2.5-72b-instruct");
    expect(normalizeModelEntry("custom:qwen")).toBe("custom:qwen");
    expect(normalizeModelEntry("a:b:c")).toBe("a:b:c");
  });

  it("passes plain slash ids and bare names through trimmed", () => {
    expect(normalizeModelEntry("  minimaxai/minimax-m3.1-flash  ")).toBe("minimaxai/minimax-m3.1-flash");
    expect(normalizeModelEntry("bare-model")).toBe("bare-model");
    expect(normalizeModelEntry(' "quoted/id" ')).toBe("quoted/id");
    expect(normalizeModelEntry("")).toBe("");
  });
});

describe("resolveCatalogRoutingKind", () => {
  it("prefers the connection's routing kind", () => {
    expect(resolveCatalogRoutingKind({ kind: "gateway", protocol: "chat", auth: "bearer" }, { provider: "openrouter" } as never)).toBe("gateway");
  });

  it("maps a legacy OpenRouter connection without routing metadata to openrouter", () => {
    expect(resolveCatalogRoutingKind(undefined, { provider: "openrouter" } as never)).toBe("openrouter");
  });

  it("stays unscoped without routing or an openrouter binding", () => {
    expect(resolveCatalogRoutingKind(undefined, { provider: "nvidia" } as never)).toBeUndefined();
    expect(resolveCatalogRoutingKind(undefined, undefined)).toBeUndefined();
  });
});

describe("attributeModelProvider", () => {
  const nvidiaId = "minimaxai/minimax-m3.1-flash";

  it("carries no provider dimension for connection-attributed catalogs", () => {
    // The connection's provider field names the ACCOUNT type (an "openai"-
    // type connection may be an nvidia NIM gateway), and the id prefix is a
    // vendor namespace — neither is a truthful serving provider (AMB-326).
    // The catalog is presented whole; search reaches every model.
    expect(attributeModelProvider(nvidiaId, { routingKind: "gateway", connectionProvider: "openai" })).toBeNull();
    expect(attributeModelProvider("z-ai/glm-5.3-flash", { routingKind: "local" })).toBeNull();
    expect(attributeModelProvider("region/model", { routingKind: "bedrock" })).toBeNull();
  });

  it("keeps the id-prefix attribution for prefix-derived catalogs", () => {
    // openrouter vendor slugs and registry-qualified adapter ids.
    expect(attributeModelProvider("anthropic/claude-sonnet-4.5", { routingKind: "openrouter" })).toBe("anthropic");
    expect(attributeModelProvider("nvidia/minimaxai/minimax-m3.1-flash", {})).toBe("nvidia");
    expect(attributeModelProvider("nvidia/minimaxai/minimax-m3.1-flash", { routingKind: "openrouter" })).toBe("nvidia");
  });

  it("returns null for unattributable ids on prefix-derived catalogs", () => {
    expect(attributeModelProvider("bare-model", {})).toBeNull();
    expect(attributeModelProvider("", {})).toBeNull();
  });
});

describe("deriveCatalogProviders", () => {
  it("yields an empty set for connection-attributed catalogs (no provider row)", () => {
    const models = [
      { id: "minimaxai/minimax-m3.1-flash" },
      { id: "z-ai/glm-5.3-flash" },
      { id: "google/gemma-3-12b-it" },
    ];
    expect(deriveCatalogProviders(models, { routingKind: "gateway", connectionProvider: "openai" })).toEqual([]);
    expect(deriveCatalogProviders(models, { routingKind: "local" })).toEqual([]);
  });

  it("derives the prefix set for prefix-derived catalogs", () => {
    const models = [
      { id: "nvidia/minimaxai/minimax-m3.1-flash" },
      { id: "nvidia/z-ai/glm-5.3-flash" },
      { id: "openrouter/anthropic/claude-sonnet-4.5" },
      { id: "bare-model" },
    ];
    expect(deriveCatalogProviders(models, {})).toEqual(["nvidia", "openrouter"]);
  });
});

describe("groupModelsByProvider", () => {
  const models = [
    { id: "minimaxai/minimax-m3.1-flash", label: "M3.1 Flash" },
    { id: "z-ai/glm-5.3-flash", label: "GLM" },
  ];

  it("groups an unscoped catalog by the id prefix and sorts entries", () => {
    const grouped = groupModelsByProvider(models, {});
    expect(grouped).toEqual([
      { provider: "minimaxai", entries: [models[0]] },
      { provider: "z-ai", entries: [models[1]] },
    ]);
  });

  it("keeps the caller's order inside groups with preserveOrder", () => {
    const ordered = [
      { id: "minimaxai/z-ai-flash", label: "Z-AI Flash" },
      { id: "minimaxai/minimax-m3.1-flash", label: "M3.1 Flash" },
    ];
    const grouped = groupModelsByProvider(ordered, {}, { preserveOrder: true });
    expect(grouped).toEqual([{ provider: "minimaxai", entries: ordered }]);
  });

  it("falls back to the 'other' group for unattributable ids", () => {
    expect(groupModelsByProvider([{ id: "bare-model" }], {})).toEqual([
      { provider: "other", entries: [{ id: "bare-model" }] },
    ]);
  });
});
