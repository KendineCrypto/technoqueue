import { z } from "zod";
import { assertSameOrigin, authenticate, authErrorResponse, startSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";

const inputSchema = z.object({ username: z.string(), password: z.string() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`login:${requestAddress(request)}`, 10, 15 * 60_000);
    const input = inputSchema.parse(await request.json());
    const user = await authenticate(input.username, input.password);
    await startSession(user.id);
    return NextResponse.json({ user });
  } catch (error) { return authErrorResponse(error, "Unable to sign in"); }
}
