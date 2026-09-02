import { randomBytes } from "node:crypto";
import { z } from "zod";
import { agentExpertiseSchema, emptyAgentExpertise } from "./capabilities";
import { didSchema, workspaceSchema } from "./validation";

export const providerKinds = ["openai", "anthropic", "deepseek", "gemini"] as const;
export const officeRoles = ["general", "planner", "researcher", "writer", "coder", "analyst", "reviewer"] as const;
export const providerKindSchema = z.enum(providerKinds);
export const officeRoleSchema = z.enum(officeRoles);
export const agentIdSchema = z.string().regex(/^agent-[a-z0-9]{8,16}$/);
export const workflowIdSchema = z.string().regex(/^workflow-[a-z0-9]{8,16}$/);

export const agentProfileSchema = z.object({
  v: z.literal(1),
  id: agentIdSchema,
  workspace: workspaceSchema,
  did: didSchema,
  name: z.string().trim().min(1).max(40),
  role: officeRoleSchema,
  provider: providerKindSchema,
  model: z.string().trim().min(1).max(100),
  instructions: z.string().trim().max(1200),
  expertise: agentExpertiseSchema.default(emptyAgentExpertise),
  paused: z.boolean(),
  fired_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();

export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type OfficeRole = z.infer<typeof officeRoleSchema>;

export const createAgentProfileInputSchema = agentProfileSchema.pick({
  name: true, role: true, provider: true, model: true, instructions: true, expertise: true
});
export type CreateAgentProfileInput = z.infer<typeof createAgentProfileInputSchema>;

export const workflowStepSchema = z.object({
  agent_id: agentIdSchema,
  label: z.string().trim().min(1).max(40),
  kind: z.enum(["work", "review"]),
  stage: z.number().int().min(0).max(4),
  merge: z.boolean(),
  requires_approval: z.boolean(),
  max_revisions: z.number().int().min(0).max(5)
}).strict();

const workflowShape = z.object({
  v: z.literal(1),
  id: workflowIdSchema,
  workspace: workspaceSchema,
  name: z.string().trim().min(1).max(60),
  steps: z.array(workflowStepSchema).min(1).max(5),
  rejection_target_step: z.number().int().min(0).max(4).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();

function normalizeWorkflow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const steps = Array.isArray(record.steps) ? record.steps.map((step, index) => step && typeof step === "object" && !Array.isArray(step) ? {
    stage: index,
    merge: false,
    requires_approval: false,
    max_revisions: 2,
    ...(step as Record<string, unknown>)
  } : step) : record.steps;
  return { rejection_target_step: null, ...record, steps };
}

function validateWorkflow(workflow: { steps: Array<z.infer<typeof workflowStepSchema>>; rejection_target_step: number | null }, context: z.RefinementCtx) {
  if (workflow.steps[0]?.kind !== "work") context.addIssue({ code: "custom", message: "A workflow must begin with a work step", path: ["steps", 0] });
  const stages = [...new Set(workflow.steps.map((step) => step.stage))];
  if (stages.some((stage, index) => stage !== index)) context.addIssue({ code: "custom", message: "Workflow stages must be contiguous and begin at zero", path: ["steps"] });
  workflow.steps.forEach((step, index) => {
    if (index > 0 && step.stage < workflow.steps[index - 1]!.stage) context.addIssue({ code: "custom", message: "Workflow stages must be ordered", path: ["steps", index, "stage"] });
    if (step.kind === "review" && index !== workflow.steps.length - 1) context.addIssue({ code: "custom", message: "A review step must be last", path: ["steps", index] });
    if (step.kind === "review" && (step.merge || step.requires_approval)) context.addIssue({ code: "custom", message: "Review steps cannot be merge desks or boss checkpoints", path: ["steps", index] });
  });
  for (const stage of stages) {
    const members = workflow.steps.filter((step) => step.stage === stage);
    if (members.length > 3) context.addIssue({ code: "custom", message: "A parallel stage supports at most three branches", path: ["steps"] });
    if (members.length > 1) {
      if (members.some((step) => step.kind !== "work" || step.merge)) context.addIssue({ code: "custom", message: "Parallel branches must be ordinary work steps", path: ["steps"] });
      const next = workflow.steps.filter((step) => step.stage === stage + 1);
      if (next.length !== 1 || !next[0]?.merge || next[0].kind !== "work") context.addIssue({ code: "custom", message: "Parallel branches must be followed by one explicit merge step", path: ["steps"] });
    }
  }
  workflow.steps.filter((step) => step.merge).forEach((step) => {
    const previous = workflow.steps.filter((candidate) => candidate.stage === step.stage - 1);
    if (previous.length < 2) context.addIssue({ code: "custom", message: "A merge step must follow a parallel stage", path: ["steps"] });
  });
  if (workflow.rejection_target_step !== null) {
    const target = workflow.steps[workflow.rejection_target_step];
    const reviewIndex = workflow.steps.findIndex((step) => step.kind === "review");
    if (!target || target.kind !== "work" || reviewIndex < 0 || workflow.rejection_target_step >= reviewIndex) context.addIssue({ code: "custom", message: "Rejection target must be an earlier work step", path: ["rejection_target_step"] });
  }
}

export const workflowSchema = z.preprocess(normalizeWorkflow, workflowShape).superRefine(validateWorkflow);

const createWorkflowShape = z.object({
  name: z.string().trim().min(1).max(60),
  steps: z.array(workflowStepSchema).min(1).max(5),
  rejection_target_step: z.number().int().min(0).max(4).nullable()
}).strict();
export const createWorkflowInputSchema = z.preprocess(normalizeWorkflow, createWorkflowShape).superRefine(validateWorkflow);
export type Workflow = z.infer<typeof workflowSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowInputSchema>;

export function newAgentProfile(workspace: string, did: string, input: CreateAgentProfileInput, now = new Date()): AgentProfile {
  const timestamp = now.toISOString();
  return agentProfileSchema.parse({
    v: 1,
    id: `agent-${randomBytes(5).toString("hex")}`,
    workspace,
    did,
    ...createAgentProfileInputSchema.parse(input),
    paused: false,
    fired_at: null,
    created_at: timestamp,
    updated_at: timestamp
  });
}

export function newWorkflow(workspace: string, input: CreateWorkflowInput, now = new Date()): Workflow {
  const timestamp = now.toISOString();
  return workflowSchema.parse({
    v: 1,
    id: `workflow-${randomBytes(5).toString("hex")}`,
    workspace,
    ...createWorkflowInputSchema.parse(input),
    created_at: timestamp,
    updated_at: timestamp
  });
}
