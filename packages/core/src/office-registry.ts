import type { AgentIdentity } from "./identity";
import {
  agentProfileSchema,
  createAgentProfileInputSchema,
  createWorkflowInputSchema,
  newAgentProfile,
  newWorkflow,
  workflowSchema,
  type AgentProfile,
  type CreateAgentProfileInput,
  type CreateWorkflowInput,
  type Workflow
} from "./office";
import { TechnocoreClient } from "./technocore-client";
import { TechnocoreConflictError } from "./technocore-errors";
import { resourcesForWorkspace } from "./validation";

export type StoredRecord<T> = { value: T; raw: string };

export class OfficeRegistry {
  readonly resources;
  constructor(readonly workspace: string, readonly client = new TechnocoreClient()) {
    this.resources = resourcesForWorkspace(workspace);
  }

  private async list<T>(prefix: string, parse: (value: unknown) => T): Promise<StoredRecord<T>[]> {
    const keys = (await this.client.listNotes(this.resources.namespace)).filter((key) => key.startsWith(prefix));
    const results = await Promise.allSettled(keys.map(async (key) => {
      const note = await this.client.getNote(this.resources.namespace, key);
      if (!note.exists) return null;
      return { value: parse(JSON.parse(note.raw) as unknown), raw: note.raw };
    }));
    return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  }

  async listAgents() { return (await this.list("agent-", (value) => agentProfileSchema.parse(value))).filter(({ value }) => !value.fired_at); }
  listWorkflows() { return this.list("workflow-", (value) => workflowSchema.parse(value)); }

  async getAgent(id: string): Promise<StoredRecord<AgentProfile> | null> {
    const note = await this.client.getNote(this.resources.namespace, id);
    return note.exists ? { value: agentProfileSchema.parse(JSON.parse(note.raw) as unknown), raw: note.raw } : null;
  }

  async getWorkflow(id: string): Promise<StoredRecord<Workflow> | null> {
    const note = await this.client.getNote(this.resources.namespace, id);
    return note.exists ? { value: workflowSchema.parse(JSON.parse(note.raw) as unknown), raw: note.raw } : null;
  }

  async createAgent(identity: AgentIdentity, input: CreateAgentProfileInput): Promise<AgentProfile> {
    const profile = newAgentProfile(this.workspace, identity.did, createAgentProfileInputSchema.parse(input));
    await this.client.setNoteIfAbsent(this.resources.namespace, profile.id, JSON.stringify(profile));
    return profile;
  }

  async updateAgent(id: string, update: { [K in keyof CreateAgentProfileInput]?: CreateAgentProfileInput[K] | undefined } & { paused?: boolean | undefined }): Promise<AgentProfile> {
    const stored = await this.getAgent(id);
    if (!stored) throw new Error("Employee not found");
    if (stored.value.fired_at) throw new Error("This employee has already been fired");
    const clean = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
    const next = agentProfileSchema.parse({ ...stored.value, ...clean, id: stored.value.id, did: stored.value.did, workspace: this.workspace, updated_at: new Date().toISOString() });
    try { await this.client.compareAndSetNote(this.resources.namespace, id, JSON.stringify(next), stored.raw); }
    catch (error) { if (error instanceof TechnocoreConflictError) throw new Error("Employee changed in another session. Refresh and try again."); throw error; }
    return next;
  }

  async fireAgent(id: string): Promise<AgentProfile> {
    const stored = await this.getAgent(id);
    if (!stored) throw new Error("Employee not found");
    if (stored.value.fired_at) return stored.value;
    const timestamp = new Date().toISOString();
    const next = agentProfileSchema.parse({ ...stored.value, paused: true, fired_at: timestamp, updated_at: timestamp });
    try { await this.client.compareAndSetNote(this.resources.namespace, id, JSON.stringify(next), stored.raw); }
    catch (error) { if (error instanceof TechnocoreConflictError) throw new Error("Employee changed in another session. Refresh and try again."); throw error; }
    return next;
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
    const parsed = createWorkflowInputSchema.parse(input);
    const agents = new Map((await this.listAgents()).map(({ value }) => [value.id, value]));
    for (const [index, step] of parsed.steps.entries()) {
      const agent = agents.get(step.agent_id);
      if (!agent) throw new Error(`Employee in step ${index + 1} was not found`);
      if ((step.kind === "review") !== (agent.role === "reviewer")) throw new Error(`Step ${index + 1} kind must match the employee role`);
    }
    const workflow = newWorkflow(this.workspace, parsed);
    await this.client.setNoteIfAbsent(this.resources.namespace, workflow.id, JSON.stringify(workflow));
    return workflow;
  }
}
