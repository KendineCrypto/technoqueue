import { analyzeIntegrity, taskIdSchema, workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { queueForSlug } from "@/lib/workspace-technocore";
import { IntegrityViolationError, integrityErrorResponse, verifiedRecord } from "@/lib/technocore-integrity";
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
