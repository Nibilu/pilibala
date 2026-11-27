import { describe, expect, it } from "vitest";
import { getConfigSchema } from "./config-schema.js";

/**
 * hermes_gateway key parity with the orthogonal output contract (AMB-385
 * follow-up): the gateway lane previously declared neither output-visibility
 * key nor a prompt template, so its harness settings had no entries and the
 * config-schema API understated the adapter's actual surface. These fields
 * mirror hermes_local's semantics adapted to the gateway lane:
 * - quiet stays presentation-only (the gateway run log is never filtered);
 * - verbose adds one [pilibala][verbose] diagnostics line to the run log;
 * - promptTemplate renders as an additional section of the wake input.
 */
describe("hermes_gateway adapter config schema (orthogonal contract)", () => {
  const schema = getConfigSchema();
  const field = (key: string) => schema.fields.find((f) => f.key === key);

  it("declares quiet/verbose with false defaults and contract hints", () => {
    expect(field("quiet")?.type).toBe("toggle");
    expect(field("quiet")?.default).toBe(false);
    expect(field("verbose")?.type).toBe("toggle");
    expect(field("verbose")?.default).toBe(false);
    const quietHint = String(field("quiet")?.hint ?? "");
    expect(quietHint).toContain("presentation-only");
    expect(quietHint).toContain("Does not change the gateway run log");
    const verboseHint = String(field("verbose")?.hint ?? "");
    expect(verboseHint).toContain("orthogonal");
    expect(verboseHint).toContain("[pilibala][verbose]");
    expect(verboseHint).toContain("Never changes the rendered transcript");
  });

  it("declares promptTemplate as an additional rendered wake-input section", () => {
    expect(field("promptTemplate")?.type).toBe("textarea");
    const hint = String(field("promptTemplate")?.hint ?? "");
    expect(hint).toContain("{{variable}}");
    expect(hint).toContain("additional section");
  });

  it("keeps the pre-existing gateway surface intact", () => {
    for (const key of ["apiBaseUrl", "apiKey", "sessionKeyStrategy", "timeoutSec", "eventReconnectMs", "pilibalaApiUrl", "headers", "instructions"]) {
      expect(field(key), `missing declared field: ${key}`).toBeTruthy();
    }
  });
});
