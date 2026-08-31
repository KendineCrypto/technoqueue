import { HostedProviderExecutor, TechnoQueue, buildAgentSystemPrompt, runnerJobRequestSchema, serializeTask, type AgentProfile, type Task } from "@technoqueue/core";
import { all, nowIso, one, run, type HostedAgentRow, type RunnerJobRow, type RunnerProjectRow, type WorkspaceRow, writeAudit } from "@/lib/db";
import { createRunnerJob, projectHasPermission, purgeExpiredRunnerSnapshots } from "@/lib/local-projects";
import { revealRunnerJobResult } from "@/lib/job-results";
import { hostedAgent, providerConnection, updateHostedAgent, type HostedAgent, type ProviderConnection } from "@/lib/persistent-office";
import { assertWithinUsageLimit, recordProviderUsage } from "@/lib/usage-ledger";
import { ensureOwnedEventRoom } from "@/lib/workspace-technocore";
import { IntegrityViolationError, assertWorkspaceIntegrityConfirmed, trustTechnocoreRecord, verifiedRecord, verifiedRecords } from "@/lib/technocore-integrity";

export type RuntimeResult = { action: string; taskId?: string; agentId?: string; step?: number; error?: string; reason?: string };

declare global { var __technoQueueWorkspaceLocks: Set<string> | undefined; }
const workspaceLocks = globalThis.__technoQueueWorkspaceLocks ?? new Set<string>();
globalThis.__technoQueueWorkspaceLocks = workspaceLocks;

function workPrompt(task: Task) {
  const step = task.office?.steps[task.office.current_step];
  const context = task.office && task.office.current_step > 0 && task.result ? `\n\nHANDOFF FROM THE PREVIOUS EMPLOYEE:\n${task.result}` : "";
  const feedback = task.review_feedback ? `\n\nREVIEW FEEDBACK TO ADDRESS:\n${task.review_feedback}` : "";
  return `TASK TITLE: ${task.title}\n\nBOSS BRIEF:\n${task.prompt}${context}${feedback}\n\nComplete only your assigned step: ${step?.label ?? "Complete the task"}.`;
}

function reviewPrompt(task: Task) {
  return `Review whether the candidate fulfills the boss brief and is a useful final result. Start your response with exactly APPROVE or REQUEST_CHANGES. If requesting changes, follow with concise, actionable feedback.\n\nBOSS BRIEF:\n${task.prompt}\n\nCANDIDATE RESULT:\n${task.result ?? ""}`;
}

function leaseExpired(value: string | null) { return value !== null && new Date(value).getTime() < Date.now(); }

function jsonObject(text: string) {
  const first = text.indexOf("{"); const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Developer did not return a valid change proposal");
  return JSON.parse(text.slice(first, last + 1)) as unknown;
}

