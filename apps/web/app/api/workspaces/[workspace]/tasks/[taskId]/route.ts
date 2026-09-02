import { analyzeIntegrity, approveOfficeCheckpoint, encodeEvent, recoverOfficeTask, rejectOfficeCheckpoint, serializeTask, taskIdSchema, workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, run, writeAudit } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { queueForSlug } from "@/lib/workspace-technocore";
import { IntegrityViolationError, integrityErrorResponse, replaceTrustedRecord, verifiedRecord } from "@/lib/technocore-integrity";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ workspace: string; taskId: string }> }) {
  try {
    const user = await requireUser();
    const values = await params; const workspace = workspaceSchema.parse(values.workspace); const taskId = taskIdSchema.parse(values.taskId);
    const owned = await ownedWorkspace(workspace, user.id);
    const queue = queueForSlug(workspace); const [stored, events] = await Promise.all([verifiedRecord(owned, taskId, "task", queue.client), queue.listEvents()]);
    return NextResponse.json({ task: stored.value, integrity: analyzeIntegrity(stored.value, events), events: events.filter((item) => item.event.task_id === taskId) });
  } catch (error) { return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to load task"); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }).strict(),
  z.object({ action: z.literal("approve_checkpoint"), step: z.number().int().min(0).max(4) }).strict(),
  z.object({ action: z.literal("reject_checkpoint"), step: z.number().int().min(0).max(4), feedback: z.string().trim().min(3).max(500) }).strict()
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ workspace: string; taskId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(`task-retry:${user.id}`, 12, 60_000);
    const values = await params; const workspace = workspaceSchema.parse(values.workspace); const taskId = taskIdSchema.parse(values.taskId);
    const action = actionSchema.parse(await request.json());
    const owned = await ownedWorkspace(workspace, user.id);
    const trusted = await verifiedRecord(owned, taskId, "task");
    const task = action.action === "retry" ? recoverOfficeTask(trusted.value) : action.action === "approve_checkpoint" ? approveOfficeCheckpoint(trusted.value, action.step) : rejectOfficeCheckpoint(trusted.value, action.step, action.feedback);
    await replaceTrustedRecord(owned, taskId, "task", serializeTask(task));
    const queue = queueForSlug(workspace);
    const dashboardEvent = action.action === "retry" ? { type: "task_recovered" as const, task_id: task.id } : action.action === "approve_checkpoint" ? { type: "checkpoint_approved" as const, task_id: task.id, step: action.step } : { type: "checkpoint_rejected" as const, task_id: task.id, step: action.step, feedback: action.feedback };
    await queue.client.sayUnsigned(queue.resources.room, "boss", encodeEvent(dashboardEvent)).catch(() => undefined);
    const agentId = task.office?.steps[task.office.current_step]?.agent_id;
    if (agentId) run("UPDATE hosted_agents SET last_error = NULL, retry_after = NULL, running_task_id = NULL, updated_at = ? WHERE workspace_id = ? AND agent_id = ?", nowIso(), owned.id, agentId);
    writeAudit({ userId: user.id, workspaceId: owned.id, action: action.action === "retry" ? "task.retry_requested" : action.action === "approve_checkpoint" ? "task.checkpoint_approved" : "task.checkpoint_rejected", targetId: taskId, metadata: { agentId, previousState: trusted.value.paper_route.state, ...(action.action === "retry" ? {} : { step: action.step }) } });
    return NextResponse.json({ task });
  } catch (error) { return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to retry task"); }
}
