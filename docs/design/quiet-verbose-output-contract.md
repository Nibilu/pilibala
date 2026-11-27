# Quiet / Verbose output contract (orthogonal axes)

> Status: agreed with the user 2026-11-27. Supersedes the "verbose wins over
> quiet" coupling introduced with the quiet-output control (AMB-174 lineage).
> Board umbrella: AMB-385 (subtasks AMB-386..389, verification AMB-390).

## Problem being solved

The two agent-config toggles collapsed onto a single presentation axis and
partially onto the execution axis, so toggling `verbose` with `quiet` off
changed nothing anywhere (user-verified on dev):

- UI: `quietTranscriptFromAdapterConfig` defined `verbose` only as "cancel
  quiet" — no independent tier existed.
- Hermes CLI lane: `quiet=true` passed `-Q` to `hermes chat`, so quiet
  additionally shrank the persisted raw run log (violating "run log is always
  full").
- Hermes ACP lane: `quiet`/`verbose` were never read (`acp.ts` has zero
  references); the acpx engine hardcoded `verbose: acpxAgent === "claude"`, so
  `adapterConfig.verbose` was a silent no-op.
- Upstream check (2026-11-27, 1728 commits after fork base 17b9e10252): no
  upstream work redefines these semantics; upstream still hardcodes the acpx
  verbose claude rule and its schema hints still say "Pass Hermes --quiet /
  --verbose". This contract is fork-era work.

## The contract

Two switches, two ORTHOGONAL axes, mirroring the upstream hermes CLI intent
(`-Q` = display mode, `-v` = debug-log level; upstream comment:
"verbose ONLY controls global DEBUG logging"):

### `quiet` — presentation-density axis (UI-only)

- Scope: how much detail the rendered run transcript (nice view) shows.
- `quiet=true`: strip **thinking text** and **tool_result bodies**; keep the
  hint rows (tool_call short target, lifecycle rows such as "Thought").
- ALWAYS kept: assistant reply, approval / runtime_request cards (muting them
  would stall runs), result summary, stderr / system entries.
- NEVER touches: what is persisted (run log NDJSON is always full), what the
  agent executes, or any CLI flag. No execution-side effect on ANY engine.
- `quiet=false`: full transcript detail.

### `verbose` — diagnostic-logging axis (execution-side)

- Scope: how much DEBUG-level diagnostics the RAW run-log stream carries.
- CLI lane: passes `--verbose` to `hermes chat` → hermes_logging attaches a
  DEBUG StreamHandler on **stderr**; DEBUG lines land in the raw log's stderr
  stream. The nice-view transcript does not gain a tier from this.
- ACP lane: wires `adapterConfig.verbose` into the acpx engine's `verbose`
  runtime option (previously claude-only hardcode) so hermes ACP agents can
  emit runtime diagnostics too.
- NEVER affects the rendered nice transcript and NEVER cancels `quiet`. The
  two switches do not read each other anywhere.

### Combination table

| quiet | verbose | nice (parsed transcript)          | raw (run log stream)        |
|-------|---------|-----------------------------------|-----------------------------|
| false | false   | full detail (default)             | no DEBUG                    |
| true  | false   | hints only, content stripped      | no DEBUG                    |
| false | true    | full detail (unchanged by verbose)| DEBUG diagnostics on stderr |
| true  | true    | hints only (verbose irrelevant)   | DEBUG diagnostics on stderr |

## Mapping to upstream hermes CLI flags

| Paperclip toggle | upstream flag | upstream meaning | Paperclip translation |
|---|---|---|---|
| quiet | `-Q/--quiet` | suppress banner/spinner/tool previews; oneshot prints answer + session_id only | presentation filter in the UI only; `-Q` is NOT passed (the display lives in the UI now, and the run log must stay full) |
| verbose | `-v/--verbose` | global DEBUG logging to stderr + un-silence agent init prints | passed through on the CLI lane; wired to acpx `verbose` on the ACP lane |

Notes:

- Upstream "tool_progress: off|new|all|verbose" and `show_reasoning` are
  display-config knobs inside hermes itself and stay independent of `-v`
  (upstream comment); Paperclip does not surface them as these toggles.
- ACP session mode "One-shot" (fresh session per run vs persistent state) is
  an unrelated axis and out of scope.
- raw ≠ 100 % of process stdout: the CLI lane's live filter drops the "Query:"
  echo body and the exit footer before persistence (echo guard, AMB-160/266);
  everything else (banner chrome, tool rows, lifecycle lines, stderr) is kept.

## Implementation sites (single sources of truth)

| Concern | File | Rule |
|---|---|---|
| UI quiet resolution | `ui/src/adapters/transcript.ts` → `quietTranscriptFromAdapterConfig` | returns `record.quiet === true` only; verbose never consulted |
| UI quiet transform | `quietTransformTranscriptEntry` | strips thinking text + tool_result content only |
| Hermes CLI lane | `packages/adapters/hermes/src/server/execute.ts` | passes `-v` for verbose; never passes `-Q` for quiet |
| Hermes ACP lane | `packages/adapter-utils/src/acpx-engine/execute.ts` | `verbose: acpxAgent === "claude" \|\| adapterConfig.verbose === true` |
| Schema declaration | `packages/adapters/hermes/src/server/config-schema.ts` | hints state the orthogonal semantics + engine scope |
| Other adapters | per-adapter config-schema + execute | audit vs this contract; undeclared/unwired toggles must not silently no-op |

## Adapter audit baseline (2026-11-27, AMB-389)

Full audit of every adapter package (13 adapter types + inline registry
entries). Verdicts after the AMB-386/387/388/389 fixes:

| Adapter | Verdict | Notes |
|---|---|---|
| `hermes_local` (acp \| cli) | aligned | AMB-386/387/388 |
| `pi_local` | aligned | quiet decoupled from run-log compaction (AMB-389); compaction stays an internal `stdoutLogMode` log-hygiene default; verbose keeps the lossless raw log |
| `claude_local` | aligned | quiet declared (presentation axis); NO verbose toggle — Claude CLI `--verbose` is a stream-json protocol requirement and its ACP runtime diagnostics are always on, so a toggle would be a silent no-op (hint states this) |
| `hermes_gateway`, `codex_local`, `gemini_local`, `grok_local`, `kimi_local`, `opencode_local`, `cursor`, `cursor_cloud`, `openclaw_gateway`, `pilibala_runner`, `process`, `http` | compliant | neither key declared, no execution-side reads; the shared UI quiet filter applies to any adapter that sets `adapterConfig.quiet` |
| acpx engine (shared) | aligned | AMB-388: adapterConfig `verbose` emits run-log stderr diagnostics; upstream-native claude-only acpx verbose untouched |

Known upstream-native behaviors left alone: Claude CLI hardcoded
`--verbose` (protocol requirement), acpx runtime verbose claude-only hardcode,
Hermes CLI `quiet_mode=not verbose` init-print coupling (stdout-only, stripped
by the UI quiet filter as a plain stdout line).

Behavior-change note (pi_local): an agent with explicit `quiet=false` and
`verbose=false` previously persisted the RAW log; it now persists the compact
(default) log — set `verbose=true` to restore the raw forensic log. Dev
instance scan: only one test agent (`dfdfdf`) matched that combination.
