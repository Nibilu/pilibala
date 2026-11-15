import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACPX_HANDSHAKE_TIMEOUT_MS } from "@pilibalaai/adapter-utils/acpx-engine/constants";
import {
  buildHermesAcpConfig,
  createHermesAcpExecutor,
  nodeVersionMeetsHermesAcpMinimum,
  resolveHermesAcpBillingIdentity,
  resolveHermesExecutionEngineForRun,
} from "./acp.js";
import { execute } from "./execute.js";
import { sessionCodec } from "./index.js";
import { testEnvironment } from "./test.js";

const originalVersion = process.version;
afterEach(() => Object.defineProperty(process, "version", { value: originalVersion }));

describe("hermes engine selection", () => {
  it("defaults to the shared ACP engine when engine is unset or unknown", async () => {
    await expect(resolveHermesExecutionEngineForRun({ config: {} }))
      .resolves.toMatchObject({ engine: "acp", explicit: false });
    await expect(resolveHermesExecutionEngineForRun({ config: { engine: "sometimes" } }))
      .resolves.toMatchObject({ engine: "acp", explicit: false });
  });

  it("keeps an explicitly selected CLI engine free of ACP prerequisites", async () => {
    Object.defineProperty(process, "version", { value: "v18.0.0" });
    await expect(resolveHermesExecutionEngineForRun({ config: { engine: "cli" } }))
      .resolves.toEqual({ engine: "cli", explicit: true });
  });

  it("reports a setup failure for engine=acp on an unsupported Node without starting a process", async () => {
    Object.defineProperty(process, "version", { value: "v18.0.0" });
    const config = { engine: "acp" };
    const onSpawn = vi.fn();
    const result = await execute({ config, onSpawn } as never);
    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "adapter_engine_unavailable",
      errorMessage: expect.stringContaining("Node v18.0.0"),
      resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } },
    });
    expect(result.errorMessage).toContain(process.execPath);
    expect(onSpawn).not.toHaveBeenCalled();
    const diagnostic = await testEnvironment({ config } as never);
    expect(diagnostic.status).toBe("fail");
    expect(diagnostic.checks).toContainEqual(expect.objectContaining({
      code: "adapter_engine_unavailable", level: "error",
    }));
  });

  it("keeps an unavailable ACP command as a failure, not a CLI selection", async () => {
    Object.defineProperty(process, "version", { value: "v24.11.0" });
    const result = await resolveHermesExecutionEngineForRun({
      config: { engine: "acp", agentCommand: "/nonexistent/pilibala-test/hermes-acp" },
    });
    expect(result.engine).toBe("acp");
    expect(result.unavailableReason).toContain("not available");
  });

  it.each([["v24.11.0", true], ["v24.10.9", false], ["v22.5.0", false], ["v25.0.0", true]])(
    "node %s meets minimum: %s",
    (version, expected) => {
      expect(nodeVersionMeetsHermesAcpMinimum(version)).toBe(expected);
    },
  );
});

