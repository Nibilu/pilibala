import { describe, expect, it } from "vitest";
import { getConfigSchema } from "./config-schema.js";

/**
 * AMB-333: pi_local Harness/Runtime settings mirror hermes_local's
 * declarative config-schema UX. Pi's CLI has no --quiet flag and its
 * --verbose flag only affects interactive TUI startup. Under the orthogonal
 * output contract (AMB-385, docs/design/quiet-verbose-output-contract.md)
 * Quiet is presentation-only and Verbose keeps the lossless raw run log;
 * Pi's compaction default stays an internal stdoutLogMode concern.
 */
describe("pi_local adapter config schema (AMB-333)", () => {
  const schema = getConfigSchema();
  const field = (key: string) => schema.fields.find((f) => f.key === key);

  it("exposes exactly the settings execute.ts consumes", () => {
    expect(schema.fields.map((f) => f.key)).toEqual([
      "quiet",
      "verbose",
      "pilibalaApiUrl",
      "promptTemplate",
    ]);
  });

  it("states the orthogonal quiet/verbose contract (AMB-389)", () => {
    const quiet = field("quiet");
    expect(quiet?.type).toBe("toggle");
    expect(quiet?.default).toBe(true);
    expect(String(quiet?.hint ?? "")).toContain("presentation-only");
    expect(String(quiet?.hint ?? "")).toContain("Does not change Pi's persisted run log");

    const verbose = field("verbose");
    expect(verbose?.type).toBe("toggle");
    expect(verbose?.default).toBe(false);
    expect(String(verbose?.hint ?? "")).toContain("full raw JSONL stream");
    expect(String(verbose?.hint ?? "")).toContain("orthogonal");
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
