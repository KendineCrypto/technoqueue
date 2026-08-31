import { runnerJobIdSchema, workspaceSchema } from "@technoqueue/core";
import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, AuthError, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, one, run, writeAudit, type RunnerJobRow, type RunnerProjectRow } from "@/lib/db";
import { listJobs, projectHasPermission, publicJob } from "@/lib/local-projects";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };
const updateSchema = z.object({ jobId: runnerJobIdSchema, action: z.enum(["approve", "reject", "retry"]) }).strict();

export async function GET(_: Request, context: Context) {
  try { const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id); return NextResponse.json({ jobs: listJobs(workspace.id).map(publicJob) }); }
  catch (error) { return authErrorResponse(error, "Unable to load local jobs"); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id); const input = updateSchema.parse(await request.json());
    const job = one<RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ? AND workspace_id = ?", input.jobId, workspace.id);
    if (!job) throw new AuthError("Local job not found", 404);
    const project = one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ? AND workspace_id = ?", job.project_id, workspace.id);
    if (!project) throw new AuthError("Project grant not found", 404);
    const required = job.kind === "apply_changes" ? "write" : job.kind === "verify" ? "verify" : "read";
    if (input.action === "retry") {
      if (job.status !== "failed") throw new AuthError("Only failed jobs can be retried", 409);
      if (!projectHasPermission(project, required)) throw new AuthError(`Project grant does not include ${required} permission`, 403);
      const timestamp = nowIso();
      run("UPDATE runner_jobs SET status = 'queued', result_text = NULL, result_sha256 = NULL, receipt_signature = NULL, started_at = NULL, completed_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'", timestamp, job.id);
      writeAudit({ userId: user.id, workspaceId: workspace.id, action: "runner.job_retried", targetId: job.id, metadata: { kind: job.kind, taskId: job.task_id } });
      return NextResponse.json({ ok: true });
    }
    if (job.status !== "awaiting_approval") throw new AuthError("Local job is no longer waiting for approval", 409);
    if (input.action === "approve" && !projectHasPermission(project, required)) throw new AuthError(`Project grant does not include ${required} permission`, 403);
    const timestamp = nowIso(); const status = input.action === "approve" ? "queued" : "rejected";
    run("UPDATE runner_jobs SET status = ?, approved_at = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_approval'", status, input.action === "approve" ? timestamp : null, input.action === "reject" ? timestamp : null, timestamp, job.id);
    writeAudit({ userId: user.id, workspaceId: workspace.id, action: input.action === "approve" ? "runner.job_approved" : "runner.job_rejected", targetId: job.id, metadata: { kind: job.kind, taskId: job.task_id } });
    return NextResponse.json({ ok: true });
  } catch (error) { return authErrorResponse(error, "Unable to update local job"); }
}
