import { agentProfileSchema, createAgentProfileInputSchema, workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, one, run, type HostedAgentRow, writeAudit } from "@/lib/db";
import { providerConnection } from "@/lib/persistent-office";
import { ensureOwnedEventRoom } from "@/lib/workspace-technocore";
import { IntegrityViolationError, integrityErrorResponse, replaceTrustedRecord, verifiedRecord } from "@/lib/technocore-integrity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string; agentId: string }> };
const updateSchema = createAgentProfileInputSchema.partial().extend({
  connectionId: z.string().min(1).max(40).optional(),
  fallbackConnectionId: z.string().min(1).max(40).nullable().optional(),
  fallbackModel: z.string().trim().min(1).max(100).nullable().optional(),
  paused: z.boolean().optional(),
  retryNow: z.boolean().optional()
}).strict();

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    const { workspace: rawWorkspace, agentId } = await context.params;
    const workspace = workspaceSchema.parse(rawWorkspace);
    const owned = await ownedWorkspace(workspace, user.id);
    const hosted = one<HostedAgentRow>("SELECT * FROM hosted_agents WHERE agent_id = ? AND workspace_id = ? AND archived_at IS NULL", agentId, owned.id);
    if (!hosted) return NextResponse.json({ error: "Employee not found in this office" }, { status: 404 });
    const trusted = await verifiedRecord(owned, agentId, "agent");
    const input = updateSchema.parse(await request.json());
    if (input.fallbackConnectionId && input.fallbackConnectionId === (input.connectionId ?? hosted.connection_id)) return NextResponse.json({ error: "Fallback connection must be different from the primary connection" }, { status: 400 });
    if (input.retryNow) run("UPDATE hosted_agents SET retry_after = NULL, last_error = NULL, updated_at = ? WHERE agent_id = ?", nowIso(), agentId);
    if (input.model) run("UPDATE hosted_agents SET retry_after = NULL WHERE agent_id = ?", agentId);
    if (input.connectionId) {
      const connection = await providerConnection(input.connectionId, user.id);
      if (!connection) return NextResponse.json({ error: "Provider connection not found" }, { status: 400 });
      if (input.provider && input.provider !== connection.provider) return NextResponse.json({ error: "Provider and connection do not match" }, { status: 400 });
      run("UPDATE hosted_agents SET connection_id = ?, last_error = NULL, retry_after = NULL, updated_at = ? WHERE agent_id = ?", input.connectionId, nowIso(), agentId);
    }
    if (input.fallbackConnectionId !== undefined) {
      const fallback = input.fallbackConnectionId ? await providerConnection(input.fallbackConnectionId, user.id) : undefined;
      if (input.fallbackConnectionId && !fallback) return NextResponse.json({ error: "Fallback provider connection not found" }, { status: 400 });
      if (fallback && !input.fallbackModel) return NextResponse.json({ error: "Choose a fallback model" }, { status: 400 });
      run("UPDATE hosted_agents SET fallback_connection_id = ?, fallback_model = ?, updated_at = ? WHERE agent_id = ?", input.fallbackConnectionId ?? null, input.fallbackConnectionId ? input.fallbackModel ?? null : null, nowIso(), agentId);
    } else if (input.fallbackModel !== undefined && hosted.fallback_connection_id) {
      run("UPDATE hosted_agents SET fallback_model = ?, updated_at = ? WHERE agent_id = ?", input.fallbackModel, nowIso(), agentId);
    }
    const publicUpdate = { ...input };
    delete publicUpdate.connectionId;
    delete publicUpdate.fallbackConnectionId;
    delete publicUpdate.fallbackModel;
    delete publicUpdate.retryNow;
    const clean = Object.fromEntries(Object.entries(publicUpdate).filter(([, value]) => value !== undefined));
    const agent = agentProfileSchema.parse({ ...trusted.value, ...clean, id: trusted.value.id, did: trusted.value.did, workspace, updated_at: nowIso() });
    await replaceTrustedRecord(owned, agentId, "agent", JSON.stringify(agent));
    writeAudit({ userId: user.id, workspaceId: owned.id, action: "employee.updated", targetId: agentId });
    return NextResponse.json({ agent: { ...agent, sessionOwned: true, configured: true } });
  } catch (error) { return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to update employee"); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    const { workspace: rawWorkspace, agentId } = await context.params;
    const workspace = workspaceSchema.parse(rawWorkspace);
    const owned = await ownedWorkspace(workspace, user.id);
    const hosted = one<HostedAgentRow>("SELECT * FROM hosted_agents WHERE agent_id = ? AND workspace_id = ? AND archived_at IS NULL", agentId, owned.id);
    if (!hosted) return NextResponse.json({ error: "Employee not found in this office" }, { status: 404 });
    const trusted = await verifiedRecord(owned, agentId, "agent");
    const timestamp = nowIso();
    const agent = agentProfileSchema.parse({ ...trusted.value, paused: true, fired_at: timestamp, updated_at: timestamp });
    await replaceTrustedRecord(owned, agentId, "agent", JSON.stringify(agent));
    run("UPDATE hosted_agents SET archived_at = ?, running_task_id = NULL, updated_at = ? WHERE agent_id = ?", nowIso(), nowIso(), agentId);
    await ensureOwnedEventRoom(owned, true).catch(() => undefined);
    writeAudit({ userId: user.id, workspaceId: owned.id, action: "employee.fired", targetId: agentId, metadata: { did: hosted.did } });
    return NextResponse.json({ agent, fired: true });
  } catch (error) { return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to fire employee"); }
}
