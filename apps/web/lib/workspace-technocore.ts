import { TechnoQueue, TechnocoreClient } from "@technoqueue/core";
import { all, nowIso, one, run, type HostedAgentRow, type UserRow, type WorkspaceRow } from "@/lib/db";
import { decryptIdentity } from "@/lib/secure-vault";

export function workspaceRecord(slug: string) {
  return one<WorkspaceRow>("SELECT * FROM workspaces WHERE slug = ?", slug);
}

export function queueForSlug(slug: string) {
  const workspace = workspaceRecord(slug);
  return new TechnoQueue(slug, new TechnocoreClient(), workspace?.event_room);
}

export async function ensureOwnedEventRoom(workspace: WorkspaceRow, forceAllowSync = false) {
  const user = one<UserRow>("SELECT * FROM users WHERE id = ?", workspace.owner_user_id);
  if (!user) throw new Error("Workspace owner account is missing");
  const owner = await decryptIdentity(user.account_private_key_enc);
  const client = new TechnocoreClient();
  const ownerNote = await client.getNote("room-owners", workspace.event_room);
  if (!ownerNote.exists) {
    await client.setSignedOwnershipNote("room-owners", workspace.event_room, owner.did, owner, { absent: true });
    run("UPDATE workspaces SET room_owned_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), workspace.id);
  } else if (ownerNote.raw !== owner.did) {
    throw new Error("Technocore event room is owned by a different DID");
  } else if (!workspace.room_owned_at) {
    run("UPDATE workspaces SET room_owned_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), workspace.id);
  }

  if (forceAllowSync || !workspace.room_owned_at) {
    const employees = all<HostedAgentRow>("SELECT * FROM hosted_agents WHERE workspace_id = ? AND archived_at IS NULL ORDER BY did", workspace.id);
    const value = [owner.did, ...employees.map((employee) => employee.did)].join(" ");
    const current = await client.getNote("room-allow", workspace.event_room);
    if (!current.exists) await client.setSignedOwnershipNote("room-allow", workspace.event_room, value, owner, { absent: true });
    else if (current.raw !== value) await client.setSignedOwnershipNote("room-allow", workspace.event_room, value, owner, { expected: current.raw });
  }
}
