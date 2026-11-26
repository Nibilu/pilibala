import { describe, expect, it } from "vitest";
import { hasAgentSetupHold } from "./agent-lifecycle.js";

describe("hasAgentSetupHold", () => {
  it("uses lifecycle holds as the authoritative setup state", () => {
    expect(hasAgentSetupHold({ lifecycleHolds: ["setup"], pauseReason: "setup" })).toBe(true);
    expect(hasAgentSetupHold({ lifecycleHolds: [], pauseReason: "setup" })).toBe(false);
    expect(hasAgentSetupHold({ lifecycleHolds: ["manual"], pauseReason: "setup" })).toBe(false);
  });

  it("falls back to the legacy pause reason when lifecycle holds are absent", () => {
    expect(hasAgentSetupHold({ pauseReason: "setup" })).toBe(true);
    expect(hasAgentSetupHold({ pauseReason: "manual" })).toBe(false);
  });
});
