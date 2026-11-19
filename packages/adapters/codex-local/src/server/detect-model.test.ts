import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectCodexModel, parseCodexAuthShape, parseCodexConfigModel } from "./detect-model.js";

const dirs: string[] = [];
async function fixtureHome(files: Record<string, string>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "codex-detect-"));
  dirs.push(home);
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(join(home, name, ".."), { recursive: true });
    await writeFile(join(home, name), contents);
  }
  return home;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("detectCodexModel", () => {
  it("returns null when the Codex home is missing", async () => {
    expect(await detectCodexModel(join(tmpdir(), "codex-detect-missing-home"))).toBeNull();
  });

  it("parses the top-level model and defaults the provider to openai", async () => {
    const home = await fixtureHome({
      "config.toml": 'model = "gpt-6-luna"\nmodel_reasoning_effort = "medium"\n\n[projects."~/work"]\nmodel = "profile-scope-should-not-win"\n',
      "auth.json": JSON.stringify({ OPENAI_API_KEY: "sk-test" }),
    });
    const detected = await detectCodexModel(home);
    expect(detected).toEqual({
      model: "gpt-6-luna",
      provider: "openai",
      hasApiKey: true,
      deployed: true,
      source: "config",
    });
  });

  it("honors model_provider and treats token-based auth as a credential", async () => {
    const home = await fixtureHome({
      "config.toml": 'model_provider = "openrouter"\nmodel = "openrouter/z-ai/glm-5"\n',
      "auth.json": JSON.stringify({ tokens: { id_token: "x", access_token: "y" }, last_refresh: "2026-01-01" }),
    });
    const detected = await detectCodexModel(home);
    expect(detected?.provider).toBe("openrouter");
    expect(detected?.hasApiKey).toBe(true);
  });

  it("reports an empty model and no credential for a bare config.toml", async () => {
    const home = await fixtureHome({ "config.toml": 'approval_policy = "on-request"\n' });
    const detected = await detectCodexModel(home);
    expect(detected?.model).toBe("");
    expect(detected?.hasApiKey).toBe(false);
    expect(detected?.deployed).toBe(true);
  });

  it("parses config scalars and auth shapes in isolation", () => {
    expect(parseCodexConfigModel('model = "a"\n[profiles.p]\nmodel = "b"\n')).toEqual({ model: "a", provider: "" });
    expect(parseCodexAuthShape(JSON.stringify({ OPENAI_API_KEY: "  " }))).toBe(false);
    expect(parseCodexAuthShape("not json")).toBe(false);
  });
});
