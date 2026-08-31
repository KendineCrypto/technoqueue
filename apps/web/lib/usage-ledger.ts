import { randomUUID } from "node:crypto";
import type { HostedExecutionResult, ProviderKind } from "@technoqueue/core";
import { all, one, run } from "@/lib/db";

type LimitRow = { daily_request_limit: number | null; daily_token_limit: number | null };
type AggregateRow = { requests: number; prompt_tokens: number; output_tokens: number; total_tokens: number };

function utcDayStart() { const date = new Date(); date.setUTCHours(0, 0, 0, 0); return date.toISOString(); }

export function agentUsageLimit(workspaceId: string, agentId: string) {
  const row = one<LimitRow>("SELECT daily_request_limit, daily_token_limit FROM agent_usage_limits WHERE workspace_id = ? AND agent_id = ?", workspaceId, agentId);
  return { dailyRequestLimit: row?.daily_request_limit ?? null, dailyTokenLimit: row?.daily_token_limit ?? null };
}

export function assertWithinUsageLimit(workspaceId: string, agentId: string) {
  const limit = agentUsageLimit(workspaceId, agentId);
  const used = one<AggregateRow>(`SELECT COUNT(*) AS requests, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS total_tokens
    FROM provider_usage WHERE workspace_id = ? AND agent_id = ? AND created_at >= ?`, workspaceId, agentId, utcDayStart()) ?? { requests: 0, prompt_tokens: 0, output_tokens: 0, total_tokens: 0 };
  if (limit.dailyRequestLimit !== null && used.requests >= limit.dailyRequestLimit) throw new Error(`Daily request limit reached (${used.requests}/${limit.dailyRequestLimit}). Change the employee budget to continue.`);
  if (limit.dailyTokenLimit !== null && used.total_tokens >= limit.dailyTokenLimit) throw new Error(`Daily token limit reached (${used.total_tokens}/${limit.dailyTokenLimit}). Change the employee budget to continue.`);
}

export function recordProviderUsage(input: { workspaceId: string; agentId: string; taskId: string; provider: ProviderKind; model: string; execution: HostedExecutionResult; inputText: string }) {
  const prompt = input.execution.usage.promptTokens || Math.ceil(input.inputText.length / 4);
  const output = input.execution.usage.outputTokens || Math.ceil(input.execution.text.length / 4);
  const total = input.execution.usage.totalTokens || prompt + output;
  run(`INSERT INTO provider_usage(id, workspace_id, agent_id, task_id, provider, model, prompt_tokens, output_tokens, total_tokens, estimated_usd_micros, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`, `usage-${randomUUID()}`, input.workspaceId, input.agentId, input.taskId, input.provider, input.model, prompt, output, total, new Date().toISOString());
  return { promptTokens: prompt, outputTokens: output, totalTokens: total };
}

export function workspaceUsage(workspaceId: string) {
  const totals = one<AggregateRow>(`SELECT COUNT(*) AS requests, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS total_tokens
    FROM provider_usage WHERE workspace_id = ? AND created_at >= ?`, workspaceId, utcDayStart()) ?? { requests: 0, prompt_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const agents = all<AggregateRow & { agent_id: string }>(`SELECT agent_id, COUNT(*) AS requests, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(total_tokens),0) AS total_tokens
    FROM provider_usage WHERE workspace_id = ? AND created_at >= ? GROUP BY agent_id ORDER BY total_tokens DESC`, workspaceId, utcDayStart());
  return { period: "UTC_TODAY", totals: { requests: totals.requests, promptTokens: totals.prompt_tokens, outputTokens: totals.output_tokens, totalTokens: totals.total_tokens }, agents: agents.map((value) => ({ agentId: value.agent_id, requests: value.requests, promptTokens: value.prompt_tokens, outputTokens: value.output_tokens, totalTokens: value.total_tokens, ...agentUsageLimit(workspaceId, value.agent_id) })) };
}
