import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPiModel } from "./detect-model.js";
import { discoverPiModelsCached } from "./models.js";

vi.mock("./models.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverPiModelsCached: vi.fn(),
}));

const discoverMock = vi.mocked(discoverPiModelsCached);

afterEach(() => {
  discoverMock.mockReset();
});

describe("detectPiModel", () => {
  it("reports deployed with the credential-gated catalog as candidates", async () => {
    discoverMock.mockResolvedValue([
      { id: "openrouter/z-ai/glm-5", label: "GLM" },
      { id: "openrouter/anthropic/claude-sonnet-4.5", label: "Claude" },
    ]);
    const detected = await detectPiModel();
    expect(detected).toEqual({
      model: "",
      provider: "",
      hasApiKey: true,
      deployed: true,
      candidates: ["openrouter/z-ai/glm-5", "openrouter/anthropic/claude-sonnet-4.5"],
      source: "probe",
    });
  });

  it("reports an installed pi without credentials as deployed but credential-free", async () => {
    discoverMock.mockResolvedValue([]);
    const detected = await detectPiModel();
    expect(detected?.deployed).toBe(true);
    expect(detected?.hasApiKey).toBe(false);
    expect(detected?.candidates).toEqual([]);
  });

  it("returns null when the pi probe fails (missing CLI) — unknown, not not-deployed", async () => {
    discoverMock.mockRejectedValue(new Error("`pi --list-models` failed."));
    expect(await detectPiModel()).toBeNull();
  });
});
