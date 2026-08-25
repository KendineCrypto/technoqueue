import { z } from "zod";
import { didSchema, taskIdSchema } from "./validation";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const eventBase = z.object({ task_id: taskIdSchema.optional(), label: z.string().max(80).optional() });
export const agentEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("agent_online"), role: z.enum(["general", "planner", "researcher", "writer", "coder", "analyst", "reviewer"]), version: z.literal("1") }),
  eventBase.extend({ type: z.literal("task_created"), task_id: taskIdSchema }),
  eventBase.extend({ type: z.literal("task_claimed"), task_id: taskIdSchema, prompt_sha256: hash, attempt: z.number().int().positive() }),
  eventBase.extend({ type: z.literal("task_reclaimed"), task_id: taskIdSchema, prompt_sha256: hash, attempt: z.number().int().positive() }),
  eventBase.extend({ type: z.literal("task_submitted"), task_id: taskIdSchema, result_sha256: hash, attempt: z.number().int().positive() }),
  eventBase.extend({ type: z.literal("review_claimed"), task_id: taskIdSchema, result_sha256: hash }),
  eventBase.extend({ type: z.literal("task_approved"), task_id: taskIdSchema, result_sha256: hash }),
  eventBase.extend({ type: z.literal("task_changes_requested"), task_id: taskIdSchema, result_sha256: hash, feedback: z.string().max(1000) }),
  eventBase.extend({ type: z.literal("task_failed"), task_id: taskIdSchema, reason: z.string().max(500) }),
  eventBase.extend({ type: z.literal("office_step_started"), task_id: taskIdSchema, step: z.number().int().min(0).max(4), agent_id: z.string().max(32) }),
  eventBase.extend({ type: z.literal("office_step_completed"), task_id: taskIdSchema, step: z.number().int().min(0).max(4), agent_id: z.string().max(32), result_sha256: hash })
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

export const roomMessageSchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  from: z.string(),
  text: z.string(),
  // Technocore permits 19-digit nonces; JSON cannot preserve all of them as JS safe integers.
  // Presence is sufficient here because the service already verified the signature/nonce lane.
  nonce: z.number().nonnegative().optional()
});

export type RoomMessage = z.infer<typeof roomMessageSchema>;
export type ParsedEvent = { message: RoomMessage; event: AgentEvent; signed: boolean };

export function encodeEvent(event: AgentEvent): string {
  return `TQ1 ${JSON.stringify(agentEventSchema.parse(event))}`;
}

export function parseEvent(message: RoomMessage): ParsedEvent | null {
  if (!message.text.startsWith("TQ1 ")) return null;
  try {
    const event = agentEventSchema.parse(JSON.parse(message.text.slice(4)) as unknown);
    return { message, event, signed: didSchema.safeParse(message.from).success && message.nonce !== undefined };
  } catch {
    return null;
  }
}
