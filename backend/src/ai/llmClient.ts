import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import {
  buildCacheKey,
  estimateTokens,
  llmBudget,
  llmCache,
} from "./llmBudget";

/**
 * Unified LLM dispatch layer. Every service that needs a language-model call
 * goes through runLlm(); this file is the only place that knows about provider
 * request shapes for Ollama, OpenAI, and Anthropic.
 *
 * Design pillars:
 * - Provider-agnostic call sites: services pass prompts and receive typed
 * provider metadata with the raw/parsed response.
 * - Runtime env reads: tests and local runs can switch providers without
 * reloading this module.
 * - Cache before call: repeated prompts reuse the in-process LRU cache.
 * - Budget gate: hosted providers respect the daily token/USD ceiling.
 * - Real failures stay visible: no fabricated report is generated when the
 * selected provider, key, local model, or quota is unavailable.
 */

/**
 * Resolve the active LLM provider on every call. Re-reading process.env here
 * lets tests switch providers between cases without a module reload.
 */
function currentProvider(): "openai" | "anthropic" | "local" {
  const v = (process.env.AI_PROVIDER ?? "local").toLowerCase();
  if (v === "openai" || v === "anthropic" || v === "local") return v;
  throw new Error(
    `Unsupported AI_PROVIDER="${v}". Use local, openai, or anthropic.`,
  );
}

/** Resolve the active model name. Defaults to a small local Ollama model in local mode. */
function currentModel(): string {
  if (currentProvider() === "local")
    return process.env.AI_MODEL ?? "llama3.1:8b";
  return process.env.AI_MODEL ?? "gpt-4o-mini";
}

/** Resolve the API key. Empty string is "no key"; we never send "Bearer " on its own. */
function currentApiKey(): string {
  return process.env.AI_API_KEY ?? "";
}

/** Resolve the local LLM base URL. Ollama's default local API is port 11434. */
function localLlmBaseUrl(): string {
  return (process.env.LOCAL_LLM_BASE_URL ?? "http://localhost:11434").replace(
    /\/+$/,
    "",
  );
}

function localJsonFormatFor(task: LlmTask): "json" | Record<string, unknown> {
  if (task !== "creator_report" && task !== "topic_report") return "json";
  return {
    type: "object",
    required: ["title", "summary", "caveats", "sections", "evidence"],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      caveats: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["heading", "bullets"],
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
            bullets: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: { type: "string" },
            },
          },
        },
      },
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            analysisId: { type: "string" },
            videoId: { type: "string" },
            videoTitle: { type: "string" },
            topicId: { type: "string" },
            topic: { type: "string" },
            note: { type: "string" },
          },
        },
      },
    },
  };
}

/**
 * Per-request LLM timeout in ms. Read at call time from LLM_TIMEOUT_MS
 * (default 30s) so one hung provider connection cannot block the serial job
 * queue indefinitely.
 */
function llmTimeoutMs(): number {
  const parsed = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
}

/**
 * fetchWithTimeout wraps fetch in an AbortController so a hung TCP connection
 * surfaces as an AbortError. The timer is always cleared in finally.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface LlmRequest {
  system: string;
  userPrompt: string;
  temperature?: number;
  responseFormat?: "json";
  task: LlmTask;
  taskInput?: Record<string, unknown>;
  /** Prompt version string from the prompt file; folded into the cache key. */
  promptVersion?: string;
  /** Bypass the cache for this call, for example when intentionally re-running analysis. */
  bypassCache?: boolean;
}

export type LlmTask =
  | "topic_detection"
  | "stance_classification"
  | "video_topic_summary"
  | "creator_timeline"
  | "creator_report"
  | "topic_report";

export interface LlmResult {
  rawText: string;
  json: unknown;
  provider: string;
  modelName: string;
  /** True when this result came from the in-process cache. */
  cached?: boolean;
  /** Reserved for future provider-level degradation; current runtime paths do not fake output. */
  degraded?: boolean;
}

/**
 * The only entry point services should use to invoke an LLM.
 *
 * Flow:
 * 1. Build a cache key from task/model/system/userPrompt/promptVersion.
 * 2. Return cached output when available.
 * 3. For hosted providers, refuse calls that exceed the configured budget.
 * 4. Dispatch to local Ollama, OpenAI, or Anthropic.
 * 5. Record usage and cache only genuine provider output.
 */
export async function runLlm(req: LlmRequest): Promise<LlmResult> {
  const provider = currentProvider();
  const model = currentModel();

  const cacheKey = buildCacheKey({
    task: req.task,
    model,
    userPrompt: req.userPrompt,
    system: req.system,
    promptVersion: req.promptVersion,
  });

  if (!req.bypassCache) {
    const hit = llmCache.get(cacheKey);
    if (hit !== undefined) {
      return { ...(hit as LlmResult), cached: true };
    }
  }

  if (provider !== "local") {
    const decision = llmBudget.shouldAllowCall();
    if (!decision.allowed) {
      logger.warn("LLM budget exhausted; refusing hosted generation", {
        reason: decision.reason,
        ...llmBudget.snapshot(),
      });
      throw new Error(`llm_budget_exhausted:${decision.reason}`);
    }
  }

  let result: LlmResult;
  if (provider === "openai") {
    result = await runOpenAi(req);
  } else if (provider === "local") {
    result = await runLocalLlm(req);
  } else {
    result = await runAnthropic(req);
  }

  if (!result.degraded) {
    llmBudget.recordCall({
      tokensIn: estimateTokens(`${req.system}\n${req.userPrompt}`),
      tokensOut: estimateTokens(result.rawText),
      model: result.modelName,
      provider: result.provider,
    });
    llmCache.set(cacheKey, result);
  }

  return result;
}

