// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HermesGatewayConfigFields } from "./config-fields";
import type { AdapterConfigFieldsProps } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function renderFields(overrides: Partial<AdapterConfigFieldsProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const mark = vi.fn();
  const set = vi.fn();
  const props: AdapterConfigFieldsProps = {
    mode: "edit",
    isCreate: false,
    adapterType: "hermes_gateway",
    values: null,
    set: null,
    config: {},
    eff: (_group, _field, original) => original,
    mark,
    models: [],
    ...overrides,
  };

  act(() => {
    root.render(
      <TooltipProvider>
        <HermesGatewayConfigFields {...props} />
      </TooltipProvider>,
    );
  });

  return { container, root, mark, set };
}

describe("HermesGatewayConfigFields", () => {
  const roots: Root[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  it("shows the gateway URL and runtime fields in edit mode", () => {
    const result = renderFields({
      config: {
        apiBaseUrl: "http://127.0.0.1:8642",
        apiKey: { type: "secret_ref", secretId: "11111111-1111-4111-8111-111111111111", version: "latest" },
        pilibalaApiUrl: "http://127.0.0.1:3100",
        sessionKeyStrategy: "issue",
      },
    });
    roots.push(result.root);

    const text = result.container.textContent ?? "";
    expect(text).toContain("API base URL");
    expect(text).toContain("API key");
    expect(text).toContain("Pilibala API URL");
    expect(text).toContain("Session key strategy");
    expect(text).toContain("Timeout seconds");
    expect(text).toContain("Event reconnect ms");
    expect(text).toContain("Dangerously allow remote HTTP");
    expect(text).toContain("Extra headers");
    expect(text).toContain("Instructions");

    const urlInput = result.container.querySelector<HTMLInputElement>('input[value="http://127.0.0.1:8642"]');
    expect(urlInput).toBeTruthy();

    const apiKeyInput = Array.from(result.container.querySelectorAll<HTMLInputElement>('input[type="password"]'))
      .find((input) => input.placeholder.includes("Stored secret"));
    expect(apiKeyInput).toBeTruthy();

    expect(result.container.querySelector('button[aria-label="Show API key"]')).toBeTruthy();
  });

  it("renders the orthogonal-contract fields (quiet/verbose/promptTemplate)", () => {
    const result = renderFields({
      config: {
        quiet: true,
        verbose: false,
        promptTemplate: "Hello {{agentName}}",
      },
    });
    roots.push(result.root);

    const text = result.container.textContent ?? "";
    expect(text).toContain("Quiet output");
    expect(text).toContain("Verbose output");
    expect(text).toContain("Prompt template");

    // Persisted values drive the toggle states.
    expect(result.container.querySelector('button[aria-label="Quiet output"]')?.getAttribute("aria-checked")).toBe("true");
    expect(result.container.querySelector('button[aria-label="Verbose output"]')?.getAttribute("aria-checked")).toBe("false");
    // Several textareas render (headers, instructions, template) — find the
    // one carrying the persisted template value.
    const templateArea = Array.from(result.container.querySelectorAll("textarea"))
      .find((t) => t.value.includes("{{agentName}}"));
    expect(templateArea?.value).toBe("Hello {{agentName}}");
  });

  it("commits quiet/verbose toggles through mark()", () => {
    const result = renderFields({ config: { quiet: true } });
    roots.push(result.root);

    const verboseToggle = result.container.querySelector<HTMLButtonElement>('button[aria-label="Verbose output"]');
    expect(verboseToggle).toBeTruthy();
    act(() => verboseToggle!.click());
    expect(result.mark).toHaveBeenCalledWith("adapterConfig", "verbose", true);

    const quietToggle = result.container.querySelector<HTMLButtonElement>('button[aria-label="Quiet output"]');
    act(() => quietToggle!.click());
    expect(result.mark).toHaveBeenCalledWith("adapterConfig", "quiet", false);
  });
});
