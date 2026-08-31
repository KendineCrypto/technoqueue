import { runnerCodeSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, AuthError } from "@/lib/auth";
import { one, type WorkspaceRow } from "@/lib/db";
import { pairingByCode } from "@/lib/local-runner";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(`runner-challenge:${requestAddress(request)}`, 20, 10 * 60_000);
    const code = runnerCodeSchema.parse((await request.json() as { code?: unknown }).code);
    const pairing = pairingByCode(code);
    if (!pairing) throw new AuthError("Pairing code is invalid or expired", 404);
    const workspace = one<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", pairing.workspace_id);
    if (!workspace) throw new AuthError("Office no longer exists", 404);
    return NextResponse.json({ challenge: pairing.challenge, label: pairing.label, workspace: workspace.slug, workspaceName: workspace.name, expiresAt: pairing.expires_at });
  } catch (error) {
    return authErrorResponse(error, "Unable to load pairing challenge");
  }
}
