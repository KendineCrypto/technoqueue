import { agentIdSchema, workspaceSchema } from "@technoqueue/core";
import { z } from "zod";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, AuthError, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, one, run, type HostedAgentRow } from "@/lib/db";
import { workspaceUsage } from "@/lib/usage-ledger";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };
const limitSchema = z.object({ agentId: agentIdSchema, dailyRequestLimit: z.number().int().min(1).max(500).nullable(), dailyTokenLimit: z.number().int().min(1_000).max(50_000_000).nullable() }).strict();

export async function GET(_: Request, context: Context) {
  try { const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id); return NextResponse.json({ usage: workspaceUsage(workspace.id) }); }
  catch (error) { return authErrorResponse(error, "Unable to load provider usage"); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await context.params).workspace), user.id); const input = limitSchema.parse(await request.json());
    if (!one<HostedAgentRow>("SELECT * FROM hosted_agents WHERE agent_id = ? AND workspace_id = ? AND archived_at IS NULL", input.agentId, workspace.id)) throw new AuthError("Employee not found", 404);
    run(`INSERT INTO agent_usage_limits(workspace_id, agent_id, daily_request_limit, daily_token_limit, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, agent_id) DO UPDATE SET daily_request_limit = excluded.daily_request_limit, daily_token_limit = excluded.daily_token_limit, updated_at = excluded.updated_at`, workspace.id, input.agentId, input.dailyRequestLimit, input.dailyTokenLimit, nowIso());
    return NextResponse.json({ ok: true, usage: workspaceUsage(workspace.id) });
  } catch (error) { return authErrorResponse(error, "Unable to update employee budget"); }
}
