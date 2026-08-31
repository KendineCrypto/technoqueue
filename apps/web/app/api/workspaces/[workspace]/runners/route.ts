import { runnerLabelSchema, workspaceSchema } from "@technoqueue/core";
import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, AuthError, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, run, writeAudit } from "@/lib/db";
import { createRunnerPairing, listWorkspaceRunners, publicRunner } from "@/lib/local-runner";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };
const createSchema = z.object({ label: runnerLabelSchema.optional() }).strict();
const revokeSchema = z.object({ runnerId: z.string().regex(/^runner-[0-9a-f-]{36}$/) }).strict();

export async function GET(_: Request, context: Context) {
  try {
    const user = await requireUser();
    const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id);
    return NextResponse.json({ runners: listWorkspaceRunners(workspace.id).map(publicRunner) });
  } catch (error) {
    return authErrorResponse(error, "Unable to load runners");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(`runner-pair-create:${user.id}`, 10, 10 * 60_000);
    const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id);
    if (listWorkspaceRunners(workspace.id).length >= 5) throw new AuthError("This office already has the maximum of 5 active runners", 409);
    const input = createSchema.parse(await request.json());
    const pairing = createRunnerPairing({ workspaceId: workspace.id, userId: user.id, ...(input.label ? { label: input.label } : {}) });
    writeAudit({ userId: user.id, workspaceId: workspace.id, action: "runner.pairing_created", metadata: { label: pairing.label, expiresAt: pairing.expiresAt } });
    return NextResponse.json({ pairing });
  } catch (error) {
    return authErrorResponse(error, "Unable to create runner pairing");
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id);
    const input = revokeSchema.parse(await request.json());
    const result = run("UPDATE local_runners SET revoked_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL", nowIso(), nowIso(), input.runnerId, workspace.id);
    if (Number(result.changes) !== 1) throw new AuthError("Runner not found", 404);
    writeAudit({ userId: user.id, workspaceId: workspace.id, action: "runner.revoked", targetId: input.runnerId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error, "Unable to revoke runner");
  }
}
