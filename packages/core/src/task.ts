import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sha256 } from "./hash";
import { agentIdSchema, officeRoleSchema, workflowIdSchema, type AgentProfile, type Workflow } from "./office";
import { runnerProjectIdSchema } from "./runner";
import { didSchema, taskIdSchema } from "./validation";

export const roles = ["general", "planner", "researcher", "writer", "coder", "analyst"] as const;
export const statuses = ["open", "running", "review", "done", "failed"] as const;

const nullableDid = didSchema.nullable();
const nullableDate = z.string().datetime().nullable();
export const officeTaskStepSchema = z.object({
  agent_id: agentIdSchema,
  agent_did: didSchema,
  name: z.string().min(1).max(40),
  role: officeRoleSchema,
  label: z.string().min(1).max(40),
  kind: z.enum(["work", "review"]),
  status: z.enum(["pending", "running", "done", "changes_requested"]),
  output_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  feedback: z.string().max(500).nullable()
}).strict();

export const officeTaskSchema = z.object({
  workflow_id: workflowIdSchema,
  workflow_name: z.string().min(1).max(60),
  current_step: z.number().int().min(0).max(4),
  steps: z.array(officeTaskStepSchema).min(1).max(5)
}).strict();

export const taskSchema = z.object({
  v: z.literal(1),
  id: taskIdSchema,
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(2500),
  role: z.enum(roles),
  status: z.enum(statuses),
  requires_review: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().min(1).max(10),
  worker_did: nullableDid,
  worker_claimed_at: nullableDate,
  worker_lease_until: nullableDate,
  result: z.string().max(3500).nullable(),
  result_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  reviewer_did: nullableDid,
  reviewer_claimed_at: nullableDate,
  reviewer_lease_until: nullableDate,
  review_decision: z.enum(["approved", "changes_requested"]).nullable(),
  review_feedback: z.string().max(1000).nullable(),
  previous_result: z.string().max(3500).nullable().optional(),
  project_id: runnerProjectIdSchema.nullable().optional(),
  office: officeTaskSchema.optional()
}).strict();

export type Task = z.infer<typeof taskSchema>;
export type TaskRole = Task["role"];

export const createOfficeTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2500),
  workflow_id: workflowIdSchema,
  project_id: runnerProjectIdSchema.nullable().optional()
});

export type CreateOfficeTaskInput = z.infer<typeof createOfficeTaskInputSchema>;

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(2500),
  role: z.enum(roles),
  requires_review: z.boolean(),
  max_attempts: z.number().int().min(1).max(10).default(3)
}).extend({ project_id: runnerProjectIdSchema.nullable().optional() });

export type CreateTaskInput = z.input<typeof createTaskInputSchema>;

export function createTask(input: CreateTaskInput, now = new Date()): Task {
  const parsed = createTaskInputSchema.parse(input);
  const timestamp = now.toISOString();
  return taskSchema.parse({
    v: 1,
    id: `task-${randomBytes(6).toString("hex")}`,
    ...parsed,
    status: "open",
    created_at: timestamp,
    updated_at: timestamp,
    attempt: 0,
    worker_did: null,
    worker_claimed_at: null,
    worker_lease_until: null,
    result: null,
    result_sha256: null,
    reviewer_did: null,
    reviewer_claimed_at: null,
    reviewer_lease_until: null,
    review_decision: null,
    review_feedback: null
  });
}

export function createOfficeTask(input: CreateOfficeTaskInput, workflow: Workflow, agents: AgentProfile[], now = new Date()): Task {
  const parsed = createOfficeTaskInputSchema.parse(input);
  if (workflow.id !== parsed.workflow_id) throw new Error("Workflow does not match the task request");
  const profiles = new Map(agents.map((agent) => [agent.id, agent]));
  const steps = workflow.steps.map((step) => {
    const agent = profiles.get(step.agent_id);
    if (!agent || agent.fired_at) throw new Error(`Employee ${step.agent_id} is no longer available`);
    if ((step.kind === "review") !== (agent.role === "reviewer")) throw new Error(`Employee ${step.agent_id} no longer matches this workflow step`);
    return { agent_id: agent.id, agent_did: agent.did, name: agent.name, role: agent.role, label: step.label, kind: step.kind, status: "pending" as const, output_sha256: null, feedback: null };
  });
  const first = steps[0];
  if (!first || first.kind !== "work" || first.role === "reviewer") throw new Error("Workflow must begin with a working employee");
  const task = createTask({ title: parsed.title, prompt: parsed.prompt, role: first.role, requires_review: steps.at(-1)?.kind === "review", max_attempts: 10, project_id: parsed.project_id ?? null }, now);
  return taskSchema.parse({ ...task, office: { workflow_id: workflow.id, workflow_name: workflow.name, current_step: 0, steps } });
}

export function parseTask(raw: string): Task {
  return taskSchema.parse(JSON.parse(raw) as unknown);
}

const TASK_STORAGE_TARGET = 8000;
const TRUNCATION_MARKER = "\n[result truncated for Technocore]";

export function prepareTaskForStorage(task: Task): Task {
  const parsed = taskSchema.parse(task);
  const withoutPreviousResult = { ...parsed };
  delete withoutPreviousResult.previous_result;
  let compact = taskSchema.parse(withoutPreviousResult);
  if (JSON.stringify(compact).length <= TASK_STORAGE_TARGET) return compact;
  if (compact.result === null) throw new Error("Task metadata exceeds Technocore's note limit. Shorten the boss brief or workflow labels.");

  const originalResult = compact.result;
  const originalHash = compact.result_sha256;
  const candidate = (maxLength: number) => {
    const result = maxLength >= originalResult.length
      ? originalResult
      : maxLength <= TRUNCATION_MARKER.length
        ? TRUNCATION_MARKER.slice(0, maxLength)
        : `${originalResult.slice(0, maxLength - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
    const resultHash = sha256(result);
    const office = compact.office ? {
      ...compact.office,
      steps: compact.office.steps.map((step) => ({
        ...step,
        output_sha256: originalHash !== null && step.output_sha256 === originalHash ? resultHash : step.output_sha256
      }))
    } : undefined;
    return taskSchema.parse({ ...compact, result, result_sha256: resultHash, ...(office ? { office } : {}) });
  };

  let low = 0;
  let high = originalResult.length;
  let fitted: Task | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const next = candidate(middle);
    if (JSON.stringify(next).length <= TASK_STORAGE_TARGET) { fitted = next; low = middle + 1; }
    else high = middle - 1;
  }
  if (!fitted) throw new Error("Task metadata exceeds Technocore's note limit. Shorten the boss brief or workflow labels.");
  return fitted;
}

export function serializeTask(task: Task): string {
  return JSON.stringify(prepareTaskForStorage(task));
}
