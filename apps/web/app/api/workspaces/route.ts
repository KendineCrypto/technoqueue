import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, authErrorResponse, listUserWorkspaces, requireUser } from "@/lib/auth";
import { nowIso, one, run, writeAudit } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

const inputSchema = z.object({ name: z.string().trim().min(2).max(60) }).strict();

function slugBase(name: string) {
  const value = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
  return value || "office";
}

export async function GET() {
  try { const user = await requireUser(); return NextResponse.json({ workspaces: listUserWorkspaces(user.id) }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    enforceRateLimit(`workspace-create:${user.id}`, 5, 60_000);
    const input = inputSchema.parse(await request.json());
    if (listUserWorkspaces(user.id).length >= Number(process.env.TECHNOQUEUE_MAX_WORKSPACES_PER_USER ?? 10)) return NextResponse.json({ error: "Workspace limit reached" }, { status: 429 });
    let slug = `${slugBase(input.name)}-${randomBytes(3).toString("hex")}`;
    while (one("SELECT id FROM workspaces WHERE slug = ?", slug)) slug = `${slugBase(input.name)}-${randomBytes(3).toString("hex")}`;
    const id = randomUUID(); const timestamp = nowIso();
    const eventRoom = `d-tq-${slug}`;
    run("INSERT INTO workspaces(id, owner_user_id, slug, name, event_room, room_owned_at, integrity_initialized_at, integrity_confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)", id, user.id, slug, input.name, eventRoom, timestamp, timestamp, timestamp, timestamp);
    writeAudit({ userId: user.id, workspaceId: id, action: "workspace.created", targetId: slug });
    return NextResponse.json({ workspace: { id, slug, name: input.name, created_at: timestamp } }, { status: 201 });
  } catch (error) { return authErrorResponse(error, "Unable to create workspace"); }
}
