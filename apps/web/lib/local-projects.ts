import { randomUUID } from "node:crypto";
import { runnerJobRequestSchema, type RunnerJobRequest } from "@technoqueue/core";
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
    result: row.result_text ?? undefined,
    resultSha256: row.result_sha256 ?? undefined,
    signed: Boolean(row.receipt_signature),
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function listProjects(workspaceId: string) {
  return all<RunnerProjectRow>("SELECT * FROM runner_projects WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY requested_at DESC", workspaceId);
}

export function listJobs(workspaceId: string, limit = 40) {
  return all<RunnerJobRow>("SELECT * FROM runner_jobs WHERE workspace_id = ? ORDER BY requested_at DESC LIMIT ?", workspaceId, limit);
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
  run(`INSERT INTO runner_jobs(id, workspace_id, project_id, runner_id, task_id, agent_id, kind, status, request_json, requested_at, approved_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.workspaceId, input.project.id, input.project.runner_id, input.taskId ?? null, input.agentId ?? null, request.kind, status, JSON.stringify(request), timestamp, input.approvalRequired ? null : timestamp, timestamp);
  return one<RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ?", id)!;
}

export function claimNextRunnerJob(runnerId: string) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const job = database.prepare("SELECT * FROM runner_jobs WHERE runner_id = ? AND status = 'queued' ORDER BY requested_at LIMIT 1").get(runnerId) as RunnerJobRow | undefined;
    if (!job) { database.exec("COMMIT"); return undefined; }
    const timestamp = nowIso();
    const updated = database.prepare("UPDATE runner_jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(timestamp, timestamp, job.id);
    database.exec("COMMIT");
    return Number(updated.changes) === 1 ? one<RunnerJobRow>("SELECT * FROM runner_jobs WHERE id = ?", job.id) : undefined;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function projectHasPermission(project: RunnerProjectRow, permission: ProjectPermission) {
  return !project.revoked_at && Boolean(project.approved_at) && permissions(project).includes(permission);
}
