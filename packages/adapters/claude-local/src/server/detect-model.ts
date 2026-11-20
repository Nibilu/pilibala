/**
 * Detect the currently configured model from the user's Claude Code config
 * (AMB-311 P2).
 *
 * Reads `$CLAUDE_CONFIG_DIR` or `~/.claude` (plus the home-level
 * `~/.claude.json`): the `model` key from `settings.json`, and credential
 * PRESENCE (never values) from `.credentials.json`. Returns null when none of
 * these exist — the harness is not configured on this host.
 *
 * Same contract as the hermes detector: environment facts only, no
 * credential values, injectable paths for tests.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DetectedClaudeModel {
  /** Model from settings.json (e.g. "sonnet"). Empty when the CLI default applies. */
  model: string;
  provider: string;
  hasApiKey: boolean;
  /** True when a Claude config surface was found on this host. */
  deployed: boolean;
  source: "config";
}

export function parseClaudeSettingsModel(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.model === "string" ? parsed.model : "";
  } catch {
    return "";
  }
}

export async function detectClaudeModel(
  configDirPath?: string,
  homeJsonPath?: string,
): Promise<DetectedClaudeModel | null> {
  const configDir = configDirPath
    ?? (typeof process.env.CLAUDE_CONFIG_DIR === "string" && process.env.CLAUDE_CONFIG_DIR.trim().length > 0
      ? process.env.CLAUDE_CONFIG_DIR.trim()
      : join(homedir(), ".claude"));
  const homeJson = homeJsonPath ?? join(homedir(), ".claude.json");

  let settingsRaw: string | null = null;
  let credentialsRaw: string | null = null;
  let homeJsonRaw: string | null = null;
  try {
    const dirStat = await stat(configDir);
    if (!dirStat.isDirectory()) return null;
  } catch {
    // A missing config dir can still carry the home-level .claude.json.
  }
  const read = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  };
  settingsRaw = await read(join(configDir, "settings.json"));
  credentialsRaw = await read(join(configDir, ".credentials.json"));
  homeJsonRaw = await read(homeJson);

  const deployed = settingsRaw !== null || credentialsRaw !== null || homeJsonRaw !== null;
  if (!deployed) return null;

  return {
    model: settingsRaw ? parseClaudeSettingsModel(settingsRaw) : "",
    provider: "",
    hasApiKey: credentialsRaw !== null,
    deployed,
    source: "config",
  };
}
