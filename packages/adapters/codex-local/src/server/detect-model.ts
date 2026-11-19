/**
 * Detect the currently configured model from the user's Codex config (AMB-311 P2).
 *
 * Reads `~/.codex` (or `$CODEX_HOME`): the top-level `model` /
 * `model_provider` scalars from `config.toml`, and credential PRESENCE (never
 * values) from `auth.json`. Returns null when the Codex home does not exist —
 * the harness is not configured on this host.
 *
 * Same contract as the hermes detector: environment facts only, no
 * credential values, injectable paths for tests.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DetectedCodexModel {
  /** Model from config.toml (e.g. "gpt-6-luna"). Empty when the CLI default applies. */
  model: string;
  /** model_provider from config.toml (e.g. "openrouter"). Empty = built-in OpenAI routing. */
  provider: string;
  hasApiKey: boolean;
  /** True when the Codex home carries a config.toml or auth.json. */
  deployed: boolean;
  source: "config";
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Parse the top-level `model` / `model_provider` scalars from Codex config.toml. */
export function parseCodexConfigModel(
  toml: string,
): { model: string; provider: string } {
  let model = "";
  let provider = "";
  for (const line of toml.split("\n")) {
    // Top-level scalars only: a section header starts a new table whose keys
    // are profile/project-scoped, not the default routing.
    if (/^\s*\[/.test(line)) continue;
    const match = /^\s*(model|model_provider)\s*=\s*"([^"]*)"/.exec(line);
    if (!match) continue;
    if (match[1] === "model" && !model) model = match[2];
    if (match[1] === "model_provider" && !provider) provider = match[2];
  }
  return { model, provider };
}

/** Credential PRESENCE from Codex auth.json — never the values themselves. */
export function parseCodexAuthShape(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.OPENAI_API_KEY === "string" && parsed.OPENAI_API_KEY.trim().length > 0) return true;
    if (parsed.tokens && typeof parsed.tokens === "object" && !Array.isArray(parsed.tokens)) {
      return Object.values(parsed.tokens as Record<string, unknown>).some(
        (value) => typeof value === "string" && value.trim().length > 0,
      );
    }
    return false;
  } catch {
    return false;
  }
}

export async function detectCodexModel(
  homePath?: string,
): Promise<DetectedCodexModel | null> {
  const home = homePath ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");

  let homeStat;
  try {
    homeStat = await stat(home);
  } catch {
    return null;
  }
  if (!homeStat.isDirectory()) return null;

  const toml = await readIfPresent(join(home, "config.toml"));
  const authRaw = await readIfPresent(join(home, "auth.json"));
  const deployed = toml !== null || authRaw !== null;
  if (!deployed) return null;

  const { model, provider } = toml ? parseCodexConfigModel(toml) : { model: "", provider: "" };
  return {
    model,
    // Codex routes through OpenAI unless config.toml overrides the provider.
    provider: provider || (toml ? "openai" : ""),
    hasApiKey: authRaw ? parseCodexAuthShape(authRaw) : false,
    deployed,
    source: "config",
  };
}
