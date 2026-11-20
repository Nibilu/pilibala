DROP INDEX "agent_instruction_copies_collection_idx";--> statement-breakpoint
DROP INDEX "agent_instruction_copies_cleanup_idx";--> statement-breakpoint
DROP INDEX "heartbeat_runs_cancelled_workspace_preservation_idx";--> statement-breakpoint
DROP INDEX "heartbeat_runs_retained_recovery_adoption_idx";--> statement-breakpoint
DROP INDEX "issue_recovery_actions_system_recovery_adoption_idx";--> statement-breakpoint
DROP INDEX "issue_recovery_actions_retained_workspace_recovery_idx";--> statement-breakpoint
ALTER TABLE "execution_workspace_snapshots" ALTER COLUMN "format" SET DEFAULT 'pilibala.remote-workspace-archive.v1';--> statement-breakpoint
CREATE INDEX "agent_instruction_copies_collection_idx" ON "agent_instruction_working_copies" USING btree ("run_id","company_id") WHERE NOT (coalesce("agent_instruction_working_copies"."receipt", '{}'::jsonb) ? 'retainedByRunId') AND (
      ("agent_instruction_working_copies"."attempts" < 3 AND ("agent_instruction_working_copies"."state" IN ('prepared', 'pending_collection', 'unchanged_turn', 'warm_saved')
        OR ("agent_instruction_working_copies"."state" = 'preparing' AND "agent_instruction_working_copies"."receipt"->>'schema' = 'pilibala.agent-files.v1')))
      OR ("agent_instruction_working_copies"."state" = 'unavailable' AND "agent_instruction_working_copies"."process_stopped_at" IS NULL
        AND "agent_instruction_working_copies"."location" LIKE 'remote:%' AND "agent_instruction_working_copies"."receipt"->>'schema' = 'pilibala.agent-files.v1'));--> statement-breakpoint
CREATE INDEX "agent_instruction_copies_cleanup_idx" ON "agent_instruction_working_copies" USING btree ("run_id","company_id") WHERE "agent_instruction_working_copies"."state" IN ('saved', 'unchanged', 'resolved', 'unavailable')
      AND "agent_instruction_working_copies"."process_stopped_at" IS NOT NULL
      AND "agent_instruction_working_copies"."receipt"->>'schema' = 'pilibala.agent-files.v1'
      AND coalesce("agent_instruction_working_copies"."receipt"->>'retainedByRunId', '') = ''
      AND "agent_instruction_working_copies"."receipt"->>'cleanupPending' IS DISTINCT FROM 'false'
      AND ("agent_instruction_working_copies"."receipt" ? 'baseline' OR "agent_instruction_working_copies"."receipt"->>'cleanupPending' = 'true');--> statement-breakpoint
CREATE INDEX "heartbeat_runs_cancelled_workspace_preservation_idx" ON "heartbeat_runs" USING btree ("id","company_id") WHERE "heartbeat_runs"."runtime_mode" = 'native' AND "heartbeat_runs"."status" = 'cancelled'
        AND "heartbeat_runs"."runner_profile_json"->'nativeWorkspaceSync'->>'state' = 'prepared'
        AND "heartbeat_runs"."result_json"->'nativeCancellation'->>'dispatchState' = 'acknowledged'
        AND ("heartbeat_runs"."result_json"->'workspaceRestoreRecovery'->>'schema' = 'pilibala.workspace-restore-recovery.v1'
          AND "heartbeat_runs"."result_json"->>'workspaceRestoreFailure' IN ('restore_permission_denied', 'restore_lock_timeout', 'restore_unsafe_archive', 'restore_invalid_metadata', 'restore_failed')) IS NOT TRUE;--> statement-breakpoint
CREATE INDEX "heartbeat_runs_retained_recovery_adoption_idx" ON "heartbeat_runs" USING btree ("id") WHERE "heartbeat_runs"."result_json"->'workspaceRestoreRecovery'->>'schema' = 'pilibala.workspace-restore-recovery.v1'
        and not (coalesce("heartbeat_runs"."result_json", '{}'::jsonb) ? 'systemRecoveryAdoption')
        and "heartbeat_runs"."status" in ('failed', 'interrupted', 'timed_out', 'cancelled', 'succeeded');--> statement-breakpoint
CREATE INDEX "issue_recovery_actions_system_recovery_adoption_idx" ON "issue_recovery_actions" USING btree ("id") WHERE not ("issue_recovery_actions"."evidence" ? 'systemRecovery') and (
        "issue_recovery_actions"."evidence"->'workspaceRestoreRecovery'->>'schema' = 'pilibala.workspace-restore-recovery.v1'
        or "issue_recovery_actions"."cause" in ('native_workspace_sync_out_unrecoverable', 'native_workspace_sync_out_retry_exhausted')
      );--> statement-breakpoint
CREATE INDEX "issue_recovery_actions_retained_workspace_recovery_idx" ON "issue_recovery_actions" USING btree ("id") WHERE 
      ("issue_recovery_actions"."evidence"->'workspaceRestoreRecovery'->>'schema' = 'pilibala.workspace-restore-recovery.v1'
        or "issue_recovery_actions"."cause" in ('native_workspace_sync_out_unrecoverable', 'native_workspace_sync_out_retry_exhausted'))
      and ("issue_recovery_actions"."evidence"->'executionReconciliation' is null
        or "issue_recovery_actions"."evidence"#>>'{workspaceRecovery,status}' = 'recovered')
    ;