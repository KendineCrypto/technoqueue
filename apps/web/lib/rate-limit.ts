import { AuthError } from "@/lib/auth";

type RateBucket = { values: number[]; expiresAt: number };
declare global { var __technoQueueRateLimits: Map<string, RateBucket> | undefined; }
const limits = globalThis.__technoQueueRateLimits ?? new Map<string, RateBucket>();
globalThis.__technoQueueRateLimits = limits;
const MAX_BUCKETS = 10_000;

function sweep(now: number) {
  for (const [key, bucket] of limits) if (bucket.expiresAt <= now) limits.delete(key);
  if (limits.size <= MAX_BUCKETS) return;
  const oldest = [...limits.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let index = 0; index < oldest.length - MAX_BUCKETS; index += 1) limits.delete(oldest[index]![0]);
}

export function enforceRateLimit(key: string, maximum: number, windowMs: number) {
  const now = Date.now(); const cutoff = now - windowMs;
  if (limits.size >= MAX_BUCKETS || Math.random() < 0.01) sweep(now);
  const recent = (limits.get(key)?.values ?? []).filter((value) => value > cutoff);
  if (recent.length >= maximum) throw new AuthError("Too many requests. Please wait and try again.", 429);
  recent.push(now); limits.set(key, { values: recent, expiresAt: now + windowMs });
}

export function requestAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const proxyObservedAddress = forwarded.at(-1) || request.headers.get("x-real-ip")?.trim();
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  const cloudflareRay = request.headers.get("cf-ray")?.trim();
  let configuredHost: string | undefined;
  try { configuredHost = process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname : undefined; } catch { /* invalid configuration is never trusted */ }
  const requestHost = new URL(request.url).hostname;
  if (cloudflareAddress && cloudflareRay && configuredHost && requestHost === configuredHost) return `cf:${cloudflareAddress}`;
  return `proxy:${proxyObservedAddress || "local"}`;
}
