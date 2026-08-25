import { OfficeRegistry, createAgentProfileInputSchema, createIdentity, workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { nowIso, run, writeAudit } from "@/lib/db";
import { listHostedAgentRows, providerConnection } from "@/lib/persistent-office";
import { encryptIdentity } from "@/lib/secure-vault";
import { ensureOwnedEventRoom, queueForSlug } from "@/lib/workspace-technocore";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureWorkspaceIntegrity, trustTechnocoreRecord } from "@/lib/technocore-integrity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspace: string }> };
const inputSchema = createAgentProfileInputSchema.extend({ connectionId: z.string().min(1).max(40) }).strict();

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(`employee-hire:${user.id}`, 8, 60_000);
    const workspace = workspaceSchema.parse((await context.params).workspace);
    const owned = await ownedWorkspace(workspace, user.id);
    await ensureWorkspaceIntegrity(owned);
    const input = inputSchema.parse(await request.json());
    if (listHostedAgentRows(owned.id).length >= Number(process.env.TECHNOQUEUE_MAX_AGENTS_PER_WORKSPACE ?? 24)) return NextResponse.json({ error: "Employee limit reached for this office" }, { status: 429 });
    const connection = await providerConnection(input.connectionId, user.id);
    if (!connection) return NextResponse.json({ error: "Connect this provider before hiring the employee." }, { status: 400 });
    if (connection.provider !== input.provider) return NextResponse.json({ error: "Selected connection does not match the employee provider." }, { status: 400 });
    const identity = createIdentity();
    const registry = new OfficeRegistry(workspace);
    const { connectionId, ...publicProfile } = input;
    const profile = await registry.createAgent(identity, publicProfile);
    trustTechnocoreRecord(owned, profile.id, "agent", JSON.stringify(profile));
    const timestamp = nowIso();
    run("INSERT INTO hosted_agents(agent_id, workspace_id, owner_user_id, did, private_key_enc, connection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", profile.id || randomUUID(), owned.id, user.id, identity.did, await encryptIdentity(identity), connectionId, timestamp, timestamp);
    await ensureOwnedEventRoom(owned, true).catch(() => undefined);
    writeAudit({ userId: user.id, workspaceId: owned.id, action: "employee.hired", targetId: profile.id, metadata: { did: identity.did, provider: profile.provider, role: profile.role } });
    try { await queueForSlug(workspace).signedEvent(identity, { type: "agent_online", role: profile.role, version: "1", label: profile.name }); } catch { /* profile is still usable; runtime will retry */ }
    return NextResponse.json({ agent: { ...profile, sessionOwned: true, configured: true } }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error, "Unable to hire employee");
  }
}
