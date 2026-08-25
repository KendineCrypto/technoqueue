import { providerKindSchema } from "@technoqueue/core";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, requireUser } from "@/lib/auth";
import { nowIso, run, writeAudit } from "@/lib/db";
import { listProviderRows, publicProvider } from "@/lib/persistent-office";
import { encryptSecret } from "@/lib/secure-vault";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
  provider: providerKindSchema,
  label: z.string().trim().min(1).max(40),
  apiKey: z.string().trim().min(8).max(500)
}).strict();

export async function GET() {
  try { const user = await requireUser(); return NextResponse.json({ providers: listProviderRows(user.id).map(publicProvider) }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(`provider-create:${user.id}`, 8, 60_000);
    const input = inputSchema.parse(await request.json());
    if (listProviderRows(user.id).length >= Number(process.env.TECHNOQUEUE_MAX_PROVIDERS_PER_USER ?? 12)) return NextResponse.json({ error: "Provider connection limit reached" }, { status: 429 });
    const id = `provider-${randomBytes(5).toString("hex")}`;
    const timestamp = nowIso();
    run("INSERT INTO provider_connections(id, user_id, provider, label, last_four, api_key_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, user.id, input.provider, input.label, input.apiKey.slice(-4), await encryptSecret(input.apiKey), timestamp, timestamp);
    writeAudit({ userId: user.id, action: "provider.connected", targetId: id, metadata: { provider: input.provider, label: input.label } });
    return NextResponse.json({ provider: publicProvider(listProviderRows(user.id).find((value) => value.id === id)!) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error, "Unable to save provider");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    const body = await request.json().catch(() => ({})) as { id?: string };
    const row = body.id ? listProviderRows(user.id).find((value) => value.id === body.id) : undefined;
    if (!row) return NextResponse.json({ error: "Provider connection not found" }, { status: 404 });
    try { run("DELETE FROM provider_connections WHERE id = ? AND user_id = ?", row.id, user.id); }
    catch { return NextResponse.json({ error: "This connection is still assigned to an employee. Reassign or fire that employee first." }, { status: 409 }); }
    writeAudit({ userId: user.id, action: "provider.removed", targetId: row.id });
    return NextResponse.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
