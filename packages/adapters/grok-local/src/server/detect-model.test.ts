import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectGrokModel } from "./detect-model.js";

const dirs: string[] = [];
async function fixtureHome(files: Record<string, string>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "grok-detect-"));
  dirs.push(home);
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(home, name), contents);
  }
  return home;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const usableAuth = JSON.stringify({
  "https://issuer.example::1b0e6c1e-6a2f-4c3b-9d0e-2f3a4b5c6d7e": {
    key: "grok-key",
    refresh_token: "refresh",
  },
});

describe("detectGrokModel", () => {
  it("returns null when the Grok home is missing", async () => {
    expect(await detectGrokModel(join(tmpdir(), "grok-detect-missing"))).toBeNull();
  });

  it("reports deployed with usable auth (presence only, never values)", async () => {
    const home = await fixtureHome({ "auth.json": usableAuth });
    const detected = await detectGrokModel(home);
    expect(detected).toEqual({
      model: "",
      provider: "",
      hasApiKey: true,
      deployed: true,
      source: "config",
    });
  });

  it("flags an auth.json without a usable payload as deployed but without a credential", async () => {
    const home = await fixtureHome({ "auth.json": JSON.stringify({ unexpected: {} }) });
    const detected = await detectGrokModel(home);
    expect(detected?.deployed).toBe(true);
    expect(detected?.hasApiKey).toBe(false);
  });
});
