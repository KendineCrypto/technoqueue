import { workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ workspace: string }> }) {
  try {
    const user = await requireUser(); const workspace = await ownedWorkspace(workspaceSchema.parse((await params).workspace), user.id);
    const entries = all<{ id: number; action: string; target_id: string | null; metadata_json: string; created_at: string }>("SELECT id, action, target_id, metadata_json, created_at FROM audit_log WHERE workspace_id = ? ORDER BY id DESC LIMIT 100", workspace.id).map((entry) => ({ ...entry, metadata: JSON.parse(entry.metadata_json) as unknown, metadata_json: undefined }));
    return NextResponse.json({ entries });
  } catch (error) { return authErrorResponse(error, "Unable to load audit log"); }
}
