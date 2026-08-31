import { runnerJobResultPayload, runnerJobResultSchema, sha256, verifyDidSignature } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, AuthError } from "@/lib/auth";
import { nowIso, one, run, writeAudit, type RunnerJobRow } from "@/lib/db";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ runnerId: string; jobId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { runnerId, jobId } = await context.params;
    const runner = requireRunner(request, runnerId);
    const input = runnerJobResultSchema.parse(await request.json());
    if (input.jobId !== jobId) throw new AuthError("Job result does not match the route", 400);
    if (sha256(input.result) !== input.resultSha256) throw new AuthError("Job result hash does not match", 400);
    const payload = runnerJobResultPayload(input);
    if (!verifyDidSignature(runner.did, payload, input.signature)) throw new AuthError("Job receipt signature is invalid", 401);
    const job = one<RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ? AND runner_id = ?", jobId, runnerId);
    if (!job) throw new AuthError("Local job not found", 404);
    if (job.status !== "running") throw new AuthError("Local job is not running", 409);
    const result = run("UPDATE runner_jobs SET status = ?, result_text = ?, result_sha256 = ?, receipt_signature = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'", input.status, input.result, input.resultSha256, input.signature, input.completedAt, nowIso(), jobId);
    if (Number(result.changes) !== 1) throw new AuthError("Local job changed before the result was stored", 409);
    writeAudit({ workspaceId: runner.workspace_id, action: input.status === "succeeded" ? "runner.job_succeeded" : "runner.job_failed", targetId: jobId, metadata: { runnerId, kind: job.kind, taskId: job.task_id, resultSha256: input.resultSha256 } });
    return NextResponse.json({ ok: true });
  } catch (error) { return authErrorResponse(error, "Unable to store local job receipt"); }
}