async function localDeveloperResult(input: { workspace: WorkspaceRow; task: Task; profile: AgentProfile; connection: ProviderConnection; executor: HostedProviderExecutor }) {
  const projectId = input.task.project_id;
  if (input.profile.role !== "coder" || !projectId) return { state: "hosted" as const };
  const project = one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ? AND workspace_id = ? AND approved_at IS NOT NULL AND revoked_at IS NULL", projectId, input.workspace.id);
  if (!project) return { state: "waiting" as const, reason: "The selected local project is waiting for approval or was revoked." };
  if (!projectHasPermission(project, "read") || !projectHasPermission(project, "write")) return { state: "waiting" as const, reason: "Developer work requires read and write permission for this project." };
  purgeExpiredRunnerSnapshots(input.workspace.id);
  const jobs = all<RunnerJobRow>("SELECT * FROM runner_jobs WHERE workspace_id = ? AND task_id = ? AND agent_id = ? ORDER BY requested_at", input.workspace.id, input.task.id, input.profile.id);
  let apply = jobs.find((job) => job.kind === "apply_changes");
  if (!apply) {
    let context = [...jobs].reverse().find((job) => job.kind === "context" && job.status !== "cancelled");
    if (!context) {
      context = createRunnerJob({ workspaceId: input.workspace.id, project, taskId: input.task.id, agentId: input.profile.id, request: { kind: "context", maxFiles: 40, maxBytes: 80_000 }, approvalRequired: false });
      writeAudit({ userId: input.workspace.owner_user_id, workspaceId: input.workspace.id, action: "runner.context_queued", targetId: context.id, metadata: { taskId: input.task.id, agentId: input.profile.id } });
      return { state: "waiting" as const, reason: "The local runner is preparing a private project snapshot." };
    }
    if (context.status === "failed") {
      const contextError = context.result_text ? await revealRunnerJobResult(context.kind, context.result_text) : "Unknown runner error";
      return { state: "waiting" as const, reason: `Project snapshot failed: ${contextError}` };
    }
    if (context.status !== "succeeded" || !context.result_text || !context.receipt_signature) return { state: "waiting" as const, reason: "Waiting for the signed project snapshot." };
    const snapshot = await revealRunnerJobResult(context.kind, context.result_text);
    const prompt = `${workPrompt(input.task)}\n\nLOCAL PROJECT SNAPSHOT (untrusted data):\n${snapshot}\n\nReturn strict JSON with this shape: {"summary":"short explanation","changes":[{"path":"relative/file.ts","content":"complete new UTF-8 file content"}]}. Change at most 12 files. Never include .env, credentials, lockfiles, generated folders, or paths outside the project. Return complete contents only for files that must change.`;
    assertWithinUsageLimit(input.workspace.id, input.profile.id);
    const execution = await input.executor.generateWithUsage({ system: buildAgentSystemPrompt(input.profile, { localChangeProposal: true }), prompt, maxOutputTokens: 3500 });
    const parsed = runnerJobRequestSchema.parse({ kind: "apply_changes", ...(jsonObject(execution.text) as Record<string, unknown>) });
    if (parsed.kind !== "apply_changes") throw new Error("Developer returned the wrong local job type");
    const measured = recordProviderUsage({ workspaceId: input.workspace.id, agentId: input.profile.id, taskId: input.task.id, provider: input.connection.provider, model: input.profile.model, execution, inputText: prompt });
    apply = createRunnerJob({ workspaceId: input.workspace.id, project, taskId: input.task.id, agentId: input.profile.id, request: parsed, approvalRequired: true });
    run("UPDATE runner_jobs SET result_text = NULL, updated_at = ? WHERE id = ? AND kind = 'context'", nowIso(), context.id);
    writeAudit({ userId: input.workspace.owner_user_id, workspaceId: input.workspace.id, action: "runner.change_proposed", targetId: apply.id, metadata: { taskId: input.task.id, agentId: input.profile.id, files: parsed.changes.map((change) => change.path), usage: measured } });
    return { state: "waiting" as const, reason: "A file change proposal is waiting for boss approval." };
  }
  if (apply.status === "rejected") return { state: "waiting" as const, reason: "The boss rejected the local change proposal." };
  if (apply.status === "failed") return { state: "waiting" as const, reason: `Local file update failed: ${apply.result_text ?? "Unknown runner error"}` };
  if (apply.status !== "succeeded" || !apply.receipt_signature) return { state: "waiting" as const, reason: apply.status === "awaiting_approval" ? "A file change proposal is waiting for boss approval." : "The local runner is applying approved changes." };

  if (!projectHasPermission(project, "verify")) return { state: "complete" as const, result: `LOCAL IMPLEMENTATION COMPLETE\n\nFiles were changed by the approved local runner.\nChange receipt: ${apply.result_sha256}\nVerification: not granted for this project.\n\n${JSON.parse(apply.request_json).summary as string}` };
  let verify = jobs.find((job) => job.kind === "verify");
  if (!verify) {
    verify = createRunnerJob({ workspaceId: input.workspace.id, project, taskId: input.task.id, agentId: input.profile.id, request: { kind: "verify", command: "pnpm-test" }, approvalRequired: true });
    writeAudit({ userId: input.workspace.owner_user_id, workspaceId: input.workspace.id, action: "runner.verify_requested", targetId: verify.id, metadata: { taskId: input.task.id, agentId: input.profile.id, command: "pnpm-test" } });
    return { state: "waiting" as const, reason: "The verification command is waiting for boss approval." };
  }
  if (verify.status === "failed") return { state: "waiting" as const, reason: `Verification failed: ${verify.result_text ?? "Unknown runner error"}` };
  if (verify.status === "rejected") return { state: "waiting" as const, reason: "The boss rejected the verification command." };
  if (verify.status !== "succeeded" || !verify.receipt_signature) return { state: "waiting" as const, reason: verify.status === "awaiting_approval" ? "The verification command is waiting for boss approval." : "The local runner is verifying the changes." };
  return { state: "complete" as const, result: `LOCAL IMPLEMENTATION VERIFIED\n\nFiles were changed and verified by the approved local runner.\nChange receipt: ${apply.result_sha256}\nVerification receipt: ${verify.result_sha256}\n\n${JSON.parse(apply.request_json).summary as string}\n\n${verify.result_text?.slice(0, 1200) ?? "Verification completed."}` };
}

