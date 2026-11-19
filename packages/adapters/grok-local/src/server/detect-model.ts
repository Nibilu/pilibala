/**
 * Detect the login state of the user's Grok CLI (AMB-311 P2).
 *
 * Reads `$GROK_HOME` or `~/.grok`: `auth.json` presence and its usable-auth
 * shape (via grok-home.ts — credential PRESENCE, never values). Grok has no
 * user-configured default model file, so `model` stays empty and the CLI's
 * own default applies.
 *
 * Same contract as the hermes detector: environment facts only, no
 * credential values, injectable paths for tests.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { grokHomeHasUsableAuth } from "./grok-home.js";

export interface DetectedGrokModel {
  model: string;
  provider: string;
  hasApiKey: boolean;
  /** True when the Grok home carries an auth.json. */
  deployed: boolean;
  source: "config";
}

export async function detectGrokModel(
  homePath?: string,
): Promise<DetectedGrokModel | null> {
  const home = homePath ?? process.env.GROK_HOME ?? join(homedir(), ".grok");

  try {
    const homeStat = await stat(join(home, "auth.json"));
    if (!homeStat.isFile()) return null;
  } catch {
    return null;
  }

  return {
    model: "",
    provider: "",
    hasApiKey: await grokHomeHasUsableAuth(home),
    deployed: true,
    source: "config",
  };
}
