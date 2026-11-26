import type { AdapterConfigSchema } from "@pilibalaai/adapter-utils";

/**
 * Declarative Harness/Runtime settings schema for pi_local agents.
 *
 * Mirrors hermes_local's config-schema UI/UX (AMB-333): the adapter declares
 * its settings once and the board renders them through SchemaConfigFields on
 * the Harness/Runtime tab.
 *
 * Scope notes (AMB-333):
 * - Pi has no `--quiet` CLI flag, and its `--verbose` flag only affects the
 *   interactive TUI startup — Pilibala always runs `pi --mode json -p`, where
 *   neither flag changes run output. The board-facing Quiet/Verbose controls
 *   therefore map to the adapter's run-log compaction mode: Quiet keeps run
 *   logs compact and linear-size, while Verbose keeps the full raw transcript.
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
        hint: "Compact Pi's persisted run log by stripping cumulative streaming copies. Pi has no --quiet flag in non-interactive print mode, so this controls Pilibala run-log compaction instead.",
      },
      {
        key: "verbose",
        label: "Verbose output",
        type: "toggle",
        default: false,
        hint: "Keep Pi's full raw JSONL transcript for forensics. Pi's --verbose flag only affects interactive startup, so this keeps the persisted run log uncompacted and takes precedence when both output controls are enabled.",
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
