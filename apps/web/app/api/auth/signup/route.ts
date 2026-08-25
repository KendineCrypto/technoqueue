import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, createUser, startSession } from "@/lib/auth";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { readIdentityBackup } from "@/lib/secure-vault";

const inputSchema = z.object({ username: z.string(), password: z.string(), confirmPassword: z.string(), identityBackup: z.string().max(20_000).optional(), backupPassphrase: z.string().max(200).optional() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    enforceRateLimit(`signup:${requestAddress(request)}`, 5, 15 * 60_000);
    const input = inputSchema.parse(await request.json());
    if (input.password !== input.confirmPassword) return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    const restored = input.identityBackup ? await readIdentityBackup(input.identityBackup, input.backupPassphrase ?? "") : undefined;
    const user = await createUser(input.username, input.password, restored);
    await startSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) { return authErrorResponse(error, "Unable to create account"); }
}
