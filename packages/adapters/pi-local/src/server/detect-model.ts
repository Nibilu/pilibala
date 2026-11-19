/**
 * Detect the pi CLI's availability and credential-gated model catalog
 * (AMB-311 P2).
 *
 * Pi has no user-configured default model file: `pi --list-models` enumerates
 * the models the current credentials unlock (verified empirically in AMB-311 —
 * without OPENROUTER/ANTHROPIC keys it prints "No models available" and exits
 * 0). The detector therefore reports environment facts only:
 *
 * - `deployed: true`  → the pi CLI ran successfully (installed).
 * - `hasApiKey`       → the catalog is non-empty (credentials unlocked models).
 * - `candidates`      → the visible model IDs (no credential values).
 *
 * Returns null when the pi CLI is missing or the probe fails — "unknown", not
 * "not deployed", so a CI host is never misreported.
 *
 * Same contract as the hermes detector: environment facts only, no
 * credential values.
 */

import { discoverPiModelsCached } from "./models.js";

export interface DetectedPiModel {
  model: string;
  provider: string;
  hasApiKey: boolean;
  deployed: boolean;
  /** Model IDs the current credentials unlock. */
  candidates: string[];
  source: "probe";
}

export async function detectPiModel(): Promise<DetectedPiModel | null> {
  let models: { id: string }[];
  try {
    models = await discoverPiModelsCached();
  } catch {
    // pi missing or the probe failed: unknown, not "not deployed".
    return null;
  }
  return {
    model: "",
    provider: "",
    hasApiKey: models.length > 0,
    deployed: true,
    candidates: models.map((model) => model.id),
    source: "probe",
  };
}