describe("hermes acp config mapping", () => {
  it("forces the hermes agent id and forwards an explicit agent command", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      agentCommand: "/opt/hermes/bin/hermes-acp",
      mode: "oneshot",
    });
    expect(mapped).toMatchObject({
      agent: "hermes",
      agentCommand: "/opt/hermes/bin/hermes-acp",
      mode: "oneshot",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    });
  });

  it("pins agentCommand to hermes-acp so the engine never falls back to the bare CLI", () => {
    const mapped = buildHermesAcpConfig({ engine: "acp" });
    expect(mapped.agent).toBe("hermes");
    expect(mapped.agentCommand).toBe("hermes-acp");
  });

  it("qualifies a bare model with the projected provider for NVIDIA gateways", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      provider: "nvidia",
      model: "z-ai/glm-5.3-flash",
    });
    expect(mapped.model).toBe("nvidia:z-ai/glm-5.3-flash");
  });
  it("anchors a bare model to the projected route on managed runs", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      provider: "nvidia",
      model: "minimaxai/minimax-m3.1-flash",
      managedAiRouting: { kind: "gateway" },
    });
    expect(mapped.model).toBe("custom:minimaxai/minimax-m3.1-flash");
  });
  it("re-anchors a stale projected-provider prefix on managed runs", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      provider: "nvidia",
      model: "nvidia:minimaxai/minimax-m3.1-flash",
      managedAiRouting: { kind: "gateway" },
    });
    expect(mapped.model).toBe("custom:minimaxai/minimax-m3.1-flash");
  });
  it("keeps already-anchored or unknown transport-prefixed model ids unchanged", () => {
    expect(
      buildHermesAcpConfig({ engine: "acp", model: "custom:zai-org/GLM-5.3-Flash", managedAiRouting: { kind: "gateway" } }).model,
    ).toBe("custom:zai-org/GLM-5.3-Flash");
    expect(
      buildHermesAcpConfig({ engine: "acp", model: "somegate:weird-id", managedAiRouting: { kind: "gateway" } }).model,
    ).toBe("somegate:weird-id");
  });

  it("does not double-qualify an already provider-prefixed model", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      provider: "nvidia",
      model: "nvidia:z-ai/glm-5.3-flash",
    });
    expect(mapped.model).toBe("nvidia:z-ai/glm-5.3-flash");
  });

  it("accepts hermesCommand as the ACP server command override", () => {
    const mapped = buildHermesAcpConfig({
      engine: "acp",
      hermesCommand: "/opt/hermes/bin/hermes-acp",
    });
    expect(mapped.agentCommand).toBe("/opt/hermes/bin/hermes-acp");
  });

  it("reports an honest opaque billing identity instead of guessing a provider", () => {
    expect(resolveHermesAcpBillingIdentity()).toEqual({
      provider: "hermes",
      biller: "hermes",
      billingType: "unknown",
    });
  });
});

describe("Hermes ACP startup budget", () => {
  it("allows a fresh Hermes session to finish after the shared 60 second handshake bound", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pilibala-hermes-acp-handshake-"));
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let resolveEnsure!: (handle: unknown) => void;
    const ensureSessionPromise = new Promise((resolve) => { resolveEnsure = resolve; });
    const runtime = {
      ensureSession: () => { markStarted(); return ensureSessionPromise; },
      startTurn: () => ({
        events: (async function* () { yield { type: "done", stopReason: "end_turn" }; })(),
        result: Promise.resolve({ status: "completed" as const, stopReason: "end_turn" }),
        cancel: async () => {},
      }),
      close: async () => {},
    };
    const executeHermesAcp = createHermesAcpExecutor({ createRuntime: () => runtime as never });

    try {
      vi.useFakeTimers();
      const resultPromise = executeHermesAcp({
        runId: "run-hermes-long-handshake",
        agent: { id: "hermes-agent", companyId: "company-1" },
        runtime: {},
        config: { engine: "acp", agentCommand: "node ./fake-acp.js", stateDir: path.join(root, "state") },
        context: {},
        onLog: async () => {},
        onMeta: async () => {},
      } as never);
      await started;
      await vi.advanceTimersByTimeAsync(ACPX_HANDSHAKE_TIMEOUT_MS + 50);
      resolveEnsure({ backendSessionId: "backend-session", agentSessionId: "agent-session", runtimeSessionName: "runtime-session" });
      const result = await resultPromise;
      expect(result.exitCode).toBe(0);
      expect(result.errorCode).toBeNull();
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hermes session codec (dual engine)", () => {
  it("keeps CLI sessionId params unchanged", () => {
    const params = { sessionId: "session-123" };
    expect(sessionCodec.serialize(params)).toEqual(params);
    expect(sessionCodec.deserialize(params)).toEqual(params);
    expect(sessionCodec.getDisplayId?.(params) ?? null).toBe("session-123");
  });

  it("falls back to the acpx codec for ACP session params", () => {
    const params = {
      acpSessionId: "acp-1",
      configFingerprint: "fp-1",
      sessionKey: "pilibala:c:a:t:fp-1",
      cwd: "/tmp/w",
    };
    const serialized = sessionCodec.serialize(params);
    expect(serialized).toMatchObject({ acpSessionId: "acp-1", configFingerprint: "fp-1" });
    expect(sessionCodec.deserialize(serialized)).toMatchObject({ acpSessionId: "acp-1" });
    expect(sessionCodec.getDisplayId?.(params) ?? null).toBe("acp-1");
  });

  it("returns null for params of neither shape", () => {
    expect(sessionCodec.serialize({})).toBeNull();
    expect(sessionCodec.deserialize({})).toBeNull();
  });
});
