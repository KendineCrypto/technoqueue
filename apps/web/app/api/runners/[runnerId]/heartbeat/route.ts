import { runnerHeartbeatPayload, runnerHeartbeatSchema, verifyDidSignature } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { authErrorResponse, AuthError } from "@/lib/auth";
import { nowIso, one, run, type LocalRunnerRow } from "@/lib/db";
import { publicRunner } from "@/lib/local-runner";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ runnerId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const runnerId = (await context.params).runnerId;
    return NextResponse.json({ runner: publicRunner(requireRunner(request, runnerId)) });
  } catch (error) {
    return authErrorResponse(error, "Unable to load runner");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const runnerId = (await context.params).runnerId;
    const runner = requireRunner(request, runnerId);
    enforceRateLimit(`runner-heartbeat:${runnerId}`, 12, 60_000);
    const input = runnerHeartbeatSchema.parse(await request.json());
    const capabilities = [...input.capabilities].sort();
    const payload = runnerHeartbeatPayload({ runnerId, ...input, capabilities });
    if (!verifyDidSignature(runner.did, payload, input.signature)) throw new AuthError("Runner DID signature is invalid", 401);
    const result = run(`UPDATE local_runners SET label = ?, platform = ?, version = ?, capabilities_json = ?, last_seen_at = ?, last_sequence = ?, updated_at = ?
      WHERE id = ? AND revoked_at IS NULL AND last_sequence < ?`, input.label, input.platform, input.version, JSON.stringify(capabilities), Date.now(), input.sequence, nowIso(), runnerId, input.sequence);
    if (Number(result.changes) !== 1) throw new AuthError("Heartbeat sequence was already used", 409);
    const updated = one<LocalRunnerRow>("SELECT * FROM local_runners WHERE id = ?", runnerId)!;
    return NextResponse.json({ ok: true, runner: publicRunner(updated), sequence: updated.last_sequence });
  } catch (error) {
    return authErrorResponse(error, "Unable to record runner heartbeat");
  }
}
