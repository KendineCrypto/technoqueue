import { workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { queueForSlug } from "@/lib/workspace-technocore";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ workspace: string }> }) {
  try { const user = await requireUser(); const workspace = workspaceSchema.parse((await params).workspace); await ownedWorkspace(workspace, user.id); return NextResponse.json({ events: await queueForSlug(workspace).listEvents() }); }
  catch (error) { return authErrorResponse(error, "Unable to load events"); }
}
