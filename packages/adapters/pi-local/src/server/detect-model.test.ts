import { chmod, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPiModel, resolvePiDetectCommand } from "./detect-model.js";
import { discoverPiModels } from "./models.js";

vi.mock("./models.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverPiModels: vi.fn(),
}));

const discoverMock = vi.mocked(discoverPiModels);

afterEach(async () => {
  discoverMock.mockReset();
  delete process.env.PILIBALA_PI_COMMAND;
  for (const dir of homes.splice(0)) await rm(dir, { recursive: true, force: true });
});

const homes: string[] = [];
async function fixturePiHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "pi-detect-"));
  homes.push(home);
  const bin = join(home, ".pi", "agent", "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return home;
}

describe("detectPiModel", () => {
  it("prefers PILIBALA_PI_COMMAND, then the managed agent home, then PATH", async () => {
    const home = await fixturePiHome();
    process.env.PILIBALA_PI_COMMAND = "pi-from-env";
    expect(await resolvePiDetectCommand()).toBe("pi-from-env");
    delete process.env.PILIBALA_PI_COMMAND;
    const savedHome = process.env.HOME;
    process.env.HOME = home;
    try {
      expect(await resolvePiDetectCommand()).toBe(join(home, ".pi", "agent", "bin", "pi"));
    } finally {
      process.env.HOME = savedHome ?? undefined;
    }
    // A HOME without a managed pi home → PATH lookup stays the default
    // (independent of whatever the test host itself has installed).
    const emptyHome = await mkdtemp(join(tmpdir(), "pi-detect-empty-"));
    homes.push(emptyHome);
    const savedHome2 = process.env.HOME;
    process.env.HOME = emptyHome;
    try {
      expect(await resolvePiDetectCommand()).toBe("pi");
    } finally {
      process.env.HOME = savedHome2 ?? undefined;
    }
  });

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
