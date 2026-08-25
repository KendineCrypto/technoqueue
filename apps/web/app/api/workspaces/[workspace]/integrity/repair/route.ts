import { workspaceSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { assertSameOrigin, authErrorResponse, ownedWorkspace, requireUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { IntegrityViolationError, integrityErrorResponse, repairWorkspaceIntegrity } from "@/lib/technocore-integrity";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ workspace: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(`integrity-repair:${user.id}`, 5, 60_000);
    const slug = workspaceSchema.parse((await params).workspace);
    const workspace = await ownedWorkspace(slug, user.id);
    return NextResponse.json(await repairWorkspaceIntegrity(workspace));
  } catch (error) {
    return error instanceof IntegrityViolationError ? integrityErrorResponse(error) : authErrorResponse(error, "Unable to repair office integrity");
  }
}
