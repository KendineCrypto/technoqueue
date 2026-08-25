import { workspaceSchema } from "@technoqueue/core";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { one, type HostedAgentRow, writeAudit } from "@/lib/db";
import { createIdentityBackup, decryptIdentity } from "@/lib/secure-vault";

const inputSchema = z.object({ passphrase: z.string().min(12).max(200) }).strict();
type Context = { params: Promise<{ workspace: string; agentId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    const { workspace: rawWorkspace, agentId } = await context.params;
    const workspace = await ownedWorkspace(workspaceSchema.parse(rawWorkspace), user.id);
    const row = one<HostedAgentRow>("SELECT * FROM hosted_agents WHERE agent_id = ? AND workspace_id = ?", agentId, workspace.id);
    if (!row) return new Response(JSON.stringify({ error: "Employee identity not found" }), { status: 404, headers: { "content-type": "application/json" } });
    const { passphrase } = inputSchema.parse(await request.json());
    const backup = await createIdentityBackup(await decryptIdentity(row.private_key_enc), passphrase, `TechnoQueue employee: ${agentId}`);
    writeAudit({ userId: user.id, workspaceId: workspace.id, action: "identity.employee_exported", targetId: row.did });
    return new Response(backup, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="technoqueue-${agentId}.tqid"`, "cache-control": "no-store" } });
  } catch (error) { return authErrorResponse(error, "Unable to export employee identity"); }
}
