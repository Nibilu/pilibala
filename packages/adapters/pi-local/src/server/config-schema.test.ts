import { describe, expect, it } from "vitest";
import { getConfigSchema } from "./config-schema.js";

/**
 * AMB-333: pi_local Harness/Runtime settings mirror hermes_local's
 * declarative config-schema UX. Pi's CLI has no --quiet flag and its
 * --verbose flag only affects interactive TUI startup, so the honest
 * quiet/verbose control is the run-log compaction mode that execute.ts
 * already consumes via resolvePiStdoutLogMode(config).
 */
describe("pi_local adapter config schema (AMB-333)", () => {
  const schema = getConfigSchema();
  const field = (key: string) => schema.fields.find((f) => f.key === key);

  it("exposes exactly the settings execute.ts consumes", () => {
    expect(schema.fields.map((f) => f.key)).toEqual([
      "stdoutLogMode",
      "pilibalaApiUrl",
      "promptTemplate",
    ]);
  });

  it("maps quiet/verbose to the run-log compaction select", () => {
    const stdoutLogMode = field("stdoutLogMode");
    expect(stdoutLogMode?.type).toBe("select");
    expect(stdoutLogMode?.default).toBe("compact");
    expect(stdoutLogMode?.options?.map((option) => option.value)).toEqual([
      "compact",
      "raw",
    ]);
    const hint = String(stdoutLogMode?.hint ?? "");
    expect(hint).toContain("no --quiet");
    expect(hint).toContain("run-log");
  });

  it("describes the pilibalaApiUrl override scope honestly", () => {
    const pilibalaApiUrl = field("pilibalaApiUrl");
    expect(pilibalaApiUrl?.type).toBe("text");
    const hint = String(pilibalaApiUrl?.hint ?? "");
    expect(hint).toContain("append /api themselves");
    expect(hint).toContain("sandbox bridge URL wins");
  });

  it("exposes the prompt template as a textarea", () => {
    expect(field("promptTemplate")?.type).toBe("textarea");
  });
});
