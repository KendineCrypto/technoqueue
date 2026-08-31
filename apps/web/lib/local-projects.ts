import { randomUUID } from "node:crypto";
import { runnerJobRequestSchema, sha256, type RunnerJobRequest } from "@technoqueue/core";
import { all, db, nowIso, one, run, type RunnerJobRow, type RunnerProjectRow } from "@/lib/db";

export type ProjectPermission = "read" | "write" | "verify";

function permissions(row: RunnerProjectRow) {
  try { return JSON.parse(row.permissions_json) as ProjectPermission[]; } catch { return []; }
}

export function publicProject(row: RunnerProjectRow) {
  return {
    id: row.id,
    runnerId: row.runner_id,
    label: row.label,
    rootFingerprint: row.root_fingerprint,
    permissions: permissions(row),
    state: row.revoked_at ? "revoked" as const : row.approved_at ? "approved" as const : "pending" as const,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at
  };
}

export function publicJob(row: RunnerJobRow) {
  let request: RunnerJobRequest | undefined;
  try { request = runnerJobRequestSchema.parse(JSON.parse(row.request_json)); } catch { /* invalid legacy job remains inspectable */ }
  return {
    id: row.id,
    projectId: row.project_id,
    runnerId: row.runner_id,
    taskId: row.task_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    kind: row.kind,
    status: row.status,
    request,
    requestSha256: sha256(row.request_json),
    highRisk: request ? highRiskJobRequest(request) : false,
    result: row.kind === "context" ? undefined : row.result_text ?? undefined,
    resultSha256: row.result_sha256 ?? undefined,
    signed: Boolean(row.receipt_signature),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function highRiskJobRequest(request: RunnerJobRequest) {
  if (request.kind === "verify") return true;
  if (request.kind !== "apply_changes") return false;
  return request.changes.some(({ path }) => {
    const normalized = path.replaceAll("\\", "/").toLowerCase(); const name = normalized.split("/").at(-1) ?? "";
    return normalized.startsWith(".github/") || normalized.includes("/.github/") || name === "package.json" || /(^|[-.])(lock|lockfile)(\.|$)/.test(name) || name.endsWith("lock.yaml") || name.endsWith("lock.json");
  });
}

export function listProjects(workspaceId: string) {
  return all<RunnerProjectRow>("SELECT * FROM runner_projects WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY requested_at DESC", workspaceId);
}

export function listJobs(workspaceId: string, limit = 40) {
  recoverExpiredRunnerJobs(workspaceId);
  purgeExpiredRunnerSnapshots(workspaceId);
  return all<RunnerJobRow>("SELECT * FROM runner_jobs WHERE workspace_id = ? ORDER BY CASE WHEN status IN ('awaiting_approval','queued','running','failed') THEN 0 ELSE 1 END, requested_at DESC LIMIT ?", workspaceId, limit);
}

function runnerLeaseSeconds() { const value = Number(process.env.TECHNOQUEUE_RUNNER_JOB_LEASE_SECONDS ?? 180); return Number.isFinite(value) ? Math.min(1_800, Math.max(30, value)) : 180; }
function snapshotTtlHours() { const value = Number(process.env.TECHNOQUEUE_RUNNER_SNAPSHOT_TTL_HOURS ?? 24); return Number.isFinite(value) ? Math.min(168, Math.max(1, value)) : 24; }

export function recoverExpiredRunnerJobs(workspaceId?: string) {
  const timestamp = nowIso(); const scope = workspaceId ? "workspace_id = ? AND " : "";
  run(`UPDATE runner_jobs SET status = 'failed', result_text = 'Runner lease expired before a signed receipt was received. Local changes may already exist; inspect the project before retrying.', completed_at = ?, lease_expires_at = NULL, updated_at = ? WHERE ${scope}status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`, timestamp, timestamp, ...(workspaceId ? [workspaceId] : []), timestamp);
}

export function purgeExpiredRunnerSnapshots(workspaceId?: string) {
  const timestamp = nowIso(); const cutoff = new Date(Date.now() - snapshotTtlHours() * 3_600_000).toISOString(); const scope = workspaceId ? "workspace_id = ? AND " : "";
  run(`UPDATE runner_jobs SET status = 'cancelled', result_text = NULL, completed_at = ?, updated_at = ? WHERE ${scope}kind = 'context' AND status = 'succeeded' AND result_text IS NOT NULL AND completed_at IS NOT NULL AND completed_at <= ?`, timestamp, timestamp, ...(workspaceId ? [workspaceId] : []), cutoff);
}

export function createRunnerProject(input: { workspaceId: string; runnerId: string; label: string; rootFingerprint: string }) {
  const timestamp = nowIso();
  const existing = one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE runner_id = ? AND root_fingerprint = ?", input.runnerId, input.rootFingerprint);
  if (existing) {
    if (existing.revoked_at) run("UPDATE runner_projects SET label = ?, permissions_json = '[]', approved_at = NULL, revoked_at = NULL, requested_at = ?, updated_at = ? WHERE id = ?", input.label, timestamp, timestamp, existing.id);
    else run("UPDATE runner_projects SET label = ?, updated_at = ? WHERE id = ?", input.label, timestamp, existing.id);
    return one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ?", existing.id)!;
  }
  const id = `project-${randomUUID()}`;
  run("INSERT INTO runner_projects(id, workspace_id, runner_id, label, root_fingerprint, permissions_json, requested_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)", id, input.workspaceId, input.runnerId, input.label, input.rootFingerprint, timestamp, timestamp);
  return one<RunnerProjectRow>("SELECT * FROM runner_projects WHERE id = ?", id)!;
}

export function createRunnerJob(input: { workspaceId: string; project: RunnerProjectRow; taskId?: string; agentId?: string; request: RunnerJobRequest; approvalRequired: boolean }) {
  const request = runnerJobRequestSchema.parse(input.request);
  const timestamp = nowIso();
  const id = `job-${randomUUID()}`;
  const status = input.approvalRequired ? "awaiting_approval" : "queued";
  const requestJson = JSON.stringify(request); const requestSha256 = sha256(requestJson);
  run(`INSERT INTO runner_jobs(id, workspace_id, project_id, runner_id, task_id, agent_id, kind, status, request_json, approved_request_sha256, requested_at, approved_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.workspaceId, input.project.id, input.project.runner_id, input.taskId ?? null, input.agentId ?? null, request.kind, status, requestJson, input.approvalRequired ? null : requestSha256, timestamp, input.approvalRequired ? null : timestamp, timestamp);
  return one<RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ?", id)!;
}

export function claimNextRunnerJob(runnerId: string) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = nowIso();
    database.prepare("UPDATE runner_jobs SET status = 'failed', result_text = 'Runner lease expired before a signed receipt was received. Local changes may already exist; inspect the project before retrying.', completed_at = ?, lease_expires_at = NULL, updated_at = ? WHERE runner_id = ? AND status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?").run(timestamp, timestamp, runnerId, timestamp);
    const job = database.prepare("SELECT * FROM runner_jobs WHERE runner_id = ? AND status = 'queued' ORDER BY requested_at LIMIT 1").get(runnerId) as RunnerJobRow | undefined;
    if (!job) { database.exec("COMMIT"); return undefined; }
    if (!job.approved_request_sha256 || job.approved_request_sha256 !== sha256(job.request_json)) {
      database.prepare("UPDATE runner_jobs SET status = 'cancelled', result_text = 'Approved request digest no longer matches the queued job.', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(timestamp, timestamp, job.id);
      database.exec("COMMIT"); return undefined;
    }
    const leaseExpiresAt = new Date(Date.now() + runnerLeaseSeconds() * 1_000).toISOString();
    const updated = database.prepare("UPDATE runner_jobs SET status = 'running', started_at = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(timestamp, leaseExpiresAt, timestamp, job.id);
    database.exec("COMMIT");
    return Number(updated.changes) === 1 ? one<RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ?", job.id) : undefined;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function projectHasPermission(project: RunnerProjectRow, permission: ProjectPermission) {
  return !project.revoked_at && Boolean(project.approved_at) && permissions(project).includes(permission);
}
