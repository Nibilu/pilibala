/**
 * Local CLI deployment probe for the new-agent harness grid (AMB-311 plan §3).
 *
 * Answers one question per CLI harness: can THIS server process actually spawn
 * the CLI a local run would use? The probe runs `command --version` inside the
 * server's own environment — the same environment run spawns use — so a CLI
 * installed where the service PATH cannot see it is reported as not deployed
 * (that is the truth for local runs). Adapters with a managed-home resolver
 * (pi) resolve through it, keeping the probe consistent with execution.
 *
 * Server-native (pilibala_runner and its runtime aliases) and hosted
 * (cursor_cloud) harnesses always run and are not probed.
 *
 * Cost control: bounded timeout per probe, small concurrency cap, short-TTL
 * result cache. The UI only asks when the new-agent dialog opens and on an
 * explicit refresh — never on a render poll.
 */
import { execFile } from "node:child_process";
import { resolvePiCliCommand } from "@pilibalaai/adapter-pi-local/server";
import { resolveHermesCommand } from "@pilibalaai/hermes-pilibala-adapter/server";

export interface AdapterAvailabilityRow {
  type: string;
  deployed: boolean;
  version?: string;
}

const PROBE_TIMEOUT_MS = 3_000;
const MAX_CONCURRENT_PROBES = 3;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_VERSION_LENGTH = 120;

type CliProbe = { type: string; command: () => string };

/** CLI harnesses a local run spawns directly. Registered type ids. */
const CLI_PROBES: readonly CliProbe[] = [
  { type: "claude_local", command: () => "claude" },
  { type: "codex_local", command: () => "codex" },
  { type: "opencode_local", command: () => "opencode" },
  { type: "pi_local", command: () => resolvePiCliCommand() },
  { type: "kimi_local", command: () => "kimi" },
  { type: "gemini_local", command: () => "gemini" },
  { type: "grok_local", command: () => "grok" },
  { type: "cursor", command: () => "agent" },
  { type: "hermes_local", command: () => resolveHermesCommand({}) },
];

/**
 * Run `command --version`. Deployed = exited 0 within the timeout; the version
 * is the first non-empty output line (stdout first, stderr fallback — CLIs
 * disagree about the stream). Any failure resolves null, never throws.
 */
export type CliVersionProbe = (command: string) => Promise<string | null>;

export const probeCliVersion: CliVersionProbe = (command) =>
  new Promise((resolve) => {
    execFile(
      command,
      ["--version"],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}\n${stderr ?? ""}`;
        const version = output
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0);
        // Any failure — ENOENT, timeout kill, non-zero exit — is "not
        // deployed" (失败即未部署), even if a partial version line leaked out.
        if (error) {
          resolve(null);
          return;
        }
        resolve(version ? version.slice(0, MAX_VERSION_LENGTH) : null);
      },
    );
  });

interface AvailabilityCache {
  at: number;
  rows: AdapterAvailabilityRow[];
}
let cache: AvailabilityCache | null = null;

/** Run promise-producing tasks with at most `limit` in flight, order-preserving. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function probeAll(
  probe: CliVersionProbe,
): Promise<AdapterAvailabilityRow[]> {
  return mapWithConcurrency(CLI_PROBES, MAX_CONCURRENT_PROBES, async (entry) => {
    const version = await probe(entry.command()).catch(() => null);
    return version
      ? { type: entry.type, deployed: true, version }
      : { type: entry.type, deployed: false };
  });
}

export async function readAdapterAvailability(options?: {
  refresh?: boolean;
  probe?: CliVersionProbe;
  now?: () => number;
}): Promise<AdapterAvailabilityRow[]> {
  const probe = options?.probe ?? probeCliVersion;
  const now = options?.now ?? Date.now;
  if (!options?.refresh && cache && now() - cache.at < CACHE_TTL_MS) {
    return cache.rows;
  }
  const rows = await probeAll(probe);
  cache = { at: now(), rows };
  return rows;
}

/** Test seam: drop the module-level cache. */
export function resetAdapterAvailabilityCacheForTests(): void {
  cache = null;
}
