import { z } from "zod";

export const agentCapabilities = [
  "web-research",
  "fact-checking",
  "crypto-research",
  "software-planning",
  "software-development",
  "code-review",
  "security-review",
  "data-analysis",
  "long-form-writing",
  "social-content",
  "translation",
  "summarization"
] as const;

export const agentCapabilitySchema = z.enum(agentCapabilities);

export const agentExpertiseSchema = z.object({
  headline: z.string().trim().max(80).default(""),
  summary: z.string().trim().max(320).default(""),
  capabilities: z.array(agentCapabilitySchema).max(6).default([])
}).strict().superRefine((expertise, context) => {
  if (new Set(expertise.capabilities).size !== expertise.capabilities.length) {
    context.addIssue({ code: "custom", message: "Capabilities must be unique", path: ["capabilities"] });
  }
});

export const emptyAgentExpertise: z.output<typeof agentExpertiseSchema> = { headline: "", summary: "", capabilities: [] };

export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export type AgentExpertise = z.infer<typeof agentExpertiseSchema>;
