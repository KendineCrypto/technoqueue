import { z } from "zod";
import { didSchema } from "./validation";

export const runnerPlatformSchema = z.enum(["win32", "darwin", "linux"]);
export const runnerCodeSchema = z.string().trim().transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")).pipe(z.string().regex(/^[A-Z0-9]{10}$/));
export const runnerLabelSchema = z.string().trim().min(1).max(48);
export const runnerVersionSchema = z.string().trim().min(1).max(24);
export const runnerCapabilitySchema = z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9._-]*$/);

export const runnerPairRequestSchema = z.object({
  code: runnerCodeSchema,
  did: didSchema,
  label: runnerLabelSchema,
  platform: runnerPlatformSchema,
  version: runnerVersionSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
}).strict();

export const runnerHeartbeatSchema = z.object({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  label: runnerLabelSchema,
  platform: runnerPlatformSchema,
  version: runnerVersionSchema,
  capabilities: z.array(runnerCapabilitySchema).max(32),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
}).strict();

export type RunnerPairRequest = z.infer<typeof runnerPairRequestSchema>;
export type RunnerHeartbeat = z.infer<typeof runnerHeartbeatSchema>;

function canonical(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

export function runnerPairingPayload(input: {
  code: string;
  challenge: string;
  did: string;
  label: string;
  platform: string;
  version: string;
}) {
  return canonical({
    protocol: "technoqueue-runner-pair-v1",
    code: runnerCodeSchema.parse(input.code),
    challenge: input.challenge,
    did: didSchema.parse(input.did),
    label: runnerLabelSchema.parse(input.label),
    platform: runnerPlatformSchema.parse(input.platform),
    version: runnerVersionSchema.parse(input.version)
  });
}

export function runnerHeartbeatPayload(input: {
  runnerId: string;
  sequence: number;
  label: string;
  platform: string;
  version: string;
  capabilities: string[];
}) {
  return canonical({
    protocol: "technoqueue-runner-heartbeat-v1",
    runnerId: input.runnerId,
    sequence: input.sequence,
    label: runnerLabelSchema.parse(input.label),
    platform: runnerPlatformSchema.parse(input.platform),
    version: runnerVersionSchema.parse(input.version),
    capabilities: [...input.capabilities].sort().map((value) => runnerCapabilitySchema.parse(value))
  });
}
