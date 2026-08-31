import OpenAI from "openai";
import type { ProviderKind } from "./office";
import { buildAgentSystemPrompt } from "./role-blueprints";
import type { Task } from "./task";

export type ExecutionResult = { text: string; provider: "mock" | "openai" };
export interface TaskExecutor { execute(task: Task): Promise<ExecutionResult>; }
export interface ReviewExecutor { review(task: Task): Promise<{ approved: boolean; feedback?: string }>; }

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class MockExecutor implements TaskExecutor, ReviewExecutor {
  constructor(private readonly label = "Demo Worker", private readonly delayMs = 850) {}
  async execute(task: Task): Promise<ExecutionResult> {
    await delay(this.delayMs);
    return { provider: "mock", text: `[Mock worker result]\n\nTask processed successfully by ${this.label}.\n\nPrompt received: ${task.prompt}` };
  }
  async review(): Promise<{ approved: boolean; feedback?: string }> { await delay(this.delayMs); return { approved: true }; }
}

export class OpenAIExecutor implements TaskExecutor, ReviewExecutor {
  private readonly client: OpenAI;
  constructor(private readonly model: string, apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for provider=openai");
    this.client = new OpenAI({ apiKey });
  }
  async execute(task: Task): Promise<ExecutionResult> {
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      instructions: buildAgentSystemPrompt({
        name: "Standalone Worker",
        role: task.role,
        instructions: ""
      }),
      input: `${task.prompt}${task.review_feedback ? `\n\nReviewer feedback to address:\n${task.review_feedback}` : ""}`
    });
    return { provider: "openai", text: response.output_text };
  }
  async review(task: Task): Promise<{ approved: boolean; feedback?: string }> {
    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      instructions: buildAgentSystemPrompt({
        name: "Standalone Reviewer",
        role: "reviewer",
        instructions: ""
      }),
      input: `TASK:\n${task.prompt}\n\nCANDIDATE RESULT:\n${task.result ?? ""}`
    });
    const text = response.output_text.trim();
    return text.startsWith("APPROVE") ? { approved: true } : { approved: false, feedback: text.replace(/^REQUEST_CHANGES:?\s*/i, "").slice(0, 1000) || "The result needs revision." };
  }
}

export function createExecutor(provider: "mock" | "openai", label: string, model = process.env.TECHNOQUEUE_MODEL ?? "gpt-5") {
  return provider === "openai" ? new OpenAIExecutor(model) : new MockExecutor(label);
}

export type HostedExecutionInput = { system: string; prompt: string; maxOutputTokens?: number };
export type HostedExecutionResult = { text: string; usage: { promptTokens: number; outputTokens: number; totalTokens: number } };

function usage(promptTokens = 0, outputTokens = 0, totalTokens = promptTokens + outputTokens) {
  return { promptTokens, outputTokens, totalTokens };
}

function apiError(provider: string, response: Response, body: string) {
  const compact = body.replace(/\s+/g, " ").slice(0, 280);
  return new Error(`${provider} request failed (${response.status})${compact ? `: ${compact}` : ""}`);
}

export class HostedProviderExecutor {
  constructor(readonly provider: ProviderKind, readonly model: string, private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 60_000, private readonly retryDelayMs = 1_500) {
    if (!apiKey.trim()) throw new Error(`${provider} API key is required`);
  }

  async generate(input: HostedExecutionInput): Promise<string> {
    return (await this.generateWithUsage(input)).text;
  }

  async generateWithUsage(input: HostedExecutionInput): Promise<HostedExecutionResult> {
    if (this.provider === "openai") return this.openai(input);
    if (this.provider === "anthropic") return this.anthropic(input);
    if (this.provider === "deepseek") return this.deepseek(input);
    return this.gemini(input);
  }

  private async requestOnce(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetcher(url, { ...init, signal: controller.signal }); }
    catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error(`${this.provider} request timed out after ${Math.ceil(this.timeoutMs / 1000)} seconds`);
      throw error;
    } finally { clearTimeout(timer); }
  }

  private async request(url: string, init: RequestInit) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await this.requestOnce(url, init);
      if ((response.status !== 429 && response.status !== 500 && response.status !== 503) || attempt === 2) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.retryDelayMs * (2 ** attempt);
      if (waitMs > 0) await delay(Math.min(waitMs, 10_000));
    }
    return response!;
  }

  private async openai(input: HostedExecutionInput) {
    const response = await new OpenAI({ apiKey: this.apiKey }).responses.create({
      model: this.model,
      store: false,
      instructions: input.system,
      input: input.prompt,
      max_output_tokens: input.maxOutputTokens ?? 1800
    });
    if (!response.output_text.trim()) throw new Error("OpenAI returned no text output");
    return { text: response.output_text, usage: usage(response.usage?.input_tokens, response.usage?.output_tokens, response.usage?.total_tokens) };
  }

  private async anthropic(input: HostedExecutionInput) {
    const response = await this.request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: input.maxOutputTokens ?? 1800, system: input.system, messages: [{ role: "user", content: input.prompt }] })
    });
    const raw = await response.text();
    if (!response.ok) throw apiError("Anthropic", response, raw);
    const body = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = body.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
    if (!text) throw new Error("Anthropic returned no text output");
    return { text, usage: usage(body.usage?.input_tokens, body.usage?.output_tokens) };
  }

  private async deepseek(input: HostedExecutionInput) {
    const response = await this.request("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, max_tokens: input.maxOutputTokens ?? 1800, thinking: { type: "disabled" }, messages: [{ role: "system", content: input.system }, { role: "user", content: input.prompt }], stream: false })
    });
    const raw = await response.text();
    if (!response.ok) throw apiError("DeepSeek", response, raw);
    const body = JSON.parse(raw) as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error(`DeepSeek returned no final text${body.choices?.[0]?.finish_reason ? ` (${body.choices[0].finish_reason})` : ""}`);
    return { text, usage: usage(body.usage?.prompt_tokens, body.usage?.completion_tokens, body.usage?.total_tokens) };
  }

  private async gemini(input: HostedExecutionInput) {
    const response = await this.request("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ model: this.model, system_instruction: input.system, input: input.prompt, store: false, background: false, generation_config: { max_output_tokens: input.maxOutputTokens ?? 1800, thinking_level: "low" } })
    });
    const raw = await response.text();
    if (!response.ok) throw apiError("Gemini", response, raw);
    const body = JSON.parse(raw) as { output_text?: string; status?: string; error?: { message?: string }; steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } };
    const lastOutput = body.steps?.filter((step) => step.type === "model_output").at(-1);
    const text = body.output_text?.trim() || lastOutput?.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
    if (!text) throw new Error(`Gemini returned no text output${body.status ? ` (${body.status})` : ""}${body.error?.message ? `: ${body.error.message}` : ""}`);
    const measured = body.usage_metadata ?? body.usage;
    return { text, usage: usage(measured?.input_tokens, measured?.output_tokens, measured?.total_tokens) };
  }
}