/**
 * 4xx statuses are not retried: bad input, auth failures, and model-not-found
 * do not improve by waiting. 5xx and network errors are retried.
 */
function isRetryableHttpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { httpStatus?: number }).httpStatus;
  if (typeof status === "number") {
    if (status >= 400 && status < 500) return false;
    return true;
  }
  return true;
}

/** Thin fetch wrapper around OpenAI's chat completions API. */
async function runOpenAi(req: LlmRequest): Promise<LlmResult> {
  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${currentApiKey()}`,
            },
            body: JSON.stringify({
              model: currentModel(),
              temperature: req.temperature ?? 0.2,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.userPrompt },
              ],
            }),
          },
          llmTimeoutMs(),
        );

        if (!res.ok) {
          const errorText =
            typeof res.text === "function"
              ? await res.text().catch(() => "")
              : "";
          const e = new Error(
            `openai_status_${res.status}${errorText ? `: ${errorText}` : ""}`,
          ) as Error & { httpStatus?: number };
          e.httpStatus = res.status;
          throw e;
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawText = data.choices?.[0]?.message?.content ?? "{}";
        return {
          rawText,
          json: safeParseJson(rawText),
          provider: "openai",
          modelName: currentModel(),
        };
      },
      { attempts: 3, shouldRetry: isRetryableHttpError, label: "openai" },
    );
  } catch (err) {
    logger.warn("OpenAI call failed after retries", {
      error: (err as Error).message,
    });
    throw err;
  }
}

/** Thin fetch wrapper around Ollama's local chat API. */
async function runLocalLlm(req: LlmRequest): Promise<LlmResult> {
  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          `${localLlmBaseUrl()}/api/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: currentModel(),
              stream: false,
              ...(req.responseFormat === "json"
                ? { format: localJsonFormatFor(req.task) }
                : {}),
              options: { temperature: req.temperature ?? 0.2 },
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.userPrompt },
              ],
            }),
          },
          llmTimeoutMs(),
        );

        if (!res.ok) {
          const errorText =
            typeof res.text === "function"
              ? await res.text().catch(() => "")
              : "";
          const e = new Error(
            `local_llm_status_${res.status}${errorText ? `: ${errorText}` : ""}`,
          ) as Error & { httpStatus?: number };
          e.httpStatus = res.status;
          throw e;
        }

        const data = (await res.json()) as {
          message?: { content?: string };
          response?: string;
        };
        const rawText = data.message?.content ?? data.response ?? "{}";
        return {
          rawText,
          json: safeParseJson(rawText),
          provider: "local",
          modelName: currentModel(),
        };
      },
      { attempts: 2, shouldRetry: isRetryableHttpError, label: "local_llm" },
    );
  } catch (err) {
    logger.warn("Local LLM call failed after retries", {
      error: (err as Error).message,
      baseUrl: localLlmBaseUrl(),
      model: currentModel(),
    });
    throw err;
  }
}

/** Thin fetch wrapper around Anthropic's messages API. */
async function runAnthropic(req: LlmRequest): Promise<LlmResult> {
  try {
    return await withRetry(
      async () => {
        const res = await fetchWithTimeout(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": currentApiKey(),
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: currentModel(),
              max_tokens: 1500,
              system: req.system,
              messages: [{ role: "user", content: req.userPrompt }],
            }),
          },
          llmTimeoutMs(),
        );

        if (!res.ok) {
          const e = new Error(`anthropic_status_${res.status}`) as Error & {
            httpStatus?: number;
          };
          e.httpStatus = res.status;
          throw e;
        }

        const data = (await res.json()) as {
          content?: Array<{ text?: string }>;
        };
        const rawText = data.content?.[0]?.text ?? "{}";
        return {
          rawText,
          json: safeParseJson(rawText),
          provider: "anthropic",
          modelName: currentModel(),
        };
      },
      { attempts: 3, shouldRetry: isRetryableHttpError, label: "anthropic" },
    );
  } catch (err) {
    logger.warn("Anthropic call failed after retries", {
      error: (err as Error).message,
    });
    throw err;
  }
}

/**
 * Tolerant JSON parser for LLM responses.
 *
 * It first tries JSON.parse on the full input. If that fails, it tries the
 * substring between the first "{" and the last "}", which recovers responses
 * wrapped in prose. Total failure returns null so Zod validation can reject it
 * honestly instead of treating "{}" as a meaningful response.
 */
function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
