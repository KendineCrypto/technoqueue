import { createWorkflowInputSchema, newWorkflow, resourcesForWorkspace, workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { IntegrityViolationError, assertWorkspaceIntegrityConfirmed, ensureWorkspaceIntegrity, integrityErrorResponse, trustTechnocoreRecord, verifiedRecords } from "@/lib/technocore-integrity";
import { queueForSlug } from "@/lib/workspace-technocore";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    enforceRateLimit(`workflow-create:${user.id}`, 10, 60_000);
    const workspace = workspaceSchema.parse((await context.params).workspace);
    const owned = await ownedWorkspace(workspace, user.id);
    await ensureWorkspaceIntegrity(owned);
    await assertWorkspaceIntegrityConfirmed(owned);
    const input = createWorkflowInputSchema.parse(await request.json());
    const agents = new Map((await verifiedRecords(owned, "agent")).map(({ value }) => [value.id, value]));
    for (const [index, step] of input.steps.entries()) {
      const agent = agents.get(step.agent_id);
      if (!agent) return NextResponse.json({ error: `Employee in step ${index + 1} is not trusted by this office` }, { status: 409 });
      if ((step.kind === "review") !== (agent.role === "reviewer")) return NextResponse.json({ error: `Step ${index + 1} kind does not match the trusted employee role` }, { status: 409 });
    }
    const workflow = newWorkflow(workspace, input);
    const raw = JSON.stringify(workflow);
    await queueForSlug(workspace).client.setNoteIfAbsent(resourcesForWorkspace(workspace).namespace, workflow.id, raw);
    trustTechnocoreRecord(owned, workflow.id, "workflow", raw);
    writeAudit({ userId: user.id, workspaceId: owned.id, action: "workflow.created", targetId: workflow.id, metadata: { name: workflow.name } });
    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error) {
    return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to create workflow");
  }
}
