import { workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { runWorkspace } from "@/lib/office-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Context = { params: Promise<{ workspace: string }> };

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    const slug = workspaceSchema.parse((await context.params).workspace);
    const workspace = await ownedWorkspace(slug, user.id);
    const result = await runWorkspace(workspace);
    return NextResponse.json(result, { status: result.action === "integrity_error" || result.action === "integrity_confirmation_required" ? 409 : result.action === "error" ? 502 : 200 });
  } catch (error) { return authErrorResponse(error, "Office runtime failed"); }
}
