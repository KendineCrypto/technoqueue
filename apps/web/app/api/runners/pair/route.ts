import { randomBytes, randomUUID } from "node:crypto";
import { runnerPairingPayload, runnerPairRequestSchema, verifyDidSignature } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, AuthError } from "@/lib/auth";
import { db, nowIso, one, type RunnerPairingRow, type WorkspaceRow, writeAudit } from "@/lib/db";
import { pairingCodeHash } from "@/lib/local-runner";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { hashSessionToken } from "@/lib/secure-vault";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    enforceRateLimit(`runner-pair:${requestAddress(request)}`, 12, 10 * 60_000);
    const input = runnerPairRequestSchema.parse(await request.json());
    const pairing = one<RunnerPairingRow>(
      "SELECT * FROM runner_pairings WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
      pairingCodeHash(input.code), Date.now()
    );
    if (!pairing) throw new AuthError("Pairing code is invalid or expired", 404);
    const payload = runnerPairingPayload({ ...input, challenge: pairing.challenge });
    if (!verifyDidSignature(input.did, payload, input.signature)) throw new AuthError("Runner DID signature is invalid", 401);

    const database = db();
    const runnerId = `runner-${randomUUID()}`;
    const token = randomBytes(32).toString("base64url");
    const timestamp = nowIso();
    try {
      database.exec("BEGIN IMMEDIATE");
      const current = database.prepare("SELECT * FROM runner_pairings WHERE id = ? AND consumed_at IS NULL AND expires_at > ?").get(pairing.id, Date.now()) as RunnerPairingRow | undefined;
      if (!current) throw new AuthError("Pairing code has already been used", 409);
      const active = database.prepare("SELECT COUNT(*) AS count FROM local_runners WHERE workspace_id = ? AND revoked_at IS NULL").get(pairing.workspace_id) as { count: number };
      if (active.count >= 5) throw new AuthError("This office already has the maximum of 5 active runners", 409);
      database.prepare(`INSERT INTO local_runners(id, workspace_id, did, label, platform, version, token_hash, capabilities_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`).run(runnerId, pairing.workspace_id, input.did, input.label, input.platform, input.version, hashSessionToken(token), timestamp, timestamp);
      database.prepare("UPDATE runner_pairings SET consumed_at = ? WHERE id = ?").run(timestamp, pairing.id);
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* transaction did not start */ }
      if (error instanceof AuthError) throw error;
      if (error instanceof Error && error.message.includes("UNIQUE")) throw new AuthError("This runner identity is already paired", 409);
      throw error;
    }
    const workspace = one<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", pairing.workspace_id)!;
    writeAudit({ userId: pairing.created_by_user_id, workspaceId: pairing.workspace_id, action: "runner.paired", targetId: runnerId, metadata: { did: input.did, label: input.label, platform: input.platform } });
    return NextResponse.json({ runnerId, token, workspace: workspace.slug, workspaceName: workspace.name, sequence: 0 });
  } catch (error) {
    return authErrorResponse(error, "Unable to pair runner");
  }
}
