import { randomBytes, randomUUID } from "node:crypto";
import { runnerLabelSchema } from "@technoqueue/core";
import { all, nowIso, one, run, type LocalRunnerRow, type RunnerPairingRow } from "@/lib/db";
import { hashSessionToken } from "@/lib/secure-vault";

const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const RUNNER_ONLINE_WINDOW_MS = 30_000;
export const RUNNER_RECENT_WINDOW_MS = 120_000;

export function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatPairingCode(value: string) {
  const normalized = normalizePairingCode(value);
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

function newPairingCode() {
  const bytes = randomBytes(10);
  let code = "";
  for (let index = 0; index < 10; index += 1) code += PAIRING_ALPHABET[bytes[index]! % PAIRING_ALPHABET.length];
  return code;
}

export function pairingCodeHash(code: string) {
  return hashSessionToken(`technoqueue-runner-pair-v1\0${normalizePairingCode(code)}`);
}

export function createRunnerPairing(input: { workspaceId: string; userId: string; label?: string }) {
  const label = runnerLabelSchema.parse(input.label?.trim() || "Local Runner");
  const createdAt = nowIso();
  const expiresAt = Date.now() + 10 * 60_000;
  run("DELETE FROM runner_pairings WHERE workspace_id = ? AND (consumed_at IS NOT NULL OR expires_at <= ?)", input.workspaceId, Date.now());
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newPairingCode();
    try {
      run(
        "INSERT INTO runner_pairings(id, workspace_id, created_by_user_id, code_hash, challenge, label, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        `pair-${randomUUID()}`, input.workspaceId, input.userId, pairingCodeHash(code), randomBytes(32).toString("base64url"), label, expiresAt, createdAt
      );
      return { code: formatPairingCode(code), expiresAt, label };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
    }
  }
  throw new Error("Unable to create a unique pairing code");
}

export function pairingByCode(code: string) {
  return one<RunnerPairingRow>(
    "SELECT * FROM runner_pairings WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    pairingCodeHash(code), Date.now()
  );
}

export function runnerState(row: LocalRunnerRow, now = Date.now()) {
  if (row.revoked_at) return "revoked" as const;
  if (!row.last_seen_at) return "paired" as const;
  const age = now - row.last_seen_at;
  if (age <= RUNNER_ONLINE_WINDOW_MS) return "online" as const;
  if (age <= RUNNER_RECENT_WINDOW_MS) return "recent" as const;
  return "offline" as const;
}

export function publicRunner(row: LocalRunnerRow) {
  let capabilities: string[] = [];
  try { capabilities = JSON.parse(row.capabilities_json) as string[]; } catch { /* invalid legacy data is shown as empty */ }
  return {
    id: row.id,
    did: row.did,
    label: row.label,
    platform: row.platform,
    version: row.version,
    capabilities,
    lastSeenAt: row.last_seen_at,
    state: runnerState(row),
    createdAt: row.created_at
  };
}

export function listWorkspaceRunners(workspaceId: string) {
  return all<LocalRunnerRow>("SELECT * FROM local_runners WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC", workspaceId);
}
