import { and, eq } from "drizzle-orm";
import type { Db } from "@pilibalaai/db";
import { executionWorkspaces } from "@pilibalaai/db";
import { unprocessable } from "../errors.js";
import { parseIssueExecutionWorkspaceSettings } from "./execution-workspace-policy.js";

export const WORKSPACE_SETTINGS_BINDING_CONFLICT_CODE =
  "workspace_settings_conflict_with_binding";

export const WORKSPACE_SETTINGS_BINDING_CONFLICT_REMEDIATION =
  "Detach the bound execution workspace in the same update (set executionWorkspaceId to null with executionWorkspacePreference \"inherit\"), then assign the task again so the new settings realize their own workspace.";

function settingsModeConflictsWithRealization(mode: string | undefined): boolean {
  // Only explicit per-task workspace modes realize their own workspace; the
  // inherit/reuse/agent-default modes follow the bound workspace by design.
  return (
    mode === "isolated_workspace" ||
    mode === "operator_branch" ||
    mode === "shared_workspace"
  );
}

/**
 * A bound execution workspace (execution_workspace_id + reuse preference) pins
 * the run's realization to that workspace row: changing the issue's workspace
 * settings mode alone does NOT re-realize — the run keeps the bound workspace
 * and workspace preparation writes the realized (old-mode) settings back onto
 * the issue, silently undoing the operator's change (AMB-419 / W2.1 audit).
 *
 * Fail that mutation loudly instead: reject the settings change while it
 * conflicts with the bound workspace's mode, with the unbind remediation.
 * Clearing the binding in the same update (executionWorkspaceId null) is the
 * supported path and skips this guard.
 */
export async function assertWorkspaceSettingsMatchBoundWorkspace(input: {
  db: Db;
  companyId: string;
  executionWorkspaceId: string | null | undefined;
  executionWorkspaceSettings: unknown;
}): Promise<void> {
  const settings = parseIssueExecutionWorkspaceSettings(
    input.executionWorkspaceSettings,
  );
  const mode = settings?.mode;
  if (!settingsModeConflictsWithRealization(mode)) return;
  if (!input.executionWorkspaceId) return;
  const [workspace] = await input.db
    .select({ mode: executionWorkspaces.mode })
    .from(executionWorkspaces)
    .where(
      and(
        eq(executionWorkspaces.id, input.executionWorkspaceId),
        eq(executionWorkspaces.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!workspace || workspace.mode === mode) return;
  throw unprocessable(
    `Workspace settings mode "${mode}" conflicts with the bound execution workspace (mode "${workspace.mode}"). The bound workspace pins the run's realization, so this change would be silently ignored and then overwritten. ` +
      WORKSPACE_SETTINGS_BINDING_CONFLICT_REMEDIATION,
    { workspaceValidation: { reason: WORKSPACE_SETTINGS_BINDING_CONFLICT_CODE } },
  );
}
