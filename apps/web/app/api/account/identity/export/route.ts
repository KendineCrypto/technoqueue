import { z } from "zod";
import { assertSameOrigin, authErrorResponse, requireUser } from "@/lib/auth";
import { one, type UserRow, writeAudit } from "@/lib/db";
import { createIdentityBackup, decryptIdentity } from "@/lib/secure-vault";

const inputSchema = z.object({ passphrase: z.string().min(12).max(200) }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const user = await requireUser();
    const { passphrase } = inputSchema.parse(await request.json());
    const row = one<UserRow>("SELECT * FROM users WHERE id = ?", user.id)!;
    const backup = await createIdentityBackup(await decryptIdentity(row.account_private_key_enc), passphrase, `TechnoQueue account: ${user.username}`);
    writeAudit({ userId: user.id, action: "identity.account_exported", targetId: user.account_did });
    return new Response(backup, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="technoqueue-${user.username}-account.tqid"`, "cache-control": "no-store" } });
  } catch (error) { return authErrorResponse(error, "Unable to export identity"); }
}
