import {
  TechnocoreClient,
  agentProfileSchema,
  parseTask,
  resourcesForWorkspace,
  sha256,
  workflowSchema,
  type AgentProfile,
  type Task,
  type Workflow
} from "@technoqueue/core";
import { NextResponse } from "next/server";
import {
  all,
  nowIso,
  one,
  run,
  type HostedAgentRow,
  type TrustedTechnocoreRecordRow,
  type WorkspaceRow,
  writeAudit
} from "@/lib/db";
import { createLocalTrustTag, verifyLocalTrustTag } from "@/lib/secure-vault";

export type TrustedRecordKind = TrustedTechnocoreRecordRow["kind"];
type TrustedValue = AgentProfile | Workflow | Task;

declare global { var __technoQueueIntegrityBootstraps: Map<string, Promise<void>> | undefined; }
const bootstrapLocks = globalThis.__technoQueueIntegrityBootstraps ?? new Map<string, Promise<void>>();
globalThis.__technoQueueIntegrityBootstraps = bootstrapLocks;

function tagPayload(workspaceId: string, key: string, kind: TrustedRecordKind, raw: string) {
  return JSON.stringify([workspaceId, key, kind, raw]);
}

function parseTrusted(kind: TrustedRecordKind, raw: string): TrustedValue {
  if (kind === "agent") return agentProfileSchema.parse(JSON.parse(raw) as unknown);
  if (kind === "workflow") return workflowSchema.parse(JSON.parse(raw) as unknown);
  return parseTask(raw);
}

function trustedRows(workspaceId: string, kind?: TrustedRecordKind) {
  return kind
    ? all<TrustedTechnocoreRecordRow>("SELECT * FROM trusted_technocore_records WHERE workspace_id = ? AND kind = ? ORDER BY created_at", workspaceId, kind)
    : all<TrustedTechnocoreRecordRow>("SELECT * FROM trusted_technocore_records WHERE workspace_id = ? ORDER BY created_at", workspaceId);
}

function auditedIds(workspaceId: string, action: string) {
  return all<{ target_id: string }>("SELECT DISTINCT target_id FROM audit_log WHERE workspace_id = ? AND action = ? AND target_id IS NOT NULL", workspaceId, action).map((row) => row.target_id);
}

function validOfficeTask(task: Task, workflows: Map<string, Workflow>, agents: Map<string, AgentProfile>) {
  if (!task.office) return true;
  const workflow = workflows.get(task.office.workflow_id);
  if (!workflow || workflow.name !== task.office.workflow_name || workflow.steps.length !== task.office.steps.length) return false;
  return task.office.steps.every((step, index) => {
    const routeStep = workflow.steps[index];
    const agent = agents.get(step.agent_id);
    return Boolean(routeStep && agent
      && routeStep.agent_id === step.agent_id
      && routeStep.kind === step.kind
      && agent.did === step.agent_did
      && agent.name === step.name
      && agent.role === step.role);
  });
}

export class IntegrityViolationError extends Error {
  readonly status = 409;
  constructor(message: string, readonly recordKey?: string) { super(message); }
}

export function integrityErrorResponse(error: unknown, fallback = "Office integrity check failed") {
  const status = error instanceof IntegrityViolationError ? error.status : 503;
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback, integrityViolation: error instanceof IntegrityViolationError }, { status });
}

export function trustTechnocoreRecord(workspace: WorkspaceRow, key: string, kind: TrustedRecordKind, raw: string) {
  parseTrusted(kind, raw);
  const timestamp = nowIso();
  const tag = createLocalTrustTag(tagPayload(workspace.id, key, kind, raw));
  run(`INSERT INTO trusted_technocore_records(workspace_id, record_key, kind, raw_value, auth_tag, compromised_at, observed_sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(workspace_id, record_key) DO UPDATE SET kind = excluded.kind, raw_value = excluded.raw_value,
      auth_tag = excluded.auth_tag, compromised_at = NULL, observed_sha256 = NULL, updated_at = excluded.updated_at`,
    workspace.id, key, kind, raw, tag, timestamp, timestamp);
}

function trustedRaw(row: TrustedTechnocoreRecordRow) {
  const payload = tagPayload(row.workspace_id, row.record_key, row.kind, row.raw_value);
  if (!verifyLocalTrustTag(payload, row.auth_tag)) throw new IntegrityViolationError("The local integrity anchor is invalid. Restore the database and master key from a trusted backup.", row.record_key);
  parseTrusted(row.kind, row.raw_value);
  return row.raw_value;
}

function markCompromised(workspace: WorkspaceRow, row: TrustedTechnocoreRecordRow, observedRaw?: string) {
  const result = run(`UPDATE trusted_technocore_records SET compromised_at = COALESCE(compromised_at, ?), observed_sha256 = ?, updated_at = ?
    WHERE workspace_id = ? AND record_key = ? AND compromised_at IS NULL`, nowIso(), observedRaw === undefined ? null : sha256(observedRaw), nowIso(), workspace.id, row.record_key);
  if (Number(result.changes) > 0) writeAudit({
    userId: workspace.owner_user_id,
    workspaceId: workspace.id,
    action: "integrity.violation_detected",
    targetId: row.record_key,
    metadata: { kind: row.kind, expectedSha256: sha256(row.raw_value), observedSha256: observedRaw === undefined ? null : sha256(observedRaw) }
  });
}

