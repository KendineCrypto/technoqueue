import { runnerProjectIdSchema, runnerProjectPermissionSchema, workspaceSchema } from "@technoqueue/core";
import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, AuthError, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, one, run, writeAudit, type RunnerProjectRow } from "@/lib/db";
import { listProjects, publicProject } from "@/lib/local-projects";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };
const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), projectId: runnerProjectIdSchema, permissions: z.array(runnerProjectPermissionSchema).min(1).max(3) }).strict(),
  z.object({ action: z.literal("revoke"), projectId: runnerProjectIdSchema }).strict()
]);

export async function GET(_: Request, context: Context) {
  try { const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id); return NextResponse.json({ projects: listProjects(workspace.id).map(publicProject) }); }
  catch (error) { return authErrorResponse(error, "Unable to load local projects"); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id);
    const input = updateSchema.parse(await request.json());
    const project = one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL", input.projectId, workspace.id);
    if (!project) throw new AuthError("Local project not found", 404);
    const timestamp = nowIso();
    if (input.action === "revoke") {
      run("UPDATE runner_projects SET revoked_at = ?, updated_at = ? WHERE id = ?", timestamp, timestamp, project.id);
      run("UPDATE runner_jobs SET status = 'cancelled', result_text = CASE WHEN status = 'running' THEN 'Project revoked while the runner job was in flight. Local changes may already exist.' ELSE result_text END, completed_at = ?, lease_expires_at = NULL, updated_at = ? WHERE project_id = ? AND status IN ('awaiting_approval','queued','running')", timestamp, timestamp, project.id);
      writeAudit({ userId: user.id, workspaceId: workspace.id, action: "runner.project_revoked", targetId: project.id });
      return NextResponse.json({ ok: true });
    }
    const permissions = [...new Set(input.permissions)];
    if (!permissions.includes("read")) throw new AuthError("Every active project grant must include read permission", 400);
    run("UPDATE runner_projects SET permissions_json = ?, approved_at = ?, updated_at = ? WHERE id = ?", JSON.stringify(permissions), timestamp, timestamp, project.id);
    const approved = one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ?", project.id)!;
    writeAudit({ userId: user.id, workspaceId: workspace.id, action: "runner.project_approved", targetId: project.id, metadata: { permissions } });
    return NextResponse.json({ project: publicProject(approved) });
  } catch (error) { return authErrorResponse(error, "Unable to update local project"); }
}
