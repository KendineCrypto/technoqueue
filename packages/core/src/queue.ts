import { encodeEvent, parseEvent, type AgentEvent, type ParsedEvent } from "./events";
import { sha256 } from "./hash";
import type { AgentIdentity } from "./identity";
import { createTask, createOfficeTask, createOfficeTaskInputSchema, parseTask, prepareTaskForStorage, serializeTask, type CreateOfficeTaskInput, type CreateTaskInput, type Task } from "./task";
import type { AgentProfile, Workflow } from "./office";
import { OfficeRegistry } from "./office-registry";
import { TechnocoreClient } from "./technocore-client";
import { TechnocoreConflictError, TechnocoreTimeoutError } from "./technocore-errors";
import { resourcesForWorkspace } from "./validation";
import { claimForReview, claimForWork, submitResult, approveTask, requestChanges, claimOfficeStep, completeOfficeWork, finishOfficeReview } from "./transitions";

export type StoredTask = { task: Task; raw: string };
type PersistedTaskHook = (task: Task) => void | Promise<void>;

export class TechnoQueue {
  readonly resources;
  constructor(readonly workspace: string, readonly client = new TechnocoreClient(), eventRoom?: string) {
    const resources = resourcesForWorkspace(workspace);
    this.resources = { ...resources, room: eventRoom ?? resources.room };
  }

  async listTasks(): Promise<StoredTask[]> {
    const keys = (await this.client.listNotes(this.resources.namespace)).filter((key) => key.startsWith("task-"));
    const results = await Promise.allSettled(keys.map((key) => this.getTask(key)));
    return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  }

  async getTask(id: string): Promise<StoredTask | null> {
    const note = await this.client.getNote(this.resources.namespace, id);
    return note.exists ? { raw: note.raw, task: parseTask(note.raw) } : null;
  }

  async listEvents(): Promise<ParsedEvent[]> {
    const room = await this.client.readRoom(this.resources.room, undefined, 200);
    return room.messages.flatMap((message) => { const parsed = parseEvent(message); return parsed ? [parsed] : []; });
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const task = createTask(input);
    const expected = serializeTask(task);
    try { await this.client.setNoteIfAbsent(this.resources.namespace, task.id, expected); }
    catch (error) {
      if (error instanceof TechnocoreTimeoutError) {
        const found = await this.getTask(task.id);
        if (!found || found.raw !== expected) throw error;
      } else throw error;
    }
    try { await this.client.sayUnsigned(this.resources.room, "dashboard", encodeEvent({ type: "task_created", task_id: task.id })); } catch { /* state creation succeeded; activity is best effort */ }
    return task;
  }

  async createOffice(input: CreateOfficeTaskInput): Promise<Task> {
    const parsed = createOfficeTaskInputSchema.parse(input);
    const registry = new OfficeRegistry(this.workspace, this.client);
    const workflow = await registry.getWorkflow(parsed.workflow_id);
    if (!workflow) throw new Error("Workflow not found");
    return this.createOfficeFromTrustedRecords(parsed, workflow.value, (await registry.listAgents()).map(({ value }) => value));
  }

  async createOfficeFromTrustedRecords(input: CreateOfficeTaskInput, workflow: Workflow, agents: AgentProfile[]): Promise<Task> {
    const task = createOfficeTask(input, workflow, agents);
    const officeTask = serializeTask(task);
    await this.client.setNoteIfAbsent(this.resources.namespace, task.id, officeTask);
    try { await this.client.sayUnsigned(this.resources.room, "boss", encodeEvent({ type: "task_created", task_id: task.id })); } catch { /* task state is authoritative */ }
    return parseTask(officeTask);
  }

  async signedEvent(identity: AgentIdentity, event: AgentEvent): Promise<void> { await this.client.saySigned(this.resources.room, encodeEvent(event), identity); }

  private async cas(stored: StoredTask, next: Task): Promise<Task | null> {
    const persisted = prepareTaskForStorage(next);
    const intended = serializeTask(persisted);
    try { await this.client.compareAndSetNote(this.resources.namespace, stored.task.id, intended, stored.raw); return persisted; }
    catch (error) {
      if (error instanceof TechnocoreConflictError) return null;
      if (error instanceof TechnocoreTimeoutError) {
        const current = await this.getTask(stored.task.id);
        return current?.raw === intended ? current.task : null;
      }
      throw error;
    }
  }

