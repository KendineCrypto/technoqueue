import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, AuthError, endSession, requireUser } from "@/lib/auth";
import { one, run, type UserRow, writeAudit } from "@/lib/db";
import { verifyPassword } from "@/lib/secure-vault";

const inputSchema = z.object({ username: z.string(), password: z.string() }).strict();

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const input = inputSchema.parse(await request.json());
    if (input.username.trim().toLowerCase() !== user.username) throw new AuthError("Type your exact username to confirm", 400);
    const row = one<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!;
    if (!(await verifyPassword(input.password, row.password_hash))) throw new AuthError("Password is incorrect", 401);
    writeAudit({ userId: user.id, action: "account.deleted", targetId: user.account_did });
    run("DELETE FROM users WHERE id = ?", user.id);
    await endSession();
    return NextResponse.json({ ok: true, warning: "Public Technocore records and signed history were not erased" });
  } catch (error) { return authErrorResponse(error, "Unable to delete account"); }
}
