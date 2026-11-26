export const type = "pi_local";
export const label = "Pi";

export const SANDBOX_INSTALL_COMMAND = "npm install -g @earendil-works/pi-coding-agent@0.74.0";

export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# pi_local agent configuration

Adapter: pi_local

Use when:
- You want Pilibala to run Pi (the AI coding agent) locally as the agent runtime
- You want provider/model routing in Pi format (--provider <name> --model <id>)
- You want Pi session resume across heartbeats via --session
- You need Pi's tool set (read, bash, edit, write, grep, find, ls)

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- Pi CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file appended to system prompt via --append-system-prompt
- promptTemplate (string, optional): user prompt template passed via -p flag
- model (string, required): Pi model id in provider/model format (for example xai/grok-4)
- thinking (string, optional): thinking level (off, minimal, low, medium, high, xhigh)
- command (string, optional): defaults to "pi"
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds
- quiet (boolean, optional, default true): compact Pi --mode json stdout before it
  enters the Pilibala run log. Pi emits cumulative state in every message_update
  event, which makes run logs grow ~quadratically. Compact mode strips cumulative
  copies (message_update.message, assistantMessageEvent.partial), converts
  tool_execution_update to a throttled content-free Pilibala progress event, and
  preserves streaming deltas — parsePiJsonl output and live UI typing are unchanged.
- verbose (boolean, optional, default false): keep the full raw JSONL transcript for
  forensics. This takes precedence over quiet when both are enabled. Pi has no
  non-interactive --quiet/--verbose behavior, so these controls configure Pilibala's
  persisted run-log mode rather than a Pi CLI flag.
- stdoutLogMode (string, optional, legacy/internal): controls how Pi --mode json stdout
  is compacted before entering the Pilibala run log ("raw" or "compact"). When present,
  this explicit mode remains authoritative for backward compatibility. In compact mode,
  if a run is terminated before tool_execution_end, its partial tool output is not retained;
  use raw output when full forensic output is required. Oversized individual lines are
  handled by the server's run-log pipeline (redaction + head/tail cap) regardless of mode.

Notes:
- Pi supports multiple providers and models. Use \`pi --list-models\` to list available options.
- Pilibala requires an explicit \`model\` value for \`pi_local\` agents.
- Sessions are stored in ~/.pi/pilibalas/ and resumed with --session.
- All tools (read, bash, edit, write, grep, find, ls) are enabled by default.
- Agent instructions are appended to Pi's system prompt via --append-system-prompt, while the user task is sent via -p.
`;
