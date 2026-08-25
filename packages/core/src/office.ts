import { randomBytes } from "node:crypto";
import { z } from "zod";
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
  instructions: z.string().trim().max(800),
  paused: z.boolean(),
  fired_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();

export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type OfficeRole = z.infer<typeof officeRoleSchema>;

export const createAgentProfileInputSchema = agentProfileSchema.pick({
  name: true, role: true, provider: true, model: true, instructions: true
});
export type CreateAgentProfileInput = z.infer<typeof createAgentProfileInputSchema>;

export const workflowStepSchema = z.object({
  agent_id: agentIdSchema,
  label: z.string().trim().min(1).max(40),
  kind: z.enum(["work", "review"])
}).strict();

export const workflowSchema = z.object({
  v: z.literal(1),
  id: workflowIdSchema,
  workspace: workspaceSchema,
  name: z.string().trim().min(1).max(60),
  steps: z.array(workflowStepSchema).min(1).max(5),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict().superRefine((workflow, context) => {
  if (workflow.steps[0]?.kind !== "work") context.addIssue({ code: "custom", message: "A workflow must begin with a work step", path: ["steps", 0] });
  workflow.steps.forEach((step, index) => {
    if (step.kind === "review" && index !== workflow.steps.length - 1) context.addIssue({ code: "custom", message: "A review step must be last", path: ["steps", index] });
  });
});

export const createWorkflowInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  steps: z.array(workflowStepSchema).min(1).max(5)
}).strict().superRefine((workflow, context) => {
  if (workflow.steps[0]?.kind !== "work") context.addIssue({ code: "custom", message: "A workflow must begin with a work step", path: ["steps", 0] });
  workflow.steps.forEach((step, index) => {
    if (step.kind === "review" && index !== workflow.steps.length - 1) context.addIssue({ code: "custom", message: "A review step must be last", path: ["steps", index] });
  });
});
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