  async claimWork(stored: StoredTask, identity: AgentIdentity, leaseSeconds: number): Promise<{ task: Task; reclaimed: boolean } | null> {
    const reclaimed = stored.task.status === "running";
    const next = claimForWork(stored.task, identity.did, leaseSeconds);
    const won = await this.cas(stored, next);
    if (!won) return null;
    await this.signedEvent(identity, { type: reclaimed ? "task_reclaimed" : "task_claimed", task_id: won.id, prompt_sha256: sha256(won.prompt), attempt: won.attempt });
    return { task: won, reclaimed };
  }

  async claimOffice(stored: StoredTask, identity: AgentIdentity, leaseSeconds: number, onPersisted?: PersistedTaskHook): Promise<Task | null> {
    if (!stored.task.office) throw new Error("Task has no office workflow");
    const stepIndex = stored.task.office.current_step;
    const next = claimOfficeStep(stored.task, identity.did, leaseSeconds);
    const won = await this.cas(stored, next);
    if (!won) return null;
    await onPersisted?.(won);
    await this.signedEvent(identity, { type: "office_step_started", task_id: won.id, step: stepIndex, agent_id: won.office!.steps[stepIndex]!.agent_id }).catch(() => undefined);
    return won;
  }

  async completeOffice(stored: StoredTask, identity: AgentIdentity, result: string, onPersisted?: PersistedTaskHook): Promise<Task | null> {
    const stepIndex = stored.task.office?.current_step;
    if (stepIndex === undefined) throw new Error("Task has no office workflow");
    const next = completeOfficeWork(stored.task, identity.did, result);
    const won = await this.cas(stored, next);
    const hash = won?.office?.steps[stepIndex]?.output_sha256;
    if (won) await onPersisted?.(won);
    if (won && hash) await this.signedEvent(identity, { type: "office_step_completed", task_id: won.id, step: stepIndex, agent_id: won.office!.steps[stepIndex]!.agent_id, result_sha256: hash }).catch(() => undefined);
    return won;
  }

  async finishOfficeReview(stored: StoredTask, identity: AgentIdentity, decision: { approved: true } | { approved: false; feedback: string }, onPersisted?: PersistedTaskHook): Promise<Task | null> {
    const next = finishOfficeReview(stored.task, identity.did, decision);
    const won = await this.cas(stored, next);
    if (won) await onPersisted?.(won);
    if (!won || !won.result_sha256) return won;
    await this.signedEvent(identity, decision.approved ? { type: "task_approved", task_id: won.id, result_sha256: won.result_sha256 } : { type: "task_changes_requested", task_id: won.id, result_sha256: won.result_sha256, feedback: decision.feedback.slice(0, 1000) }).catch(() => undefined);
    return won;
  }

  async completeWork(stored: StoredTask, identity: AgentIdentity, result: string): Promise<Task | null> {
    const next = submitResult(stored.task, identity.did, result);
    const won = await this.cas(stored, next);
    if (won?.result_sha256) await this.signedEvent(identity, { type: "task_submitted", task_id: won.id, result_sha256: won.result_sha256, attempt: won.attempt });
    return won;
  }

  async claimReview(stored: StoredTask, identity: AgentIdentity, leaseSeconds: number): Promise<Task | null> {
    const next = claimForReview(stored.task, identity.did, leaseSeconds);
    const won = await this.cas(stored, next);
    if (won?.result_sha256) await this.signedEvent(identity, { type: "review_claimed", task_id: won.id, result_sha256: won.result_sha256 });
    return won;
  }

  async finishReview(stored: StoredTask, identity: AgentIdentity, decision: { approved: true } | { approved: false; feedback: string }): Promise<Task | null> {
    const next = decision.approved ? approveTask(stored.task, identity.did) : requestChanges(stored.task, identity.did, decision.feedback);
    const won = await this.cas(stored, next);
    if (!won || !won.result_sha256) return won;
    await this.signedEvent(identity, decision.approved ? { type: "task_approved", task_id: won.id, result_sha256: won.result_sha256 } : { type: "task_changes_requested", task_id: won.id, result_sha256: won.result_sha256, feedback: decision.feedback.slice(0, 1000) });
    return won;
  }
}
