import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectClaudeModel, parseClaudeSettingsModel } from "./detect-model.js";

const dirs: string[] = [];
async function fixtureDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-detect-"));
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents);
  }
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("detectClaudeModel", () => {
  it("returns null when no Claude config surface exists", async () => {
    const empty = await fixtureDir({});
    expect(await detectClaudeModel(empty, join(tmpdir(), "claude-detect-missing.json"))).toBeNull();
  });

  it("reads the settings.json model and credential presence", async () => {
    const dir = await fixtureDir({
      "settings.json": JSON.stringify({ model: "sonnet" }),
      ".credentials.json": JSON.stringify({ claudeAiOauth: { accessToken: "x" } }),
    });
    const detected = await detectClaudeModel(dir, join(tmpdir(), "claude-detect-missing.json"));
    expect(detected).toEqual({
      model: "sonnet",
      provider: "",
      hasApiKey: true,
      deployed: true,
      source: "config",
    });
  });

  it("counts the home-level .claude.json alone as deployed", async () => {
    const empty = await fixtureDir({});
    const homeJson = join(await fixtureDir({ ".claude.json": "{}" }), ".claude.json");
    const detected = await detectClaudeModel(empty, homeJson);
    expect(detected?.deployed).toBe(true);
    expect(detected?.model).toBe("");
    expect(detected?.hasApiKey).toBe(false);
  });

  it("parses settings tolerantly", () => {
    expect(parseClaudeSettingsModel('{"model":"opus"}')).toBe("opus");
    expect(parseClaudeSettingsModel("{}")).toBe("");
    expect(parseClaudeSettingsModel("broken")).toBe("");
  });
});
