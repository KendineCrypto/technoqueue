import { analyzeIntegrity, createOfficeTaskInputSchema, createTaskInputSchema, serializeTask, workspaceSchema, type AgentProfile, type Task, type Workflow } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { one, type UserRow, writeAudit } from "@/lib/db";
import { queueForSlug } from "@/lib/workspace-technocore";
import { decryptIdentity } from "@/lib/secure-vault";
import { enforceRateLimit } from "@/lib/rate-limit";
import { runWorkspace } from "@/lib/office-runtime";
import { IntegrityViolationError, assertWorkspaceIntegrityConfirmed, ensureWorkspaceIntegrity, integrityErrorResponse, trustTechnocoreRecord, verifiedRecords } from "@/lib/technocore-integrity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };

function taskMatchesTrustedRoute(task: Task, workflow: Workflow, agents: Map<string, AgentProfile>) {
  if (!task.office || task.office.workflow_id !== workflow.id || task.office.workflow_name !== workflow.name || task.office.steps.length !== workflow.steps.length) return false;
  return task.office.steps.every((step, index) => {
    const routeStep = workflow.steps[index]; const agent = agents.get(step.agent_id);
    return Boolean(routeStep && agent && routeStep.agent_id === step.agent_id && routeStep.kind === step.kind && agent.did === step.agent_did && agent.name === step.name && agent.role === step.role);
  });
}

export async function GET(_: Request, context: Context) {
  try {
    const user = await requireUser();
    const workspace = workspaceSchema.parse((await context.params).workspace);
    const owned = await ownedWorkspace(workspace, user.id);
    const queue = queueForSlug(workspace);
    const [stored, events] = await Promise.all([verifiedRecords(owned, "task", queue.client), queue.listEvents()]);
    return NextResponse.json({ workspace, updatedAt: new Date().toISOString(), tasks: stored.map(({ value }) => ({ ...value, integrity: analyzeIntegrity(value, events) })) });
  } catch (error) {
    return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to load tasks");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    enforceRateLimit(`task-create:${user.id}`, 20, 60_000);
    const workspace = workspaceSchema.parse((await context.params).workspace);
    const owned = await ownedWorkspace(workspace, user.id);
    await ensureWorkspaceIntegrity(owned);
    await assertWorkspaceIntegrityConfirmed(owned);
    const body = await request.json() as unknown;
    const officeInput = createOfficeTaskInputSchema.safeParse(body);
    const queue = queueForSlug(workspace);
    let trustedWorkflow: Workflow | undefined;
    let trustedAgents = new Map<string, AgentProfile>();
    if (officeInput.success) {
      const [workflows, agents] = await Promise.all([verifiedRecords(owned, "workflow", queue.client), verifiedRecords(owned, "agent", queue.client)]);
      trustedWorkflow = workflows.find(({ value }) => value.id === officeInput.data.workflow_id)?.value;
      trustedAgents = new Map(agents.map(({ value }) => [value.id, value]));
      if (!trustedWorkflow) return NextResponse.json({ error: "The selected workflow is not trusted by this office" }, { status: 409 });
    }
    const task = officeInput.success && trustedWorkflow
      ? await queue.createOfficeFromTrustedRecords(officeInput.data, trustedWorkflow, [...trustedAgents.values()])
      : await queue.create(createTaskInputSchema.parse(body));
    if (officeInput.success && (!trustedWorkflow || !taskMatchesTrustedRoute(task, trustedWorkflow, trustedAgents))) throw new IntegrityViolationError("Technocore changed the workflow while the task was being created. The new record was quarantined.", task.id);
    trustTechnocoreRecord(owned, task.id, "task", serializeTask(task));
    const owner = one<UserRow>("SELECT * FROM users WHERE id = ?", user.id);
    if (owner) await queue.signedEvent(await decryptIdentity(owner.account_private_key_enc), { type: "task_created", task_id: task.id }).catch(() => undefined);
    writeAudit({ userId: user.id, workspaceId: owned.id, action: "task.created", targetId: task.id, metadata: { title: task.title } });
    void runWorkspace(owned).then((result) => {
      if (result.action === "error" || result.action === "integrity_error") console.error("[runtime]", owned.slug, result);
    }).catch((error: unknown) => console.error("[runtime]", owned.slug, error));
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to create task");
  }
}
