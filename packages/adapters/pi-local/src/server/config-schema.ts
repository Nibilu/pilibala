import type { AdapterConfigSchema } from "@pilibalaai/adapter-utils";

/**
 * Declarative Harness/Runtime settings schema for pi_local agents.
 *
 * Mirrors hermes_local's config-schema UI/UX (AMB-333): the adapter declares
 * its settings once and the board renders them through SchemaConfigFields on
 * the Harness/Runtime tab.
 *
 * Scope notes (AMB-333, revised by the orthogonal output contract AMB-385):
 * - Pi has no `--quiet` CLI flag, and its `--verbose` flag only affects the
 *   interactive TUI startup — Pilibala always runs `pi --mode json -p`, where
 *   neither flag changes run output. Per the orthogonal output contract
 *   (docs/design/quiet-verbose-output-contract.md) Quiet is the presentation-
 *   density axis (shared UI transcript filter only) and Verbose is the
 *   diagnostic axis: it keeps the full raw JSONL in the persisted run log.
 *   Pi's own run-log compaction default (linear-size growth against Pi's
 *   cumulative streaming copies) is a log-format hygiene concern and stays
 *   internal (`stdoutLogMode`), not a meaning of either toggle.
 * - `pilibalaApiUrl` applies: Pi skill scripts and the run subprocess read
 *   PILIBALA_API_URL from the environment; the override follows the
 *   adapterConfig → server env priority used by hermes_local (AMB-254 C5).
 * - `promptTemplate` applies: execute.ts already renders config.promptTemplate;
 *   exposing it here surfaces it on the Harness/Runtime tab.
 */
export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "quiet",
        label: "Quiet output",
        type: "toggle",
        default: true,
        hint: "Simplify the run transcript display (presentation-only): hides thinking text and tool-result bodies in the Pilibala UI; hint rows, replies, approvals and results stay. Does not change Pi's persisted run log.",
      },
      {
        key: "verbose",
        label: "Verbose output",
        type: "toggle",
        default: false,
        hint: "Diagnostic logging (orthogonal to Quiet output): keep Pi's full raw JSONL stream in the persisted run log (no compaction) for forensics. Never changes the rendered transcript.",
      },
      {
        key: "pilibalaApiUrl",
        label: "Pilibala API URL",
        type: "text",
        hint: "Optional base-URL override for this agent's subprocess env (Pi skill scripts append /api themselves; a trailing /api is stripped). Defaults to the server's PILIBALA_API_URL. A sandbox bridge URL wins when one is active.",
      },
      {
        key: "promptTemplate",
        label: "Prompt template",
        type: "textarea",
        hint: "Optional custom prompt template with {{variable}} placeholders. Used as the system-prompt extension when no instructions file is set and rendered into wake prompts; leave empty for Pilibala's default agent prompt.",
      },
    ],
  };
}
