/**
 * LLM cost & budget controls.
 *
 * Two layers, both active by default:
 *
 * 1) Token / dollar budget per process. Defaults are generous
 * (LLM_DAILY_CALL_CAP=5000, LLM_DAILY_USD_CAP=5.0). When the budget
 * is exhausted, llmClient.runLlm() refuses the hosted call instead of
 * fabricating a report. This means a runaway analysis job CANNOT burn
 * unbounded LLM credit. Counters roll over every 24 hours.
 *
 * 2) Response cache keyed on (task, prompt_version, model, input_hash).
 * Re-runs of the same chunk against the same model are FREE. Disable
 * with LLM_CACHE_ENABLED=false.
 *
 * Both layers are in-process and per-pod. The cache uses LRU eviction:
 * `get()` bumps a hit to the tail and `set()` drops the head (the
 * least-recently-USED entry) when MAX_ENTRIES is hit. Swap to Redis when the
 * app runs in more than one process.
 */

import crypto from "crypto";
import { logger } from "../utils/logger";

/*
 * ---------------------------------------------------------------------------
 * Budget
 * ---------------------------------------------------------------------------
 */

interface BudgetCounters {
  callsMade: number;
  tokensIn: number;
  tokensOut: number;
  estimatedUsd: number;
  windowStartedAt: number;
}

const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

class LlmBudget {
  private counters: BudgetCounters = this.fresh();

  private fresh(): BudgetCounters {
    return {
      callsMade: 0,
      tokensIn: 0,
      tokensOut: 0,
      estimatedUsd: 0,
      windowStartedAt: Date.now(),
    };
  }

  private rollIfExpired(): void {
    if (Date.now() - this.counters.windowStartedAt > BUDGET_WINDOW_MS) {
      logger.info("LLM budget window rolled over", { previous: this.counters });
      this.counters = this.fresh();
    }
  }

  /** Reads tunable limits from env every call so they can be changed at runtime in tests. */
  private limits(): { maxCalls: number; maxUsd: number } {
    return {
      maxCalls: numEnv("LLM_DAILY_CALL_CAP", 5000),
      maxUsd: floatEnv("LLM_DAILY_USD_CAP", 5.0),
    };
  }

  shouldAllowCall(): { allowed: boolean; reason?: string } {
    this.rollIfExpired();
    const { maxCalls, maxUsd } = this.limits();
    if (this.counters.callsMade >= maxCalls) {
      return { allowed: false, reason: `daily call cap reached (${maxCalls})` };
    }
    if (this.counters.estimatedUsd >= maxUsd) {
      return {
        allowed: false,
        reason: `daily USD cap reached ($${maxUsd.toFixed(2)})`,
      };
    }
    return { allowed: true };
  }

  recordCall(args: {
    tokensIn: number;
    tokensOut: number;
    model: string;
    provider: string;
  }): void {
    this.rollIfExpired();
    this.counters.callsMade += 1;
    this.counters.tokensIn += args.tokensIn;
    this.counters.tokensOut += args.tokensOut;
    this.counters.estimatedUsd += estimateUsd(
      args.model,
      args.tokensIn,
      args.tokensOut,
      args.provider,
    );

    if (this.counters.callsMade % 50 === 0) {
      logger.info("LLM usage", this.snapshot());
    }
  }

  snapshot() {
    return {
      callsMade: this.counters.callsMade,
      tokensIn: this.counters.tokensIn,
      tokensOut: this.counters.tokensOut,
      estimatedUsd: Math.round(this.counters.estimatedUsd * 10000) / 10000,
      windowStartedAt: new Date(this.counters.windowStartedAt).toISOString(),
    };
  }

  /* For tests. */
  reset(): void {
    this.counters = this.fresh();
  }
}

/**
 * llm budget.
 */
export const llmBudget = new LlmBudget();

/*
 * ---------------------------------------------------------------------------
 * Cache
 * ---------------------------------------------------------------------------
 */

interface CacheEntry {
  value: unknown;
  storedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

class LlmCache {
  private store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  private isEnabled(): boolean {
    const raw = (process.env.LLM_CACHE_ENABLED ?? "true").toLowerCase();
    return raw !== "false" && raw !== "0" && raw !== "off";
  }

