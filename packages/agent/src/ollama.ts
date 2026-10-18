import { createHash } from "node:crypto";

export const PROMPT_VERSION = "2026-10-19";

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_name?: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } };
export type ChatOptions = { temperature?: number; num_predict?: number };

export type ChatResult = {
  content: string;
  toolCalls: { name: string; arguments: Record<string, unknown> }[];
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
};

export type ModelCallLog = {
  purpose: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  latencyMs: number;
  outcome: "ok" | "invalid" | "repaired" | "failed" | "timeout";
};

export type OllamaOptions = {
  host: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  onCall?: (log: ModelCallLog) => void;
  retries?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const estimate = (text: string) => Math.ceil(text.length / 4);

export class OllamaError extends Error {
  outcome: "failed" | "timeout";
  constructor(message: string, outcome: "failed" | "timeout") {
    super(message);
    this.outcome = outcome;
  }
}

/**
 * Ollama Cloud client for Gemma 4 31B (docs/06). Serialises calls (free tier = 1 concurrent), retries on
 * network/429/5xx, and logs each call. Never throws a secret.
 */
export function createOllama(opts: OllamaOptions) {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const retries = opts.retries ?? 2;
  let chain: Promise<unknown> = Promise.resolve();

  async function health(): Promise<boolean> {
    try {
      const res = await doFetch(`${opts.host}/api/tags`, { headers: { Authorization: `Bearer ${opts.apiKey}` }, signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function raw(purpose: string, messages: ChatMessage[], tools: ToolDef[] | undefined, options: ChatOptions): Promise<ChatResult> {
    const body = JSON.stringify({ model: opts.model, messages, stream: false, ...(tools ? { tools } : {}), options });
    const promptHash = createHash("sha256").update(body).digest("hex").slice(0, 16);
    const started = Date.now();
    let lastError = "unknown";
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(`${opts.host}/api/chat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after")) * 1000;
          lastError = `status ${res.status}`;
          if (attempt < retries) {
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt === 0 ? 2000 : 6000);
            continue;
          }
          opts.onCall?.({ purpose, promptHash, inputTokens: 0, outputTokens: 0, estimated: true, latencyMs: Date.now() - started, outcome: "failed" });
          throw new OllamaError(`Ollama ${lastError}`, "failed");
        }
        const json = (await res.json()) as {
          message?: { content?: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] };
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const content = json.message?.content ?? "";
        const toolCalls = (json.message?.tool_calls ?? []).map((t) => ({ name: t.function.name, arguments: t.function.arguments ?? {} }));
        const estimated = json.prompt_eval_count === undefined || json.eval_count === undefined;
        const inputTokens = json.prompt_eval_count ?? estimate(body);
        const outputTokens = json.eval_count ?? estimate(content || JSON.stringify(toolCalls));
        opts.onCall?.({ purpose, promptHash, inputTokens, outputTokens, estimated, latencyMs: Date.now() - started, outcome: "ok" });
        return { content, toolCalls, inputTokens, outputTokens, estimated };
      } catch (e) {
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        lastError = timeout ? "timeout" : "network error";
        if (attempt < retries && !(e instanceof OllamaError)) {
          await sleep(attempt === 0 ? 2000 : 6000);
          continue;
        }
        const outcome = timeout ? "timeout" : "failed";
        opts.onCall?.({ purpose, promptHash, inputTokens: 0, outputTokens: 0, estimated: true, latencyMs: Date.now() - started, outcome });
        throw e instanceof OllamaError ? e : new OllamaError(`Ollama ${lastError}`, outcome);
      }
    }
    throw new OllamaError("Ollama exhausted retries", "failed");
  }

  /** Serialises every call behind a one-at-a-time mutex. */
  function chat(purpose: string, messages: ChatMessage[], tools: ToolDef[] | undefined, options: ChatOptions = {}): Promise<ChatResult> {
    const run = chain.then(() => raw(purpose, messages, tools, options));
    chain = run.catch(() => undefined);
    return run;
  }

  return { chat, health, model: opts.model };
}

export type Ollama = ReturnType<typeof createOllama>;

/** First balanced JSON object in a string (models wrap it in prose or ```json fences). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in output");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON object in output");
}
