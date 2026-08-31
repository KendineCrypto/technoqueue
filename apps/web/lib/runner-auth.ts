import { AuthError } from "@/lib/auth";
import { one, type LocalRunnerRow } from "@/lib/db";
import { hashSessionToken } from "@/lib/secure-vault";

export function requireRunner(request: Request, runnerId: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  if (!match) throw new AuthError("Runner authorization required", 401);
  const runner = one<LocalRunnerRow>(
    "SELECT * FROM local_runners WHERE id = ? AND token_hash = ? AND revoked_at IS NULL",
    runnerId,
    hashSessionToken(match[1]!)
  );
  if (!runner) throw new AuthError("Runner authorization failed", 401);
  return runner;
}
