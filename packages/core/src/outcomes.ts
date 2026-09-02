import { z } from "zod";

export const deliverableKinds = [
  "final-response",
  "plan",
  "research-report",
  "source-list",
  "content-draft",
  "code-change",
  "test-evidence",
  "review-report",
  "data-analysis"
] as const;

export const deliverableKindSchema = z.enum(deliverableKinds);
const successCriterionSchema = z.string().trim().min(3).max(160);

export const outcomeContractSchema = z.object({
  success_criteria: z.array(successCriterionSchema).max(5).default([]),
  deliverables: z.array(deliverableKindSchema).min(1).max(4).default(["final-response"])
}).strict().superRefine((contract, context) => {
  const normalizedCriteria = contract.success_criteria.map((criterion) => criterion.toLocaleLowerCase("en-US"));
  if (new Set(normalizedCriteria).size !== normalizedCriteria.length) context.addIssue({ code: "custom", message: "Success criteria must be unique", path: ["success_criteria"] });
  if (new Set(contract.deliverables).size !== contract.deliverables.length) context.addIssue({ code: "custom", message: "Deliverables must be unique", path: ["deliverables"] });
});

export const requestedOutcomeContractSchema = outcomeContractSchema.safeExtend({
  success_criteria: z.array(successCriterionSchema).min(1).max(5)
});

export const defaultOutcomeContract: z.output<typeof outcomeContractSchema> = { success_criteria: [], deliverables: ["final-response"] };

export type DeliverableKind = z.infer<typeof deliverableKindSchema>;
export type OutcomeContract = z.infer<typeof outcomeContractSchema>;

export function formatOutcomeContract(contract: OutcomeContract) {
  const criteria = contract.success_criteria.length
    ? contract.success_criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")
    : "No additional success criteria were recorded; satisfy the boss brief without inventing requirements.";
  return `REQUIRED DELIVERABLES\n${contract.deliverables.map((deliverable) => `- ${deliverable}`).join("\n")}\n\nSUCCESS CRITERIA\n${criteria}`;
}
