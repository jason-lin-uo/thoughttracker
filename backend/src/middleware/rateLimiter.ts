/**
 * Demo-mode safety nets.
 *
 * When `DEMO_MODE=true` (typically on a public hosted demo):
 * - A short per-IP rate limit guards every write endpoint
 * (`POST` / `PUT` / `DELETE` / `PATCH`).
 * - Verbose endpoints (analysis runs, report generation, import jobs)
 * get a stricter per-IP limit.
 *
 * Default DEMO_MODE is false — local dev and prod-with-keys are unchanged.
 */

import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../utils/logger";

/**
 * num — parse a numeric env string, falling back to `fallback` when missing or
 * non-finite (guards `Number("")` → 0 / `Number(undefined)` → NaN). Inlined
 * here (rather than imported from config/env) so this module doesn't pull in
 * config/env's dotenv side-effect at import time.
 */
function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const DEMO_MODE =
  (process.env.DEMO_MODE ?? "false").toLowerCase() === "true";

/**
 * Demo-mode hook. Demo mode now means stricter access control and rate limits
 * only; it must never rewrite real providers into fake ones.
 */
export function configureDemoMode(): void {
  if (!DEMO_MODE) return;
  logger.warn(
    "DEMO_MODE=true; provider rewrites are disabled so real-data behavior is preserved",
  );
}

/**
 * Generic API limiter — 120 requests / minute / IP. Doesn't apply to GET-only
 * pages that the frontend polls (we exempt `/api/health` and read-only routes).
 * Tweakable via env.
 */
export const apiRateLimiter: RequestHandler = rateLimit({
  /*
   * `num()` (not raw Number()) so an empty/garbage env var falls back to the
   * default instead of becoming 0 (which would block every write) or NaN.
   */
  windowMs: num(process.env.API_RATE_WINDOW_MS, 60_000),
  limit: num(process.env.API_RATE_LIMIT, 120),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  /*
   * The limiter is mounted at `/api`, so req.path is mount-relative
   * (`/health`, not `/api/health`). Match BOTH forms so the skip actually
   * fires, and also skip OPTIONS preflight (never a real write).
   */
  skip: (req) => {
    if (req.method === "GET" || req.method === "OPTIONS") return true;
    const p = req.path;
    return (
      p === "/health" ||
      p === "/api/health" ||
      p === "/system/status" ||
      p === "/api/system/status"
    );
  },
  message: {
    error: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment.",
  },
}) as unknown as RequestHandler;

/**
 * Stricter limiter for "expensive" endpoints that kick off background work
 * or generate reports. 10 / minute / IP by default.
 */
export const expensiveRateLimiter: RequestHandler = rateLimit({
  windowMs: num(process.env.EXPENSIVE_RATE_WINDOW_MS, 60_000),
  limit: num(process.env.EXPENSIVE_RATE_LIMIT, 10),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  /*
   * Use the canonical RATE_LIMITED code (was lowercase `rate_limited`, which
   * was inconsistent with the generic limiter and the rest of the API).
   */
  message: {
    error: "RATE_LIMITED",
    message: "Too many expensive requests. Please wait a moment.",
  },
}) as unknown as RequestHandler;
