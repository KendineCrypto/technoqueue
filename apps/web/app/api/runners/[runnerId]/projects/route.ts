import { runnerProjectRequestPayload, runnerProjectRequestSchema, verifyDidSignature } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, AuthError } from "@/lib/auth";
import { writeAudit } from "@/lib/db";
import { createRunnerProject, publicProject } from "@/lib/local-projects";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ runnerId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const runnerId = (await context.params).runnerId;
    const runner = requireRunner(request, runnerId);
    enforceRateLimit(`runner-project:${runnerId}`, 12, 60_000);
    const input = runnerProjectRequestSchema.parse(await request.json());
    const payload = runnerProjectRequestPayload({ runnerId, label: input.label, rootFingerprint: input.rootFingerprint });
    if (!verifyDidSignature(runner.did, payload, input.signature)) throw new AuthError("Project request signature is invalid", 401);
    const project = createRunnerProject({ workspaceId: runner.workspace_id, runnerId, label: input.label, rootFingerprint: input.rootFingerprint });
    writeAudit({ workspaceId: runner.workspace_id, action: "runner.project_requested", targetId: project.id, metadata: { runnerId, label: project.label } });
    return NextResponse.json({ project: publicProject(project) }, { status: 201 });
  } catch (error) { return authErrorResponse(error, "Unable to request project access"); }
}