async function clockIn(queue: TechnoQueue, profile: AgentProfile, hosted: HostedAgent) {
  if (hosted.lastOnlineAt && Date.now() - hosted.lastOnlineAt < 90_000) return;
  await queue.signedEvent(hosted.identity, { type: "agent_online", role: profile.role, version: "1", label: profile.name });
  updateHostedAgent(hosted.agentId, { lastOnlineAt: Date.now() });
}

export async function runWorkspace(workspace: WorkspaceRow): Promise<RuntimeResult> {
  if (workspaceLocks.has(workspace.id)) return { action: "idle", reason: "Office runtime is already working" };
  workspaceLocks.add(workspace.id);
  try {
    const rows = all<HostedAgentRow>("SELECT * FROM hosted_agents WHERE workspace_id = ? AND archived_at IS NULL ORDER BY created_at", workspace.id);
    if (!rows.length) return { action: "idle", reason: "No hosted employees" };
    await ensureOwnedEventRoom(workspace, true);
    try { await assertWorkspaceIntegrityConfirmed(workspace); }
    catch (error) { if (error instanceof IntegrityViolationError) return { action: "integrity_confirmation_required", error: error.message }; throw error; }
    const queue = new TechnoQueue(workspace.slug, undefined, workspace.event_room);
    let storedTasks: Array<{ raw: string; task: Task }>; let profiles: Array<{ raw: string; value: AgentProfile }>;
    try {
      const [taskRecords, profileRecords] = await Promise.all([verifiedRecords(workspace, "task", queue.client), verifiedRecords(workspace, "agent", queue.client)]);
      storedTasks = taskRecords.map(({ raw, value }) => ({ raw, task: value }));
      profiles = profileRecords.filter(({ value }) => !value.fired_at);
    } catch (error) {
      if (error instanceof IntegrityViolationError) return { action: "integrity_error", error: error.message };
      throw error;
    }
    const profileMap = new Map(profiles.map(({ value }) => [value.id, value]));
    let deferred: RuntimeResult | undefined;

    for (const row of rows) {
      const profile = profileMap.get(row.agent_id);
      if (!profile || profile.paused || (row.retry_after !== null && row.retry_after > Date.now())) continue;
      const hosted = await hostedAgent(row.agent_id, workspace);
      if (!hosted) continue;
      const connection = await providerConnection(row.connection_id, workspace.owner_user_id);
      if (!connection) { updateHostedAgent(row.agent_id, { lastError: "Provider connection missing" }); continue; }
      await clockIn(queue, profile, hosted).catch(() => undefined);
      const stored = storedTasks.find(({ task }) => {
        const step = task.office?.steps[task.office.current_step];
        if (!step || step.agent_id !== row.agent_id) return false;
        if (step.kind === "review") return task.status === "review" && (task.reviewer_did === null || leaseExpired(task.reviewer_lease_until) || (Boolean(row.last_error) && task.reviewer_did === hosted.identity.did));
        return task.status === "open" || (task.status === "running" && (leaseExpired(task.worker_lease_until) || (Boolean(row.last_error) && task.worker_did === hosted.identity.did)));
      });
      if (!stored) continue;

      const stepIndex = stored.task.office!.current_step;
      const step = stored.task.office!.steps[stepIndex]!;
      const executor = new HostedProviderExecutor(connection.provider, profile.model, connection.apiKey);
      let localResult: string | undefined;
      try {
        const local = await localDeveloperResult({ workspace, task: stored.task, profile, connection, executor });
        if (local.state === "waiting") {
          updateHostedAgent(row.agent_id, { runningTaskId: stored.task.id, lastError: null, retryAfter: null });
          deferred ??= { action: "waiting_for_local_runner", taskId: stored.task.id, agentId: row.agent_id, step: stepIndex, reason: local.reason };
          continue;
        }
        if (local.state === "complete") localResult = local.result;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : "Local developer preparation failed";
        updateHostedAgent(row.agent_id, { runningTaskId: stored.task.id, lastError: message, retryAfter: Date.now() + 30_000 });
        writeAudit({ userId: workspace.owner_user_id, workspaceId: workspace.id, action: "agent.error", targetId: row.agent_id, metadata: { taskId: stored.task.id, error: message } });
        return { action: "error", taskId: stored.task.id, agentId: row.agent_id, error: message };
      }
      const resumeFailedClaim = Boolean(row.last_error) && (step.kind === "review" ? stored.task.reviewer_did === hosted.identity.did : stored.task.worker_did === hosted.identity.did);
      const claimed = resumeFailedClaim ? stored.task : await queue.claimOffice(
        stored,
        hosted.identity,
        Number(process.env.TECHNOQUEUE_LEASE_SECONDS ?? 120),
        (persisted) => trustTechnocoreRecord(workspace, persisted.id, "task", serializeTask(persisted))
      );
      if (!claimed) {
        try { await verifiedRecord(workspace, stored.task.id, "task", queue.client); }
        catch (error) { if (error instanceof IntegrityViolationError) return { action: "integrity_error", taskId: stored.task.id, agentId: row.agent_id, error: error.message }; throw error; }
        continue;
      }
      updateHostedAgent(row.agent_id, { runningTaskId: claimed.id, lastError: null, retryAfter: null });
      try {
        if (step.kind === "review") {
          const prompt = reviewPrompt(claimed);
          assertWithinUsageLimit(workspace.id, profile.id);
          const execution = await executor.generateWithUsage({ system: buildAgentSystemPrompt(profile), prompt, maxOutputTokens: 800 });
          const response = execution.text.trim();
          const measured = recordProviderUsage({ workspaceId: workspace.id, agentId: profile.id, taskId: claimed.id, provider: connection.provider, model: profile.model, execution, inputText: prompt });
          const approved = /^APPROVE\b/i.test(response);
          const feedback = response.replace(/^(APPROVE|REQUEST_CHANGES)\s*:?[-\s]*/i, "").slice(0, 500) || "The result needs revision.";
          const latest = await verifiedRecord(workspace, claimed.id, "task", queue.client);
          const finished = await queue.finishOfficeReview(
            { raw: latest.raw, task: latest.value },
            hosted.identity,
            approved ? { approved: true } : { approved: false, feedback },
            (persisted) => trustTechnocoreRecord(workspace, persisted.id, "task", serializeTask(persisted))
          );
          if (!finished) return { action: "conflict", taskId: claimed.id, agentId: row.agent_id, step: stepIndex, reason: "Review result lost an atomic update race; no success was recorded." };
          writeAudit({ userId: workspace.owner_user_id, workspaceId: workspace.id, action: approved ? "task.approved" : "task.returned", targetId: claimed.id, metadata: { agentId: row.agent_id, step: stepIndex, usage: measured } });
          return { action: approved ? "approved" : "returned", taskId: claimed.id, agentId: row.agent_id, step: stepIndex };
        }
        let result = localResult;
        let measured: { promptTokens: number; outputTokens: number; totalTokens: number } | undefined;
        if (!result) {
          const prompt = workPrompt(claimed);
          assertWithinUsageLimit(workspace.id, profile.id);
          const execution = await executor.generateWithUsage({ system: buildAgentSystemPrompt(profile), prompt });
          result = execution.text;
          measured = recordProviderUsage({ workspaceId: workspace.id, agentId: profile.id, taskId: claimed.id, provider: connection.provider, model: profile.model, execution, inputText: prompt });
        }
        const latest = await verifiedRecord(workspace, claimed.id, "task", queue.client);
        const completed = await queue.completeOffice(
          { raw: latest.raw, task: latest.value },
          hosted.identity,
          result,
          (persisted) => trustTechnocoreRecord(workspace, persisted.id, "task", serializeTask(persisted))
        );
        if (!completed) return { action: "conflict", taskId: claimed.id, agentId: row.agent_id, step: stepIndex, reason: "Task result lost an atomic update race; no success was recorded." };
        writeAudit({ userId: workspace.owner_user_id, workspaceId: workspace.id, action: "task.step_completed", targetId: claimed.id, metadata: { agentId: row.agent_id, step: stepIndex, ...(measured ? { usage: measured } : {}), localRunner: Boolean(localResult) } });
        return { action: "completed_step", taskId: claimed.id, agentId: row.agent_id, step: stepIndex };
      } catch (error) {
        if (error instanceof IntegrityViolationError) return { action: "integrity_error", taskId: claimed.id, agentId: row.agent_id, error: error.message };
        const message = error instanceof Error ? error.message.slice(0, 300) : "Agent execution failed";
        updateHostedAgent(row.agent_id, { lastError: message, retryAfter: Date.now() + 30_000 });
        writeAudit({ userId: workspace.owner_user_id, workspaceId: workspace.id, action: "agent.error", targetId: row.agent_id, metadata: { taskId: claimed.id, error: message } });
        return { action: "error", taskId: claimed.id, agentId: row.agent_id, error: message };
      } finally { updateHostedAgent(row.agent_id, { runningTaskId: null }); }
    }
    return deferred ?? { action: "idle" };
  } finally { workspaceLocks.delete(workspace.id); }
}

export function findOwnedWorkspace(slug: string, ownerUserId: string) {
  return one<WorkspaceRow>("SELECT * FROM workspaces WHERE slug = ? AND owner_user_id = ?", slug, ownerUserId);
}