async function bootstrapWorkspace(workspace: WorkspaceRow) {
  const current = one<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", workspace.id);
  if (!current || current.integrity_initialized_at) return;
  const client = new TechnocoreClient();
  const namespace = resourcesForWorkspace(current.slug).namespace;
  const agents = new Map<string, AgentProfile>();
  const hosted = all<HostedAgentRow>("SELECT * FROM hosted_agents WHERE workspace_id = ? ORDER BY created_at", current.id);

  for (const row of hosted) {
    try {
      const note = await client.getNote(namespace, row.agent_id);
      if (!note.exists) continue;
      const profile = agentProfileSchema.parse(JSON.parse(note.raw) as unknown);
      if (profile.id !== row.agent_id || profile.did !== row.did || profile.workspace !== current.slug) continue;
      agents.set(profile.id, profile);
      trustTechnocoreRecord(current, profile.id, "agent", note.raw);
    } catch { writeAudit({ userId: current.owner_user_id, workspaceId: current.id, action: "integrity.bootstrap_skipped", targetId: row.agent_id, metadata: { kind: "agent" } }); }
  }

  const workflows = new Map<string, Workflow>();
  for (const id of auditedIds(current.id, "workflow.created")) {
    try {
      const note = await client.getNote(namespace, id);
      if (!note.exists) continue;
      const workflow = workflowSchema.parse(JSON.parse(note.raw) as unknown);
      const valid = workflow.workspace === current.slug && workflow.steps.every((step) => {
        const agent = agents.get(step.agent_id);
        return agent && ((step.kind === "review") === (agent.role === "reviewer"));
      });
      if (!valid) continue;
      workflows.set(workflow.id, workflow);
      trustTechnocoreRecord(current, workflow.id, "workflow", note.raw);
    } catch { writeAudit({ userId: current.owner_user_id, workspaceId: current.id, action: "integrity.bootstrap_skipped", targetId: id, metadata: { kind: "workflow" } }); }
  }

  for (const id of auditedIds(current.id, "task.created")) {
    try {
      const note = await client.getNote(namespace, id);
      if (!note.exists) continue;
      const task = parseTask(note.raw);
      if (!validOfficeTask(task, workflows, agents)) continue;
      trustTechnocoreRecord(current, task.id, "task", note.raw);
    } catch { writeAudit({ userId: current.owner_user_id, workspaceId: current.id, action: "integrity.bootstrap_skipped", targetId: id, metadata: { kind: "task" } }); }
  }

  const initializedAt = nowIso();
  run("UPDATE workspaces SET integrity_initialized_at = ?, updated_at = ? WHERE id = ? AND integrity_initialized_at IS NULL", initializedAt, initializedAt, current.id);
  writeAudit({ userId: current.owner_user_id, workspaceId: current.id, action: "integrity.initialized", targetId: current.slug, metadata: { records: trustedRows(current.id).length } });
}

export async function ensureWorkspaceIntegrity(workspace: WorkspaceRow) {
  const current = one<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", workspace.id);
  if (current?.integrity_initialized_at) return;
  const pending = bootstrapLocks.get(workspace.id) ?? bootstrapWorkspace(workspace).finally(() => bootstrapLocks.delete(workspace.id));
  bootstrapLocks.set(workspace.id, pending);
  await pending;
}

export async function assertWorkspaceIntegrityConfirmed(workspace: WorkspaceRow) {
  await ensureWorkspaceIntegrity(workspace);
  const current = one<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", workspace.id);
  if (!current?.integrity_confirmed_at) throw new IntegrityViolationError("Review and confirm this upgraded office before creating work or starting AI employees.");
}

export async function verifiedRecord(workspace: WorkspaceRow, key: string, kind: "agent", client?: TechnocoreClient): Promise<{ raw: string; value: AgentProfile }>;
export async function verifiedRecord(workspace: WorkspaceRow, key: string, kind: "workflow", client?: TechnocoreClient): Promise<{ raw: string; value: Workflow }>;
export async function verifiedRecord(workspace: WorkspaceRow, key: string, kind: "task", client?: TechnocoreClient): Promise<{ raw: string; value: Task }>;
export async function verifiedRecord(workspace: WorkspaceRow, key: string, kind: TrustedRecordKind, client?: TechnocoreClient): Promise<{ raw: string; value: TrustedValue }>;
export async function verifiedRecord(workspace: WorkspaceRow, key: string, kind: TrustedRecordKind, client = new TechnocoreClient()) {
  await ensureWorkspaceIntegrity(workspace);
  const row = one<TrustedTechnocoreRecordRow>("SELECT * FROM trusted_technocore_records WHERE workspace_id = ? AND record_key = ? AND kind = ?", workspace.id, key, kind);
  if (!row) throw new IntegrityViolationError(`Untrusted ${kind} record was blocked.`, key);
  const expected = trustedRaw(row);
  const note = await client.getNote(resourcesForWorkspace(workspace.slug).namespace, key);
  if (!note.exists || note.raw !== expected) {
    markCompromised(workspace, row, note.exists ? note.raw : undefined);
    throw new IntegrityViolationError(`Technocore ${kind} record ${key} changed outside this office and was quarantined.`, key);
  }
  return { raw: expected, value: parseTrusted(kind, expected) };
}

