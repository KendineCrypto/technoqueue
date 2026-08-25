import { workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { listHostedAgentRows, listProviderRows, publicProvider } from "@/lib/persistent-office";
import { IntegrityViolationError, integrityErrorResponse, verifiedRecords, workspaceIntegritySummary } from "@/lib/technocore-integrity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };

export async function GET(_: Request, context: Context) {
  try {
    const workspace = workspaceSchema.parse((await context.params).workspace);
    const user = await requireUser();
    const owned = await ownedWorkspace(workspace, user.id);
    const hostedRows = listHostedAgentRows(owned.id);
    const hostedMap = new Map(hostedRows.map((value) => [value.agent_id, value]));
    const providerRows = listProviderRows(user.id);
    const providerMap = new Map(providerRows.map((value) => [value.id, value]));
    const [agents, workflows] = await Promise.all([verifiedRecords(owned, "agent"), verifiedRecords(owned, "workflow")]);
    const activeAgents = agents.filter(({ value }) => !value.fired_at);
    const activeAgentIds = new Set(activeAgents.map(({ value }) => value.id));
    return NextResponse.json({
      agents: activeAgents.map(({ value }) => {
        const hosted = hostedMap.get(value.id);
        const connection = hosted ? providerMap.get(hosted.connection_id) : undefined;
        return { ...value, sessionOwned: Boolean(hosted), configured: Boolean(connection), connectionLabel: connection?.label, connectionMaskedKey: connection ? publicProvider(connection).maskedKey : undefined, runningTaskId: hosted?.running_task_id ?? undefined, lastError: hosted?.last_error ?? undefined };
      }),
      workflows: workflows.map(({ value }) => value).filter((workflow) => workflow.steps.every((step) => activeAgentIds.has(step.agent_id))),
      providers: providerRows.map(publicProvider),
      canManage: true,
      ownerDid: user.account_did,
      eventRoom: owned.event_room,
      integrity: workspaceIntegritySummary(owned)
    });
  } catch (error) {
    return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to load office");
  }
}
