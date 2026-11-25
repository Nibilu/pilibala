// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AdapterConfigFieldsProps } from "../types";
import { PiLocalConfigFields } from "./config-fields";
import { invalidateConfigSchemaCache } from "../schema-config-fields";
import { TooltipProvider } from "../../components/ui/tooltip";

// The schema the server route serves for pi_local (AMB-333): run-log
// quiet/verbose mode, Pilibala API URL override, prompt template.
const PI_LOCAL_SCHEMA = {
  fields: [
    {
      key: "stdoutLogMode",
      label: "Run log output (quiet / verbose)",
      type: "select",
      default: "compact",
      options: [
        { value: "compact", label: "Quiet — compact run log (default)" },
        { value: "raw", label: "Verbose — raw full transcript" },
      ],
      hint: "Pi has no --quiet flag.",
    },
    { key: "pilibalaApiUrl", label: "Pilibala API URL", type: "text" },
    { key: "promptTemplate", label: "Prompt template", type: "textarea" },
  ],
};

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  invalidateConfigSchemaCache("pi_local");
});

function editProps(overrides: Partial<AdapterConfigFieldsProps> = {}): AdapterConfigFieldsProps {
  return {
    mode: "edit",
    isCreate: false,
    adapterType: "pi_local",
    section: "configuration",
    values: null,
    set: null,
    config: { instructionsFilePath: "/tmp/AGENTS.md", stdoutLogMode: "raw" },
    eff: (_group, _field, original) => original,
    mark: vi.fn(),
    models: [],
    ...overrides,
  };
}

async function renderProps(props: AdapterConfigFieldsProps) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <TooltipProvider>
        <PiLocalConfigFields {...props} />
      </TooltipProvider>,
    );
  });
  return container;
}

it("renders the schema settings and the instructions-file field in the configuration section", async () => {
  invalidateConfigSchemaCache("pi_local");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => PI_LOCAL_SCHEMA }));
  const mark = vi.fn();
  const container = await renderProps(editProps({ mark }));
  const fetchCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
  expect(fetchCalls).toContain("/api/adapters/pi_local/config-schema");
  // Edit-mode read path: the stored stdoutLogMode drives the select label,
  // and the schema text/textarea fields join the instructions-file field.
  expect(container.textContent).toContain("Run log output (quiet / verbose)");
  expect(container.textContent).toContain("Verbose — raw full transcript");
  expect(container.textContent).toContain("Pilibala API URL");
  expect(container.textContent).toContain("Prompt template");
  expect(container.textContent).toContain("Agent instructions file");
  expect(mark).not.toHaveBeenCalled();
});

it("keeps non-configuration sections empty for pi_local", async () => {
  invalidateConfigSchemaCache("pi_local");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => PI_LOCAL_SCHEMA }));
  for (const section of ["adapter", "advanced", "runPolicy"] as const) {
    const container = await renderProps(editProps({ section }));
    expect(container.textContent).toBe("");
  }
});
