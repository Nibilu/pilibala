import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The adapter packages resolve through the workspace install; mock their
// resolvers so this suite tests the SERVICE's probe table, caching and
// concurrency without depending on built package dists.
vi.mock("@pilibalaai/adapter-pi-local/server", () => ({ resolvePiCliCommand: () => "pi" }));
vi.mock("@pilibalaai/hermes-pilibala-adapter/server", () => ({ resolveHermesCommand: () => "hermes" }));
import {
  probeCliVersion,
  readAdapterAvailability,
  resetAdapterAvailabilityCacheForTests,
} from "../services/adapter-availability.js";

/**
 * Local CLI deployment probe (AMB-311 plan §3): bounded `--version` probes,
 * honest failure semantics, concurrency cap, and the short-TTL cache.
 */

describe("adapter availability", () => {
  beforeEach(() => resetAdapterAvailabilityCacheForTests());
  afterEach(() => {
    resetAdapterAvailabilityCacheForTests();
    vi.restoreAllMocks();
  });

  it("reports every probed CLI harness exactly once", async () => {
    const rows = await readAdapterAvailability({
      probe: async () => "x 1.0",
    });
    const types = rows.map((row) => row.type).sort();
    expect(types).toEqual([
      "claude_local", "codex_local", "cursor", "gemini_local", "grok_local",
      "hermes_local", "kimi_local", "opencode_local", "pi_local",
    ]);
    for (const row of rows) {
      expect(row.deployed).toBe(true);
      expect(row.version).toBe("x 1.0");
    }
  });

  it("marks a failed probe as not deployed without a version", async () => {
    const rows = await readAdapterAvailability({
      probe: async (command) => (command === "codex" ? "codex-cli 0.162.1" : null),
    });
    const codex = rows.find((row) => row.type === "codex_local");
    const claude = rows.find((row) => row.type === "claude_local");
    expect(codex).toMatchObject({ deployed: true, version: "codex-cli 0.162.1" });
    expect(claude).toEqual({ type: "claude_local", deployed: false });
  });

  it("caches results within the TTL and refreshes past it or on demand", async () => {
    let clock = 1_000;
    const probe = vi.fn(async () => "v1");
    const probesPerPass = 9; // one probe per CLI harness
    await readAdapterAvailability({ probe, now: () => clock });
    await readAdapterAvailability({ probe, now: () => clock });
    expect(probe).toHaveBeenCalledTimes(probesPerPass);

    clock += 6 * 60 * 1000; // past the 5-minute TTL
    await readAdapterAvailability({ probe, now: () => clock });
    expect(probe).toHaveBeenCalledTimes(probesPerPass * 2);

    clock += 1_000; // inside the fresh TTL, but explicit refresh bypasses it
    await readAdapterAvailability({ probe, now: () => clock, refresh: true });
    expect(probe).toHaveBeenCalledTimes(probesPerPass * 3);
  });

  it("caps concurrent probes at three", async () => {
    let inFlight = 0;
    let peak = 0;
    const rows = await readAdapterAvailability({
      probe: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return "v1";
      },
    });
    expect(rows).toHaveLength(9);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("treats a rejected probe as not deployed instead of throwing", async () => {
    const rows = await readAdapterAvailability({
      probe: async () => {
        throw new Error("probe crashed");
      },
    });
    expect(rows.every((row) => row.deployed === false)).toBe(true);
  });

  it("resolves null for a command that cannot spawn", async () => {
    await expect(probeCliVersion("/nonexistent/definitely-missing-cli")).resolves.toBeNull();
  });
});
