import { createIdentity, type AgentIdentity } from "@technoqueue/core";
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { all, nowIso, one, run, type UserRow, type WorkspaceRow, writeAudit } from "@/lib/db";
import { encryptIdentity, hashPassword, hashSessionToken, verifyPassword } from "@/lib/secure-vault";

const SESSION_COOKIE = "tq_session";
const SESSION_DAYS = 30;

export type AuthUser = Pick<UserRow, "id" | "username" | "account_did" | "created_at">;

function publicUser(user: UserRow): AuthUser {
  return { id: user.id, username: user.username, account_did: user.account_did, created_at: user.created_at };
}

export async function currentUser(): Promise<AuthUser | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const user = one<UserRow>(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`, hashSessionToken(token), nowIso());
  return user ? publicUser(user) : undefined;
}

export async function requireUser(): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("Sign in to continue", 401);
  return user;
}

export async function createUser(username: string, password: string, restoredIdentity?: AgentIdentity) {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) throw new AuthError("Username must be 3–32 characters using letters, numbers, _ or -", 400);
  if (password.length < 12 || password.length > 200) throw new AuthError("Password must be at least 12 characters", 400);
  if (one("SELECT id FROM users WHERE username = ?", normalized)) throw new AuthError("That username is already taken", 409);
  const identity = restoredIdentity ?? createIdentity();
  if (one("SELECT id FROM users WHERE account_did = ?", identity.did)) throw new AuthError("That DID already belongs to an account", 409);
  const timestamp = nowIso();
  const id = randomUUID();
  run("INSERT INTO users(id, username, password_hash, account_did, account_private_key_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id, normalized, await hashPassword(password), identity.did, await encryptIdentity(identity), timestamp, timestamp);
  writeAudit({ userId: id, action: "account.created", targetId: identity.did });
  return publicUser(one<UserRow>("SELECT * FROM users WHERE id = ?", id)!);
}

export async function authenticate(username: string, password: string) {
  const user = one<UserRow>("SELECT * FROM users WHERE username = ?", username.trim().toLowerCase());
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new AuthError("Invalid username or password", 401);
  return publicUser(user);
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  run("DELETE FROM sessions WHERE expires_at <= ?", now.toISOString());
  run("INSERT INTO sessions(token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)", hashSessionToken(token), userId, expires.toISOString(), now.toISOString(), now.toISOString());
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", hashSessionToken(token));
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function ownedWorkspace(slug: string, userId?: string) {
  const ownerId = userId ?? (await requireUser()).id;
  const workspace = one<WorkspaceRow>("SELECT * FROM workspaces WHERE slug = ?", slug);
  if (!workspace) throw new AuthError("Workspace not found", 404);
  if (workspace.owner_user_id !== ownerId) throw new AuthError("You do not own this workspace", 403);
  return workspace;
}

export function listUserWorkspaces(userId: string) {
  return all<WorkspaceRow>("SELECT * FROM workspaces WHERE owner_user_id = ? ORDER BY created_at DESC", userId).map((workspace) => ({ ...workspace }));
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new AuthError("Cross-site request blocked", 403);
}

export class AuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function authErrorResponse(error: unknown, fallback = "Request failed") {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: error instanceof AuthError ? error.status : 400 });
}
