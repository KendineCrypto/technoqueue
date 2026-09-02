import type { AgentIdentity, ProviderKind } from "@technoqueue/core";
import { all, nowIso, one, run, type HostedAgentRow, type ProviderRow, type WorkspaceRow } from "@/lib/db";
import { decryptIdentity, decryptSecret } from "@/lib/secure-vault";

export type ProviderConnection = {
  id: string;
  provider: ProviderKind;
  label: string;
  apiKey: string;
  lastFour: string;
  createdAt: string;
};

export type HostedAgent = {
  agentId: string;
  workspaceId: string;
  identity: AgentIdentity;
  connectionId: string;
  fallbackConnectionId?: string;
  fallbackModel?: string;
  lastOnlineAt?: number;
  runningTaskId?: string;
  lastError?: string;
  retryAfter?: number;
};

export function listProviderRows(userId: string) {
  return all<ProviderRow>("SELECT * FROM provider_connections WHERE user_id = ? ORDER BY created_at DESC", userId);
}

export function publicProvider(connection: ProviderRow | ProviderConnection) {
  const lastFour = "last_four" in connection ? connection.last_four : connection.lastFour;
  const createdAt = "created_at" in connection ? connection.created_at : connection.createdAt;
  return { id: connection.id, provider: connection.provider as ProviderKind, label: connection.label, maskedKey: `••••${lastFour}`, createdAt };
}

export async function providerConnection(id: string, userId: string): Promise<ProviderConnection | undefined> {
  const row = one<ProviderRow>("SELECT * FROM provider_connections WHERE id = ? AND user_id = ?", id, userId);
  if (!row) return undefined;
  return { id: row.id, provider: row.provider as ProviderKind, label: row.label, apiKey: await decryptSecret(row.api_key_enc), lastFour: row.last_four, createdAt: row.created_at };
}

export function listHostedAgentRows(workspaceId: string) {
  return all<HostedAgentRow>("SELECT * FROM hosted_agents WHERE workspace_id = ? AND archived_at IS NULL ORDER BY created_at", workspaceId);
}

export async function hostedAgent(agentId: string, workspace: WorkspaceRow): Promise<HostedAgent | undefined> {
  const row = one<HostedAgentRow>("SELECT * FROM hosted_agents WHERE agent_id = ? AND workspace_id = ? AND archived_at IS NULL", agentId, workspace.id);
  if (!row) return undefined;
  return {
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    identity: await decryptIdentity(row.private_key_enc),
    connectionId: row.connection_id,
    ...(row.fallback_connection_id === null ? {} : { fallbackConnectionId: row.fallback_connection_id }),
    ...(row.fallback_model === null ? {} : { fallbackModel: row.fallback_model }),
    ...(row.last_online_at === null ? {} : { lastOnlineAt: row.last_online_at }),
    ...(row.running_task_id === null ? {} : { runningTaskId: row.running_task_id }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    ...(row.retry_after === null ? {} : { retryAfter: row.retry_after })
  };
}

export function updateHostedAgent(agentId: string, changes: { connectionId?: string; fallbackConnectionId?: string | null; fallbackModel?: string | null; lastOnlineAt?: number | null; runningTaskId?: string | null; lastError?: string | null; retryAfter?: number | null }) {
  const fields: string[] = []; const values: Array<string | number | null> = [];
  const mapping = { connectionId: "connection_id", fallbackConnectionId: "fallback_connection_id", fallbackModel: "fallback_model", lastOnlineAt: "last_online_at", runningTaskId: "running_task_id", lastError: "last_error", retryAfter: "retry_after" } as const;
  for (const key of Object.keys(changes) as Array<keyof typeof mapping>) {
    if (changes[key] === undefined) continue;
    fields.push(`${mapping[key]} = ?`); values.push(changes[key] ?? null);
  }
  if (!fields.length) return;
  fields.push("updated_at = ?"); values.push(nowIso()); values.push(agentId);
  run(`UPDATE hosted_agents SET ${fields.join(", ")} WHERE agent_id = ?`, ...values);
}