  get(key: string): unknown {
    if (!this.isEnabled()) return undefined;
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    /*
     * LRU bump: delete + re-set so the entry moves to the
     * most-recently-inserted position. Map preserves insertion order,
     * so the head-eviction in `set()` below drops the
     * least-recently-USED key instead of the least-recently-WRITTEN
     * one. Without this, a hot key written early could be evicted in
     * favor of a one-shot write that happens later.
     */
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown): void {
    if (!this.isEnabled()) return;
    /*
     * If the key exists, delete it first so the re-set lands at the
     * tail (most-recently-used) instead of updating in place. This
     * keeps the LRU ordering consistent across get+set paths.
     */
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= MAX_ENTRIES) {
      /* Cache full; drop the least-recently-used (head) entry. */
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, { value, storedAt: Date.now() });
  }

  snapshot() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate:
        this.hits + this.misses === 0
          ? 0
          : Math.round((this.hits / (this.hits + this.misses)) * 100) / 100,
    };
  }

  reset(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * llm cache.
 */
export const llmCache = new LlmCache();

/**
 * buildCacheKey — derive the LLM response-cache key.
 *
 * Includes the SYSTEM prompt alongside task/model/promptVersion/userPrompt.
 * Two calls with an identical user prompt but DIFFERENT system prompts produce
 * materially different model output, so omitting the system prompt let a call
 * collide with — and wrongly replay — a cached result generated under another
 * system instruction (e.g. a stricter neutral-framing system). Folding it in
 * keys each distinct (system, user) pair to its own cache entry. The system
 * prompt is optional so callers that don't set one still get a stable key.
 */
export function buildCacheKey(args: {
  task: string;
  model: string;
  userPrompt: string;
  system?: string;
  promptVersion?: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      `${args.task}::${args.model}::${args.promptVersion ?? ""}::${args.system ?? ""}::${args.userPrompt}`,
    )
    .digest("hex");
}

/*
 * ---------------------------------------------------------------------------
 * Pricing model — rough cents-per-1k-token figures. Used for the USD cap.
 * Keep this conservative; bumping these means the budget trips sooner.
 * ---------------------------------------------------------------------------
 */

const PRICES: Record<
  string,
  { inputPerToken: number; outputPerToken: number }
> = {
  "gpt-4o-mini": {
    inputPerToken: 0.00015 / 1000,
    outputPerToken: 0.0006 / 1000,
  },
  "gpt-4o": { inputPerToken: 0.005 / 1000, outputPerToken: 0.015 / 1000 },
  "claude-3-5-sonnet": {
    inputPerToken: 0.003 / 1000,
    outputPerToken: 0.015 / 1000,
  },
  "claude-3-5-haiku": {
    inputPerToken: 0.0008 / 1000,
    outputPerToken: 0.004 / 1000,
  },
};

/**
 * Estimate the USD cost of a call from its model and token counts.
 *
 * Looks the model up in the PRICES table; unknown models fall back to a
 * deliberately mid-to-high default so an unrecognized model is treated as
 * expensive (trips the budget sooner) rather than free.
 */
function estimateUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
  provider?: string,
): number {
  if (provider === "local") return 0;
  const p = PRICES[model] ?? {
    inputPerToken: 0.001 / 1000,
    outputPerToken: 0.003 / 1000,
  };
  return tokensIn * p.inputPerToken + tokensOut * p.outputPerToken;
}

/* Cheap token estimate — 1 token ≈ 4 chars of English. Good enough for budgeting. */
/**
 * estimate tokens.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/*
 * ---------------------------------------------------------------------------
 * env helpers (local copies; the runtime env is read fresh each call so tests
 * can mutate process.env between calls)
 * ---------------------------------------------------------------------------
 */

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read a floating-point env var, returning `fallback` when unset or
 * unparseable. Uses parseFloat (tolerates trailing units like "0.5usd")
 * unlike numEnv's stricter Number() coercion.
 */
function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
