import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the pi CLI command with one precedence chain shared by detection,
 * the models probe, and execution so all three agree inside services whose
 * PATH lacks pi's install location:
 *
 * 1. explicit adapter-config command (operator pinned the binary)
 * 2. PILIBALA_PI_COMMAND environment override
 * 3. pi's managed agent home (~/.pi/agent/bin/pi — the official install
 *    location, which is outside the dev service PATH)
 * 4. bare "pi" (PATH lookup)
 */
export function resolvePiCliCommand(explicitCommand?: string): string {
  const configured = explicitCommand?.trim();
  if (configured) return configured;
  const override = process.env.PILIBALA_PI_COMMAND?.trim();
  if (override) return override;
  const managedHome = join(homedir(), ".pi", "agent", "bin", "pi");
  try {
    if (statSync(managedHome).isFile()) return managedHome;
  } catch {
    // no managed home — fall through to PATH lookup
  }
  return "pi";
}
