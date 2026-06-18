/**
 * Retry helper with exponential backoff for transient failures.
 *
 * Used by:
 * - `runLlm()` on the real LLM path (OpenAI / Anthropic): transient
 * network errors and 5xx responses are retried; 4xx are not (no amount
 * of retrying will fix a bad request).
 * - `mlClassifierClient.predictStance()`: same rules.
 *
 * Default schedule:
 * attempt 1: immediate
 * attempt 2: ~100ms after attempt 1
 * attempt 3: ~300ms after attempt 2
 * attempt 4: ~900ms after attempt 3
 *
 * Total time before giving up: ~1.3s, with full jitter to avoid thundering
 * herd if many requests fail at once.
 */

import { pinoLogger } from "./logger";
import { HttpError } from "./errors";

export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** Base delay between attempts in ms (default 100). */
  baseDelayMs?: number;
  /** Multiplier per attempt (default 3 → 100 → 300 → 900). */
  factor?: number;
  /** Predicate that returns true when the error is retryable. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Label used in log lines for traceability. */
  label?: string;
}

/**
 * Default classifier: retry transient errors, skip permanent client errors.
 *
 * Uses `instanceof HttpError` (not brittle string matching on `err.name`, which
 * a plain `new Error()` with a copied name — or a subclass that forgot to set
 * `.name` — would defeat). A typed HttpError is permanent when its status is a
 * 4xx (bad input / not found / validation won't improve by retrying); a 5xx
 * HttpError (e.g. UpstreamUnavailableError) is treated as transient. Non-Error
 * throws are not retried.
 */
function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status >= 500;
  }
  if (err instanceof Error) {
    return true;
  }
  return false;
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with retries on transient failure. Returns the first successful
 * value, or throws the last error after exhausting attempts.
 *
 * @param fn - async function to execute
 * @param opts - retry policy options
 * @returns the resolved value of `fn`
 * @throws the last error from `fn` if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 100;
  const factor = opts.factor ?? 3;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const label = opts.label ?? "withRetry";

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delay = Math.floor(
        baseDelayMs *
          Math.pow(factor, attempt - 1) *
          (0.7 + Math.random() * 0.6),
      );
      pinoLogger.warn(
        { label, attempt, nextDelayMs: delay, error: (err as Error)?.message },
        "retryable error; will retry",
      );
      await sleep(delay);
    }
  }
  /* c8 ignore next 2 — unreachable: the loop body throws on the last failure */
  throw lastErr as Error;
}