export async function verifiedRecords(workspace: WorkspaceRow, kind: "agent", client?: TechnocoreClient): Promise<Array<{ raw: string; value: AgentProfile }>>;
export async function verifiedRecords(workspace: WorkspaceRow, kind: "workflow", client?: TechnocoreClient): Promise<Array<{ raw: string; value: Workflow }>>;
export async function verifiedRecords(workspace: WorkspaceRow, kind: "task", client?: TechnocoreClient): Promise<Array<{ raw: string; value: Task }>>;
export async function verifiedRecords(workspace: WorkspaceRow, kind: TrustedRecordKind, client = new TechnocoreClient()) {
  await ensureWorkspaceIntegrity(workspace);
  const rows = trustedRows(workspace.id, kind);
  return Promise.all(rows.map(async (row) => {
    const record = await verifiedRecord(workspace, row.record_key, kind, client);
    return record;
  }));
}

export async function replaceTrustedRecord(workspace: WorkspaceRow, key: string, kind: TrustedRecordKind, nextRaw: string, client = new TechnocoreClient()) {
  parseTrusted(kind, nextRaw);
  const current = await verifiedRecord(workspace, key, kind, client);
  const namespace = resourcesForWorkspace(workspace.slug).namespace;
  try { await client.compareAndSetNote(namespace, key, nextRaw, current.raw); }
  catch (error) {
    const observed = await client.getNote(namespace, key).catch(() => undefined);
    if (observed?.exists && observed.raw === nextRaw) { trustTechnocoreRecord(workspace, key, kind, nextRaw); return parseTrusted(kind, nextRaw); }
    if (observed && (!observed.exists || observed.raw !== current.raw)) {
      const row = one<TrustedTechnocoreRecordRow>("SELECT * FROM trusted_technocore_records WHERE workspace_id = ? AND record_key = ?", workspace.id, key);
      if (row) markCompromised(workspace, row, observed.exists ? observed.raw : undefined);
      throw new IntegrityViolationError(`Technocore ${kind} record ${key} changed during an authorized update and was quarantined.`, key);
    }
    throw error;
  }
  trustTechnocoreRecord(workspace, key, kind, nextRaw);
  return parseTrusted(kind, nextRaw);
}

export function workspaceIntegritySummary(workspace: WorkspaceRow) {
  const rows = trustedRows(workspace.id);
  const current = one<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", workspace.id);
  return { trustedRecords: rows.length, compromisedRecords: rows.filter((row) => row.compromised_at !== null).length, requiresConfirmation: !current?.integrity_confirmed_at };
}

export async function confirmWorkspaceIntegrity(workspace: WorkspaceRow) {
  await ensureWorkspaceIntegrity(workspace);
  const client = new TechnocoreClient();
  await Promise.all(([
    verifiedRecords(workspace, "agent", client),
    verifiedRecords(workspace, "workflow", client),
    verifiedRecords(workspace, "task", client)
  ]));
  const timestamp = nowIso();
  run("UPDATE workspaces SET integrity_confirmed_at = ?, updated_at = ? WHERE id = ?", timestamp, timestamp, workspace.id);
  writeAudit({ userId: workspace.owner_user_id, workspaceId: workspace.id, action: "integrity.confirmed", targetId: workspace.slug, metadata: { records: trustedRows(workspace.id).length } });
  return workspaceIntegritySummary(workspace);
}

export async function repairWorkspaceIntegrity(workspace: WorkspaceRow) {
  await ensureWorkspaceIntegrity(workspace);
  const client = new TechnocoreClient();
  const namespace = resourcesForWorkspace(workspace.slug).namespace;
  let repaired = 0;
  for (const row of trustedRows(workspace.id)) {
    const expected = trustedRaw(row);
    const current = await client.getNote(namespace, row.record_key);
    if (!current.exists) await client.setNoteIfAbsent(namespace, row.record_key, expected);
    else if (current.raw !== expected) await client.compareAndSetNote(namespace, row.record_key, expected, current.raw);
    const verified = await client.getNote(namespace, row.record_key);
    if (!verified.exists || verified.raw !== expected) throw new IntegrityViolationError(`Repair raced with another write for ${row.record_key}. Try again.`, row.record_key);
    trustTechnocoreRecord(workspace, row.record_key, row.kind, expected);
    if (!current.exists || current.raw !== expected) repaired += 1;
  }
  writeAudit({ userId: workspace.owner_user_id, workspaceId: workspace.id, action: "integrity.repaired", targetId: workspace.slug, metadata: { repaired } });
  return { repaired, ...workspaceIntegritySummary(workspace) };
}
