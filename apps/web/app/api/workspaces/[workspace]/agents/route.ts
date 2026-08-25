import { workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { queueForSlug } from "@/lib/workspace-technocore";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ workspace: string }> }) {
  try {
    const user = await requireUser();
    const workspace = workspaceSchema.parse((await params).workspace);
    await ownedWorkspace(workspace, user.id);
    const events = await queueForSlug(workspace).listEvents();
    const byDid = new Map<string, { did: string; label: string; role: string; lastSeen: string; state: string }>();
    for (const item of events) {
      if (!item.signed) continue;
      const previous = byDid.get(item.message.from);
      const online = item.event.type === "agent_online" ? item.event : null;
      const ts = new Date(item.message.ts).toISOString();
      const age = Date.now() - new Date(ts).getTime();
      byDid.set(item.message.from, { did: item.message.from, label: online?.label ?? previous?.label ?? "Agent", role: online?.role ?? previous?.role ?? "unknown", lastSeen: ts, state: age < 120_000 ? "active" : age < 900_000 ? "recent" : "offline" });
    }
    return NextResponse.json({ agents: [...byDid.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)) });
  } catch (error) { return authErrorResponse(error, "Unable to load agents"); }
}
