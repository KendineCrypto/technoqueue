import { z } from "zod";
import { didSchema } from "./validation";

export const runnerPlatformSchema = z.enum(["win32", "darwin", "linux"]);
export const runnerCodeSchema = z.string().trim().transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")).pipe(z.string().regex(/^[A-Z0-9]{10}$/));
export const runnerLabelSchema = z.string().trim().min(1).max(48);
export const runnerVersionSchema = z.string().trim().min(1).max(24);
export const runnerCapabilitySchema = z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9._-]*$/);
export const runnerProjectIdSchema = z.string().regex(/^project-[0-9a-f-]{36}$/);
export const runnerJobIdSchema = z.string().regex(/^job-[0-9a-f-]{36}$/);
export const runnerProjectLabelSchema = z.string().trim().min(1).max(60);
export const runnerRootFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const runnerProjectPermissionSchema = z.enum(["read", "write", "verify"]);
export const runnerVerifyCommandSchema = z.enum(["pnpm-test", "pnpm-typecheck", "pnpm-lint", "npm-test"]);
export const runnerRelativePathSchema = z.string().trim().min(1).max(240).refine((value) => {
  const normalized = value.replaceAll("\\", "/");
  return !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized) && !normalized.split("/").includes("..");
}, "Path must stay relative to the granted project");

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

export const runnerProjectRequestSchema = z.object({
  label: runnerProjectLabelSchema,
  rootFingerprint: runnerRootFingerprintSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
}).strict();

export const runnerFileChangeSchema = z.object({
  path: runnerRelativePathSchema,
  content: z.string().max(50_000)
}).strict();

export const runnerJobRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("context"), maxFiles: z.number().int().min(1).max(80).default(40), maxBytes: z.number().int().min(1_000).max(120_000).default(80_000) }).strict(),
  z.object({ kind: z.literal("apply_changes"), summary: z.string().trim().min(1).max(800), changes: z.array(runnerFileChangeSchema).min(1).max(12) }).strict(),
  z.object({ kind: z.literal("verify"), command: runnerVerifyCommandSchema }).strict()
]);

export const runnerJobResultSchema = z.object({
  jobId: runnerJobIdSchema,
  status: z.enum(["succeeded", "failed"]),
  result: z.string().max(140_000),
  resultSha256: z.string().regex(/^[a-f0-9]{64}$/),
  completedAt: z.string().datetime(),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
}).strict();

export type RunnerPairRequest = z.infer<typeof runnerPairRequestSchema>;
export type RunnerHeartbeat = z.infer<typeof runnerHeartbeatSchema>;
export type RunnerJobRequest = z.infer<typeof runnerJobRequestSchema>;

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

export function runnerProjectRequestPayload(input: { runnerId: string; label: string; rootFingerprint: string }) {
  return canonical({
    protocol: "technoqueue-runner-project-v1",
    runnerId: input.runnerId,
    label: runnerProjectLabelSchema.parse(input.label),
    rootFingerprint: runnerRootFingerprintSchema.parse(input.rootFingerprint)
  });
}

export function runnerJobResultPayload(input: { jobId: string; status: "succeeded" | "failed"; resultSha256: string; completedAt: string }) {
  return canonical({
    protocol: "technoqueue-runner-job-result-v1",
    jobId: runnerJobIdSchema.parse(input.jobId),
    status: input.status,
    resultSha256: z.string().regex(/^[a-f0-9]{64}$/).parse(input.resultSha256),
    completedAt: z.string().datetime().parse(input.completedAt)
  });
}
