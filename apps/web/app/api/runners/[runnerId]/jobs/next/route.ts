import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/auth";
import { nowIso, one, run, type RunnerProjectRow } from "@/lib/db";
import { claimNextRunnerJob, projectHasPermission } from "@/lib/local-projects";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ runnerId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const runnerId = (await context.params).runnerId;
    requireRunner(request, runnerId);
    const job = claimNextRunnerJob(runnerId);
    if (!job) return NextResponse.json({ job: null });
    const project = one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ? AND runner_id = ? AND revoked_at IS NULL", job.project_id, runnerId);
    if (!project) { run("UPDATE runner_jobs SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'", nowIso(), nowIso(), job.id); return NextResponse.json({ error: "The project grant is no longer active" }, { status: 409 }); }
    const required = job.kind === "apply_changes" ? "write" : job.kind === "verify" ? "verify" : "read";
    if (!projectHasPermission(project, required)) {
      const timestamp = nowIso();
      run("UPDATE runner_jobs SET status = 'cancelled', result_text = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'", `Project grant no longer includes ${required} permission.`, timestamp, timestamp, job.id);
      return NextResponse.json({ error: `The project grant no longer includes ${required} permission` }, { status: 409 });
    }
    return NextResponse.json({ job: { id: job.id, kind: job.kind, request: JSON.parse(job.request_json) as unknown, project: { id: project.id, label: project.label, rootFingerprint: project.root_fingerprint } } });
  } catch (error) { return authErrorResponse(error, "Unable to claim a local job"); }
}
