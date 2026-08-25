import { AuthError } from "@/lib/auth";

declare global { var __technoQueueRateLimits: Map<string, number[]> | undefined; }
const limits = globalThis.__technoQueueRateLimits ?? new Map<string, number[]>();
globalThis.__technoQueueRateLimits = limits;

export function enforceRateLimit(key: string, maximum: number, windowMs: number) {
  const now = Date.now(); const cutoff = now - windowMs;
  const recent = (limits.get(key) ?? []).filter((value) => value > cutoff);
  if (recent.length >= maximum) throw new AuthError("Too many requests. Please wait and try again.", 429);
  recent.push(now); limits.set(key, recent);
}

export function requestAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
