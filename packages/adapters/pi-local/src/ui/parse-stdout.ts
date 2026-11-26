import type { TranscriptEntry } from "@pilibalaai/adapter-utils";

/**
 * UI transcript parser for Pi `--mode json` stdout (AMB-333 style alignment).
 *
 * Content/style rules mirror the hermes/adapters reference parser:
 * - only assistant-role messages become thinking/assistant entries; the wake
 *   prompt echo (role "user"), system notices and toolResult messages are
 *   consumed so the transcript never renders the prompt as agent speech;
 * - pi lifecycle chrome (session/agent_settled/entry_appended/…) is consumed
 *   or mapped onto the shared entry shapes (`init` session card, `system`
 *   status lines) instead of leaking raw JSON into the stdout lane;
 * - provider retries surface as system/stderr lines (visible, bounded);
 * - streamed deltas render live; the full-content carriers (message_end /
 *   turn_end / agent_end) only emit the tail that was not already streamed,
 *   so the final answer appears exactly once (stateful factory);
 * - tool results are deduped by toolCallId across tool_execution_end and the
 *   turn_end toolResults array;
 * - `[pilibala]`/`[hermes]` adapter status lines become system entries;
 * - corrupted (e.g. head/tail-capped) JSON becomes a short system note, never
 *   a raw fragment dump.
 *
 * The stateless `parsePiStdoutLine` stays for compatibility and as the
 * registry fallback; prefer `createPiStdoutParser` for UI transcript building.
 */

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function truncateForStatus(text: string, maxLength = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength - 3)}…`;
}

type PiContentPart = { type: string; text?: string; thinking?: string };

function extractTextContent(content: string | PiContentPart[]): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };

  let text = "";
  let thinking = "";

  for (const c of content) {
    if (c.type === "text" && c.text) {
      text += c.text;
    }
    if (c.type === "thinking" && c.thinking) {
      thinking += c.thinking;
    }
  }

  return { text, thinking };
}

/**
 * Compact, honest label for a tool result that carries no text part (image
 * payloads, structured objects). Replaces the previous JSON.stringify dump
 * that flooded the transcript with a single oversized line.
 */
function describeNonTextResult(result: unknown): string {
  if (Array.isArray(result)) {
    const kinds = [...new Set(result.map((p) => asString(asRecord(p)?.type, "part")))];
    return `[non-text result: ${kinds.join(", ")}]`;
  }
  const record = asRecord(result);
  if (record) {
    const kinds = Array.isArray(record.content)
      ? [...new Set(record.content.map((p) => asString(asRecord(p)?.type, "part")))]
      : Object.keys(record).slice(0, 4);
    return `[non-text result: ${kinds.join(", ")}]`;
  }
  return `[non-text result: ${typeof result}]`;
}

function extractToolResultContent(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    const extracted = extractTextContent(result as PiContentPart[]);
    return extracted.text || describeNonTextResult(result);
  }
  if (result && typeof result === "object") {
    const resultObj = result as Record<string, unknown>;
    if (Array.isArray(resultObj.content)) {
      const extracted = extractTextContent(resultObj.content as PiContentPart[]);
      return extracted.text || describeNonTextResult(result);
    }
    return describeNonTextResult(result);
  }
  return describeNonTextResult(result);
}

interface PiMessageSummary {
  text: string;
  thinking: string;
  role: string;
}

function summarizeMessage(message: unknown): PiMessageSummary | null {
  const record = asRecord(message);
  if (!record) return null;
  const role = asString(record.role, "assistant");
  const { text, thinking } = extractTextContent(
    (record.content ?? "") as string | PiContentPart[],
  );
  return { role, text, thinking };
}

// ── Shared stateless entry builders ─────────────────────────────────────────

function sessionEntry(parsed: Record<string, unknown>, ts: string): TranscriptEntry[] {
  // Mirror the acpx.session init card so the pi lane renders the same
  // session-info header instead of a raw JSON stdout line.
  return [
    {
      kind: "init",
      ts,
      model: asString(parsed.model, "pi"),
      sessionId: asString(parsed.id) || asString(parsed.sessionId),
    },
  ];
}

function autoRetryEntries(parsed: Record<string, unknown>, ts: string): TranscriptEntry[] {
  const type = asString(parsed.type);
  const attempt = asNumber(parsed.attempt, 0);
  const maxAttempts = asNumber(parsed.maxAttempts, 0);
  if (type === "auto_retry_start") {
    const error = truncateForStatus(asString(parsed.errorMessage, "unknown error"));
    const label = maxAttempts > 0 ? `Retrying (attempt ${attempt}/${maxAttempts})` : `Retrying (attempt ${attempt})`;
    return [{ kind: "system", ts, text: `${label}: ${error}` }];
  }
  // auto_retry_end
  if (parsed.success === true) return [];
  const finalError = truncateForStatus(asString(parsed.finalError, asString(parsed.errorMessage, "unknown error")));
  return [
    {
      kind: "stderr",
      ts,
      text: `Provider retries exhausted (${attempt || "multiple"} attempts): ${finalError}`,
    },
  ];
}

// Track pending tool calls for proper toolUseId matching (stateless fallback).
let pendingToolCalls = new Map<string, { toolName: string; args: unknown }>();

export function resetParserState(): void {
  pendingToolCalls.clear();
}

function toolCallEntry(parsed: Record<string, unknown>, ts: string): TranscriptEntry[] {
  const toolCallId = asString(parsed.toolCallId, `tool-${Date.now()}`);
  const toolName = asString(parsed.toolName, "tool");
  const args = parsed.args;

  // Track this tool call for later matching
  pendingToolCalls.set(toolCallId, { toolName, args });

  return [
    {
      kind: "tool_call",
      ts,
      name: toolName,
      input: args,
      toolUseId: toolCallId,
    },
  ];
}

function toolResultEntry(parsed: Record<string, unknown>, ts: string): TranscriptEntry[] {
  const toolCallId = asString(parsed.toolCallId, `tool-${Date.now()}`);
  const result = parsed.result;
  const isError = parsed.isError === true;
  const pendingCall = pendingToolCalls.get(toolCallId);
  const toolName = asString(parsed.toolName, pendingCall?.toolName || "tool");
  pendingToolCalls.delete(toolCallId);

  return [
    {
      kind: "tool_result",
      ts,
      toolUseId: toolCallId,
      toolName,
      content: extractToolResultContent(result),
      isError,
    },
  ];
}

/**
 * Stateless parser: one fresh view per line, no cross-line dedupe. Kept for
 * compatibility (tests, server-side replay) and as the registry fallback.
 */
export function parsePiStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Adapter-written status lines (workspace reuse, session resume skips, …).
  // Same classification as the hermes parser's `[pilibala]` rule.
  if (trimmed.startsWith("[pilibala]") || trimmed.startsWith("[hermes]")) {
    return [{ kind: "system", ts, text: trimmed }];
  }

  const parsed = asRecord(safeJsonParse(trimmed));

  if (!parsed) {
    // Corrupted / head-tail-capped JSON event (possibly glued to the next
    // event by the cap boundary): surface a short neutral note instead of
    // dumping the raw fragment (hermes corrupted-acpx parity).
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.includes('"type":"')) {
      return [
        {
          kind: "system",
          ts,
          text: `[truncated pi event] ${truncateForStatus(trimmed)}`,
        },
      ];
    }
    // Plain non-JSON stdout
    return [{ kind: "stdout", ts, text: trimmed }];
  }

  const type = asString(parsed.type);

  // RPC protocol messages and adapter-generated progress metadata are
  // internal implementation details, not transcript entries.
  if (
    type === "response" ||
    type === "extension_ui_request" ||
    type === "extension_ui_response" ||
    type === "extension_error" ||
    type === "pilibala_progress"
  ) {
    return [];
  }

  // Internal bookkeeping the UI has no use for (terminal state is rendered
  // from the run record; context-edit metadata is protocol plumbing).
  if (type === "agent_settled" || type === "entry_appended" || type === "agent_start") {
    return [];
  }

  if (type === "session") {
    return sessionEntry(parsed, ts);
  }

  if (type === "auto_retry_start" || type === "auto_retry_end") {
    return autoRetryEntries(parsed, ts);
  }

  if (type === "agent_end") {
    const entries: TranscriptEntry[] = [];

    // Extract final assistant message + usage from the messages array
    const messages = parsed.messages as Array<Record<string, unknown>> | undefined;
    if (messages && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const summary = summarizeMessage(lastMessage);
      if (summary && summary.role === "assistant") {
        if (summary.thinking) {
          entries.push({ kind: "thinking", ts, text: summary.thinking });
        }
        if (summary.text) {
          entries.push({ kind: "assistant", ts, text: summary.text });
        }

        // Extract usage
        const usage = asRecord(lastMessage?.usage);
        if (usage) {
          const inputTokens = asNumber(usage.inputTokens ?? usage.input, 0);
          const outputTokens = asNumber(usage.outputTokens ?? usage.output, 0);
          const cachedTokens = asNumber(usage.cacheRead ?? usage.cachedInputTokens, 0);
          const costRecord = asRecord(usage.cost);
          const costUsd = asNumber(costRecord?.total ?? usage.costUsd, 0);

          if (inputTokens > 0 || outputTokens > 0) {
            entries.push({
              kind: "result",
              ts,
              text: "Run completed",
              inputTokens,
              outputTokens,
              cachedTokens,
              costUsd,
              subtype: "end",
              isError: false,
              errors: [],
            });
          }
        }
      }
    }

    return entries;
  }

  // Turn lifecycle chrome
  if (type === "turn_start") {
    return [];
  }

  if (type === "turn_end") {
    const entries: TranscriptEntry[] = [];

    // Only assistant-role turn messages are transcript content; the turn's
    // user prompt echo and toolResult summaries are consumed.
    const summary = summarizeMessage(parsed.message);
    if (summary && summary.role === "assistant") {
      if (summary.thinking) {
        entries.push({ kind: "thinking", ts, text: summary.thinking });
      }
      if (summary.text) {
        entries.push({ kind: "assistant", ts, text: summary.text });
      }
    }

    // Process tool results - match with pending tool calls
    const toolResults = parsed.toolResults as Array<Record<string, unknown>> | undefined;
    if (toolResults) {
      for (const tr of toolResults) {
        const toolCallId = asString(tr.toolCallId, `tool-${Date.now()}`);
        const content = tr.content;
        const isError = tr.isError === true;
        const pendingCall = pendingToolCalls.get(toolCallId);
        const toolName = asString(tr.toolName, pendingCall?.toolName || "tool");
        pendingToolCalls.delete(toolCallId);

        const contentStr =
          typeof content === "string"
            ? content
            : extractToolResultContent(content);

        entries.push({
          kind: "tool_result",
          ts,
          toolUseId: toolCallId,
          toolName,
          content: contentStr,
          isError,
        });
      }
    }

    return entries;
  }

  // Message streaming
  if (type === "message_start") {
    return [];
  }

  if (type === "message_update") {
    const assistantEvent = asRecord(parsed.assistantMessageEvent);
    if (assistantEvent) {
      const msgType = asString(assistantEvent.type);

      // Handle thinking deltas
      if (msgType === "thinking_delta") {
        const delta = asString(assistantEvent.delta);
        if (delta) {
          return [{ kind: "thinking", ts, text: delta, delta: true }];
        }
      }

      // Handle text deltas
      if (msgType === "text_delta") {
        const delta = asString(assistantEvent.delta);
        if (delta) {
          return [{ kind: "assistant", ts, text: delta, delta: true }];
        }
      }

      // Handle thinking end - emit full thinking block
      if (msgType === "thinking_end") {
        const content = asString(assistantEvent.content);
        if (content) {
          return [{ kind: "thinking", ts, text: content }];
        }
      }

      // Handle text end - emit full text block
      if (msgType === "text_end") {
        const content = asString(assistantEvent.content);
        if (content) {
          return [{ kind: "assistant", ts, text: content }];
        }
      }
    }
    return [];
  }

  if (type === "message_end") {
    const summary = summarizeMessage(parsed.message);
    if (!summary || summary.role !== "assistant") return [];

    const entries: TranscriptEntry[] = [];
    if (summary.thinking) {
      entries.push({ kind: "thinking", ts, text: summary.thinking });
    }
    if (summary.text) {
      entries.push({ kind: "assistant", ts, text: summary.text });
    }
    return entries;
  }

  // Tool execution
  if (type === "tool_execution_start") {
    return toolCallEntry(parsed, ts);
  }

  if (type === "tool_execution_update") {
    return [];
  }

  if (type === "tool_execution_end") {
    return toolResultEntry(parsed, ts);
  }

  // Unknown future pi event types: one bounded system line, never a raw JSON
  // stdout dump (acpx unknown-event parity).
  return [{ kind: "system", ts, text: `[pi] ${truncateForStatus(type || "unnamed event", 60)}` }];
}

// ── Stateful factory (preferred for UI transcript building) ────────────────

interface CurrentMessageState {
  role: string;
  streamedText: string;
  streamedThinking: string;
  /** Full text already emitted for this message by a final-content carrier. */
  finalTextEmitted: string;
  finalThinkingEmitted: string;
}

export interface PiStdoutParser {
  parseLine: (line: string, ts: string) => TranscriptEntry[];
  reset: () => void;
}

/**
 * Stateful stdout parser for the pi `--mode json` stream.
 *
 * Adds the cross-line state the stateless parser cannot have:
 * - streamed delta accumulation, so message_end/turn_end/agent_end only emit
 *   the tail that was not already streamed (the answer renders exactly once);
 * - toolUseId dedupe between `tool_execution_end` and the turn_end
 *   `toolResults` array.
 */
export function createPiStdoutParser(): PiStdoutParser {
  let current: CurrentMessageState | null = null;
  /** Tool results already emitted (tool_execution_end wins over turn_end). */
  const emittedToolResults = new Set<string>();

  const reset = () => {
    current = null;
    emittedToolResults.clear();
    pendingToolCalls.clear();
  };

  const ensureCurrent = (role: string): CurrentMessageState => {
    if (!current || current.role !== role) {
      current = {
        role,
        streamedText: "",
        streamedThinking: "",
        finalTextEmitted: "",
        finalThinkingEmitted: "",
      };
    }
    return current;
  };

  /**
   * Emit the not-yet-streamed remainder of a final assistant block, so the
   * live-typed content and the final message join into one entry instead of
   * duplicating the whole answer. When the block was partially streamed, the
   * tail rides as a delta so the coalescer joins it onto the streamed entry.
   */
  const remainder = (
    full: string,
    streamed: string,
    finalEmitted: string,
    kind: "assistant" | "thinking",
    ts: string,
  ): TranscriptEntry | null => {
    let text = full;
    if (!text) return null;
    const alreadyRendered = finalEmitted || streamed;
    if (alreadyRendered && text === alreadyRendered) return null;
    if (alreadyRendered && text.startsWith(alreadyRendered)) {
      text = text.slice(alreadyRendered.length);
    }
    if (!text.trim()) return null;
    const delta = alreadyRendered.length > 0;
    if (kind === "assistant") return { kind: "assistant", ts, text, delta };
    return { kind: "thinking", ts, text, delta };
  };

  return {
    reset,
    parseLine(line: string, ts: string): TranscriptEntry[] {
      const trimmed = line.trim();
      if (!trimmed) return [];

      if (trimmed.startsWith("[pilibala]") || trimmed.startsWith("[hermes]")) {
        return [{ kind: "system", ts, text: trimmed }];
      }

      const parsed = asRecord(safeJsonParse(trimmed));

      if (!parsed) {
        if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.includes('"type":"')) {
          return [
            { kind: "system", ts, text: `[truncated pi event] ${truncateForStatus(trimmed)}` },
          ];
        }
        return [{ kind: "stdout", ts, text: trimmed }];
      }

      const type = asString(parsed.type);

      if (
        type === "response" ||
        type === "extension_ui_request" ||
        type === "extension_ui_response" ||
        type === "extension_error" ||
        type === "pilibala_progress" ||
        type === "agent_settled" ||
        type === "entry_appended" ||
        type === "agent_start" ||
        type === "turn_start" ||
        type === "message_start" ||
        type === "tool_execution_update"
      ) {
        // An assistant message_start opens a new delta-accumulation context.
        // Non-assistant messages (user echo, toolResult, system) interleave
        // inside the turn and must NOT clear the assistant context.
        if (type === "message_start") {
          const role = asString(asRecord(parsed.message)?.role, "assistant");
          if (role === "assistant") {
            current = {
              role,
              streamedText: "",
              streamedThinking: "",
              finalTextEmitted: "",
              finalThinkingEmitted: "",
            };
          }
        }
        return [];
      }

      if (type === "session") {
        return sessionEntry(parsed, ts);
      }

      if (type === "auto_retry_start" || type === "auto_retry_end") {
        return autoRetryEntries(parsed, ts);
      }

      if (type === "tool_execution_start") {
        return toolCallEntry(parsed, ts);
      }

      if (type === "tool_execution_end") {
        const toolCallId = asString(parsed.toolCallId, "");
        if (toolCallId) emittedToolResults.add(toolCallId);
        return toolResultEntry(parsed, ts);
      }

      if (type === "message_update") {
        const assistantEvent = asRecord(parsed.assistantMessageEvent);
        if (!assistantEvent) return [];
        const msgType = asString(assistantEvent.type);

        if (msgType === "thinking_delta") {
          const delta = asString(assistantEvent.delta);
          if (!delta) return [];
          const state = ensureCurrent("assistant");
          state.streamedThinking += delta;
          return [{ kind: "thinking", ts, text: delta, delta: true }];
        }

        if (msgType === "text_delta") {
          const delta = asString(assistantEvent.delta);
          if (!delta) return [];
          const state = ensureCurrent("assistant");
          state.streamedText += delta;
          return [{ kind: "assistant", ts, text: delta, delta: true }];
        }

        // thinking_end/text_end carry a content index in pi's protocol, not
        // the block content — nothing to emit here.
        return [];
      }

      if (type === "message_end") {
        const summary = summarizeMessage(parsed.message);
        if (!summary || summary.role !== "assistant") {
          // toolResult / user / system message ends don't touch the
          // assistant delta context.
          return [];
        }
        const state = ensureCurrent("assistant");
        const entries: TranscriptEntry[] = [];
        const thinkingTail = remainder(summary.thinking, state.streamedThinking, state.finalThinkingEmitted, "thinking", ts);
        if (thinkingTail) entries.push(thinkingTail);
        const textTail = remainder(summary.text, state.streamedText, state.finalTextEmitted, "assistant", ts);
        if (textTail) entries.push(textTail);
        state.finalThinkingEmitted = summary.thinking || state.finalThinkingEmitted;
        state.finalTextEmitted = summary.text || state.finalTextEmitted;
        return entries;
      }

      if (type === "turn_end") {
        const entries: TranscriptEntry[] = [];

        const summary = summarizeMessage(parsed.message);
        if (summary && summary.role === "assistant") {
          // The turn's final message was already rendered by message_end or
          // the delta stream — only emit a genuinely unseen tail.
          const state = current && current.role === "assistant" ? current : null;
          const streamed = state?.streamedText ?? "";
          const finalEmitted = state?.finalTextEmitted ?? "";
          const streamedThinking = state?.streamedThinking ?? "";
          const finalThinkingEmitted = state?.finalThinkingEmitted ?? "";
          const thinkingTail = remainder(summary.thinking, streamedThinking, finalThinkingEmitted, "thinking", ts);
          if (thinkingTail) entries.push(thinkingTail);
          const textTail = remainder(summary.text, streamed, finalEmitted, "assistant", ts);
          if (textTail) entries.push(textTail);
          if (state) {
            state.finalThinkingEmitted = summary.thinking || state.finalThinkingEmitted;
            state.finalTextEmitted = summary.text || state.finalTextEmitted;
          }
        }

        const toolResults = parsed.toolResults as Array<Record<string, unknown>> | undefined;
        if (toolResults) {
          for (const tr of toolResults) {
            const toolCallId = asString(tr.toolCallId, "");
            // tool_execution_end already rendered this result.
            if (toolCallId && emittedToolResults.has(toolCallId)) {
              pendingToolCalls.delete(toolCallId);
              continue;
            }
            if (toolCallId) emittedToolResults.add(toolCallId);
            const isError = tr.isError === true;
            const pendingCall = pendingToolCalls.get(toolCallId);
            const toolName = asString(tr.toolName, pendingCall?.toolName || "tool");
            pendingToolCalls.delete(toolCallId);
            entries.push({
              kind: "tool_result",
              ts,
              toolUseId: toolCallId || `tool-${Date.now()}`,
              toolName,
              content: extractToolResultContent(tr.content),
              isError,
            });
          }
        }

        return entries;
      }

      if (type === "agent_end") {
        const entries: TranscriptEntry[] = [];
        const messages = parsed.messages as Array<Record<string, unknown>> | undefined;
        if (messages && messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          const summary = summarizeMessage(lastMessage);
          if (summary && summary.role === "assistant") {
            // Same single-render contract: the final assistant message was
            // already streamed/emitted — surface only an unseen tail.
            const state = current && current.role === "assistant" ? current : null;
            const thinkingTail = remainder(
              summary.thinking,
              state?.streamedThinking ?? "",
              state?.finalThinkingEmitted ?? "",
              "thinking",
              ts,
            );
            if (thinkingTail) entries.push(thinkingTail);
            const textTail = remainder(
              summary.text,
              state?.streamedText ?? "",
              state?.finalTextEmitted ?? "",
              "assistant",
              ts,
            );
            if (textTail) entries.push(textTail);
            if (state) {
              state.finalThinkingEmitted = summary.thinking || state.finalThinkingEmitted;
              state.finalTextEmitted = summary.text || state.finalTextEmitted;
            }

            const usage = asRecord(lastMessage?.usage);
            if (usage) {
              const inputTokens = asNumber(usage.inputTokens ?? usage.input, 0);
              const outputTokens = asNumber(usage.outputTokens ?? usage.output, 0);
              const cachedTokens = asNumber(usage.cacheRead ?? usage.cachedInputTokens, 0);
              const costRecord = asRecord(usage.cost);
              const costUsd = asNumber(costRecord?.total ?? usage.costUsd, 0);

              if (inputTokens > 0 || outputTokens > 0) {
                entries.push({
                  kind: "result",
                  ts,
                  text: "Run completed",
                  inputTokens,
                  outputTokens,
                  cachedTokens,
                  costUsd,
                  subtype: "end",
                  isError: false,
                  errors: [],
                });
              }
            }
          }
        }

        return entries;
      }

      // Unknown future pi event types: one bounded system line.
      return [{ kind: "system", ts, text: `[pi] ${truncateForStatus(type || "unnamed event", 60)}` }];
    },
  };
}
