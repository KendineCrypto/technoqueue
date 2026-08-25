import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, AuthError, startSession } from "@/lib/auth";
import { nowIso, one, run, type UserRow, writeAudit } from "@/lib/db";
import { enforceRateLimit, requestAddress } from "@/lib/rate-limit";
import { hashPassword, readIdentityBackup } from "@/lib/secure-vault";

const inputSchema = z.object({ identityBackup: z.string().max(20_000), backupPassphrase: z.string().min(12).max(200), password: z.string().min(12).max(200), confirmPassword: z.string() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); enforceRateLimit(`recover:${requestAddress(request)}`, 5, 30 * 60_000);
    const input = inputSchema.parse(await request.json());
    if (input.password !== input.confirmPassword) throw new AuthError("Passwords do not match", 400);
    const identity = await readIdentityBackup(input.identityBackup, input.backupPassphrase);
    const user = one<UserRow>("SELECT * FROM users WHERE account_did = ?", identity.did);
    if (!user) throw new AuthError("No account exists for this DID on this server", 404);
    run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(input.password), nowIso(), user.id);
    run("DELETE FROM sessions WHERE user_id = ?", user.id);
    writeAudit({ userId: user.id, action: "account.password_recovered", targetId: identity.did });
    await startSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return authErrorResponse(error, "Account recovery failed"); }
}
