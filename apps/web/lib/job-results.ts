import { decryptSecret, encryptSecret } from "@/lib/secure-vault";

const ENCRYPTED_JOB_RESULT_PREFIX = "tq-job-result-v1:";

export async function protectRunnerJobResult(kind: string, value: string) {
  if (kind !== "context") return value;
  return `${ENCRYPTED_JOB_RESULT_PREFIX}${await encryptSecret(value)}`;
}

export async function revealRunnerJobResult(kind: string, value: string) {
  if (kind !== "context" || !value.startsWith(ENCRYPTED_JOB_RESULT_PREFIX)) return value;
  return decryptSecret(value.slice(ENCRYPTED_JOB_RESULT_PREFIX.length));
}
