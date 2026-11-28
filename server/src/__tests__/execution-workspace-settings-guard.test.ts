import { describe, expect, it } from "vitest";
import {
  assertWorkspaceSettingsMatchBoundWorkspace,
  WORKSPACE_SETTINGS_BINDING_CONFLICT_CODE,
} from "../services/execution-workspace-settings-guard.js";

/** Minimal drizzle-shaped stub: the guard runs exactly one
 * select({mode}).from().where().limit() chain. */
function fakeDb(rows: Array<{ mode: string }>) {
  const calls: { table?: unknown; where?: unknown } = { };
  return {
    calls,
    select: (projection: unknown) => {
      calls.table = projection;
      return {
        from: (table: unknown) => {
          calls.table = table;
          return {
            where: (where: unknown) => {
              calls.where = where;
              return {
                limit: async () => rows,
              };
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof assertWorkspaceSettingsMatchBoundWorkspace>[0]["db"];
}

const CONFLICTING = { mode: "isolated_workspace" };

describe("assertWorkspaceSettingsMatchBoundWorkspace", () => {
  it("rejects an isolated settings change while a shared workspace is bound", async () => {
    const db = fakeDb([{ mode: "shared_workspace" }]);
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: "ws-1",
        executionWorkspaceSettings: CONFLICTING,
      }),
    ).rejects.toMatchObject({
      status: 422,
      details: {
        workspaceValidation: { reason: WORKSPACE_SETTINGS_BINDING_CONFLICT_CODE },
      },
    });
  });

  it("includes the unbind remediation in the error message", async () => {
    const db = fakeDb([{ mode: "shared_workspace" }]);
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: "ws-1",
        executionWorkspaceSettings: CONFLICTING,
      }),
    ).rejects.toThrow(/executionWorkspaceId to null/);
  });

  it("allows the change when no workspace is bound", async () => {
    const db = fakeDb([]);
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: null,
        executionWorkspaceSettings: CONFLICTING,
      }),
    ).resolves.toBeUndefined();
  });

  it("allows the change when the bound workspace already matches the mode", async () => {
    const db = fakeDb([{ mode: "isolated_workspace" }]);
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: "ws-2",
        executionWorkspaceSettings: CONFLICTING,
      }),
    ).resolves.toBeUndefined();
  });

  it("does not police follow-along modes that intentionally follow the binding", async () => {
    const db = fakeDb([{ mode: "shared_workspace" }]);
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: "ws-1",
        executionWorkspaceSettings: { mode: "inherit" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: "ws-1",
        executionWorkspaceSettings: { mode: "reuse_existing" },
      }),
    ).resolves.toBeUndefined();
  });

  it("allows an unbound-mode change even when the parse yields no mode", async () => {
    const db = fakeDb([{ mode: "shared_workspace" }]);
    await expect(
      assertWorkspaceSettingsMatchBoundWorkspace({
        db,
        companyId: "c1",
        executionWorkspaceId: "ws-1",
        executionWorkspaceSettings: { sharedWorkspaceConcurrency: "auto" },
      }),
    ).resolves.toBeUndefined();
  });
});
