import { HostedProviderExecutor, providerKindSchema } from "@technoqueue/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, requireUser } from "@/lib/auth";
import { providerConnection } from "@/lib/persistent-office";
import { enforceRateLimit } from "@/lib/rate-limit";

const inputSchema = z.object({ connectionId: z.string().min(1), model: z.string().trim().min(1).max(100) }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireUser(); enforceRateLimit(`provider-test:${user.id}`, 10, 60_000);
    const input = inputSchema.parse(await request.json());
    const connection = await providerConnection(input.connectionId, user.id);
    if (!connection) return NextResponse.json({ error: "Provider connection not found" }, { status: 404 });
    providerKindSchema.parse(connection.provider);
    const startedAt = Date.now();
    const output = await new HostedProviderExecutor(connection.provider, input.model, connection.apiKey).generate({ system: "You are a connection health check.", prompt: "Reply with exactly OK.", maxOutputTokens: 16 });
    if (!output.trim()) throw new Error(`${connection.provider} returned no text output`);
    return NextResponse.json({ ok: true, provider: connection.provider, model: input.model, latencyMs: Date.now() - startedAt });
  } catch (error) { return authErrorResponse(error, "Provider test failed"); }
}
