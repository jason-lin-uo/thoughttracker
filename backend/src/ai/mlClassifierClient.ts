/**
 * Optional client for the companion ThoughtTracker ML FastAPI service.
 *
 * This client is wired into the live stance analysis pipeline via the
 * `STANCE_ANALYSIS_PROVIDER` env switch (modes: `llm` | `custom_ml`
 * | `hybrid`). See `services/stanceAnalysis.service.ts` for the orchestration
 * and `thoughttracker-ml/integration_contract.md` for the wire contract.
 *
 * Hard guarantees:
 * - Never throws. Always returns a typed `MlPredictResult` discriminated
 * by `ok: true | false` so the caller can fall back without try/catch.
 * - Honors `ML_CLASSIFIER_TIMEOUT_MS` (default 4000) — no hung requests.
 * - Retries 5xx + network errors with exponential backoff (3 attempts).
 * - 4xx responses are NOT retried (bad input won't fix itself).
 */

import { logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

/**
 * Base URL of the FastAPI service, captured at module load.
 *
 * Retained as an exported CONSTANT for back-compat (callers / status probes
 * read it), but the request paths below read the URL FRESH per call via
 * `mlClassifierUrl()` so a test (or a runtime reconfiguration) that sets
 * `ML_CLASSIFIER_URL` after import actually takes effect — the old behavior
 * of baking it in at import time made env changes silently inert.
 */
export const ML_CLASSIFIER_URL =
  process.env.ML_CLASSIFIER_URL ?? "http://localhost:8000";

/** Per-request timeout captured at module load (see mlClassifierTimeoutMs for the live read). */
export const ML_CLASSIFIER_TIMEOUT_MS = Number(
  process.env.ML_CLASSIFIER_TIMEOUT_MS ?? 4000,
);

/** Resolve the ML service base URL fresh on every call (env may change at runtime). */
function mlClassifierUrl(): string {
  return process.env.ML_CLASSIFIER_URL ?? "http://localhost:8000";
}

/**
 * Resolve the per-request timeout fresh on every call, falling back to 4s on a
 * missing/non-finite/non-positive value (so `ML_CLASSIFIER_TIMEOUT_MS=""` or
 * garbage can't disable the abort by yielding 0/NaN).
 */
function mlClassifierTimeoutMs(): number {
  const parsed = Number(process.env.ML_CLASSIFIER_TIMEOUT_MS ?? 4000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4000;
}

/** The 5 stance labels the ML model can emit. */
export type MlStanceLabel =
  | "supportive"
  | "opposed"
  | "neutral"
  | "mixed"
  | "unclear";
export type MlTopicRelevanceLabel = "relevant" | "irrelevant";

export interface MlPredictRequest {
  topic: string;
  text: string;
}

export interface MlPredictSuccess {
  ok: true;
  predictedLabel: MlStanceLabel;
  confidence: number;
  labelScores: Record<MlStanceLabel, number>;
  modelVersion: string;
}

export interface MlPredictFailure {
  ok: false;
  error:
    | "INVALID_INPUT"
    | "MODEL_NOT_LOADED"
    | "INTERNAL_ERROR"
    | "NETWORK_ERROR"
    | "TIMEOUT";
  message: string;
  status?: number;
}

export type MlPredictResult = MlPredictSuccess | MlPredictFailure;

export interface MlTopicRelevanceSuccess {
  ok: true;
  predictedLabel: MlTopicRelevanceLabel;
  confidence: number;
  labelScores: Record<MlTopicRelevanceLabel, number>;
  modelVersion: string;
}

export type MlTopicRelevanceResult = MlTopicRelevanceSuccess | MlPredictFailure;

export interface MlTopicCandidate {
  topicSlug: string;
  confidence: number;
}

export interface MlTopicCandidateSuccess {
  ok: true;
  topics: MlTopicCandidate[];
  modelVersion: string;
}

export type MlTopicCandidateResult = MlTopicCandidateSuccess | MlPredictFailure;

/**
 * Classify a (topic, text) pair via the ML service.
 *
 * @param req - the topic + transcript text to classify
 * @returns a discriminated union: `{ ok: true, ... }` on success,
 * `{ ok: false, error, message }` on any failure.
 */
export async function predictStance(
  req: MlPredictRequest,
): Promise<MlPredictResult> {
  if (!req.topic?.trim() || !req.text?.trim()) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "topic and text are required",
    };
  }

  try {
    return await withRetry(() => attemptPredict(req), {
      attempts: 3,
      label: "ml-predict",
      /*
       * Retry on retryable failures; stop on permanent ones.
       * The attempt fn already returns `{ ok: false, ... }` for permanent
       * failures (so withRetry sees a value, not an error) and throws for
       * retryable ones.
       */
      shouldRetry: (err) => {
        if (!(err instanceof Error)) return false;
        if (err.name === "AbortError") return true; /* timeout — try again */
        const status = (err as Error & { httpStatus?: number }).httpStatus;
        if (typeof status === "number") return status >= 500;
        return true; /* network error */
      },
    });
  } catch (err) {
    const failure = classifyThrownMlError(err);
    if (failure.error !== "TIMEOUT") {
      logger.warn("ML classifier call failed after retries", {
        error: failure.error,
        message: failure.message,
      });
    }
    return failure;
  }
}

/**
 * Score how relevant a (topic, text) pair is via the ML service's
 * `/predict-topic-relevance` endpoint.
 *
 * Same never-throw, timeout, and retry contract as predictStance: returns
 * a discriminated `{ ok }` union, retries 5xx/network/timeout, and treats
 * 4xx as permanent. Used by the `final_policy` topic-selection tier.
 */
export async function predictTopicRelevance(
  req: MlPredictRequest,
): Promise<MlTopicRelevanceResult> {
  if (!req.topic?.trim() || !req.text?.trim()) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "topic and text are required",
    };
  }

  try {
    return await withRetry(() => attemptTopicRelevancePredict(req), {
      attempts: 3,
      label: "ml-topic-relevance-predict",
      shouldRetry: (err) => {
        if (!(err instanceof Error)) return false;
        if (err.name === "AbortError") return true;
        const status = (err as Error & { httpStatus?: number }).httpStatus;
        if (typeof status === "number") return status >= 500;
        return true;
      },
    });
  } catch (err) {
    const failure = classifyThrownMlError(err);
    if (failure.error !== "TIMEOUT") {
      logger.warn("ML topic relevance call failed after retries", {
        error: failure.error,
        message: failure.message,
      });
    }
    return failure;
  }
}

/**
 * Fetch the top-K candidate topics for a chunk of text via the ML
 * service's `/predict-topics` reranker endpoint.
 *
 * `limit` and `minScore` are forwarded only when set so the service can
 * apply its own defaults. Same never-throw / retry / timeout contract as
 * the other predict* calls; feeds the `custom_ml_reranker` and
 * `final_policy` topic-selection tiers.
 */
export async function predictTopicCandidates(req: {
  text: string;
  limit?: number;
  minScore?: number;
}): Promise<MlTopicCandidateResult> {
  if (!req.text?.trim()) {
    return {
      ok: false,
      error: "INVALID_INPUT",
      message: "text is required",
    };
  }

  try {
    return await withRetry(() => attemptTopicCandidatePredict(req), {
      attempts: 3,
      label: "ml-topic-candidate-predict",
      shouldRetry: (err) => {
        if (!(err instanceof Error)) return false;
        if (err.name === "AbortError") return true;
        const status = (err as Error & { httpStatus?: number }).httpStatus;
        if (typeof status === "number") return status >= 500;
        return true;
      },
    });
  } catch (err) {
    const failure = classifyThrownMlError(err);
    if (failure.error !== "TIMEOUT") {
      logger.warn("ML topic candidate call failed after retries", {
        error: failure.error,
        message: failure.message,
      });
    }
    return failure;
  }
}

/** One attempt at hitting /predict. Throws on retryable failure; returns on permanent. */
async function attemptPredict(req: MlPredictRequest): Promise<MlPredictResult> {
  const controller = new AbortController();
  /* Abort the fetch once the timeout elapses; cleared in the finally block. */
  const timer = setTimeout(() => controller.abort(), mlClassifierTimeoutMs());
  try {
    const res = await fetch(`${mlClassifierUrl()}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: req.topic, text: req.text }),
      signal: controller.signal,
    });
    const text = await res.text();
    const body = safeJson(text);

    if (!res.ok) {
      const permanent = permanentFailureFor(res.status, body);
      if (permanent) return permanent;
      if (res.status >= 500) {
        const e = new Error(`ML server returned ${res.status}`) as Error & {
          httpStatus?: number;
        };
        e.httpStatus = res.status;
        throw e;
      }
      /* 4xx — permanent. */
      const errCode = extractStringField(body, "error");
      const message =
        extractStringField(body, "message") ?? `HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        error: normalizeErrorCode(errCode, res.status),
        message,
      };
    }

    if (!isValidPredictResponse(body)) {
      return {
        ok: false,
        status: res.status,
        error: "INTERNAL_ERROR",
        message: "ML classifier returned an unexpected response shape",
      };
    }

    return {
      ok: true,
      predictedLabel: body.predictedLabel,
      confidence: body.confidence,
      labelScores: body.labelScores,
      modelVersion: body.modelVersion,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One attempt at hitting /predict-topic-relevance. Throws on retryable failure; returns on permanent. */
async function attemptTopicRelevancePredict(
  req: MlPredictRequest,
): Promise<MlTopicRelevanceResult> {
  const controller = new AbortController();
  /* Abort the fetch once the timeout elapses; cleared in the finally block. */
  const timer = setTimeout(() => controller.abort(), mlClassifierTimeoutMs());
  try {
    const res = await fetch(`${mlClassifierUrl()}/predict-topic-relevance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: req.topic, text: req.text }),
      signal: controller.signal,
    });
    const text = await res.text();
    const body = safeJson(text);

    if (!res.ok) {
      const permanent = permanentFailureFor(res.status, body);
      if (permanent) return permanent;
      if (res.status >= 500) {
        const e = new Error(`ML server returned ${res.status}`) as Error & {
          httpStatus?: number;
        };
        e.httpStatus = res.status;
        throw e;
      }
      const errCode = extractStringField(body, "error");
      const message =
        extractStringField(body, "message") ?? `HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        error: normalizeErrorCode(errCode, res.status),
        message,
      };
    }

    if (!isValidTopicRelevanceResponse(body)) {
      return {
        ok: false,
        status: res.status,
        error: "INTERNAL_ERROR",
        message:
          "ML topic relevance classifier returned an unexpected response shape",
      };
    }

    return {
      ok: true,
      predictedLabel: body.predictedLabel,
      confidence: body.confidence,
      labelScores: body.labelScores,
      modelVersion: body.modelVersion,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One attempt at hitting /predict-topics. Throws on retryable failure; returns on permanent. */
async function attemptTopicCandidatePredict(req: {
  text: string;
  limit?: number;
  minScore?: number;
}): Promise<MlTopicCandidateResult> {
  const controller = new AbortController();
  /* Abort the fetch once the timeout elapses; cleared in the finally block. */
  const timer = setTimeout(() => controller.abort(), mlClassifierTimeoutMs());
  try {
    const res = await fetch(`${mlClassifierUrl()}/predict-topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: req.text,
        ...(req.limit ? { limit: req.limit } : {}),
        ...(req.minScore !== undefined ? { minScore: req.minScore } : {}),
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    const body = safeJson(text);

    if (!res.ok) {
      const permanent = permanentFailureFor(res.status, body);
      if (permanent) return permanent;
      if (res.status >= 500) {
        const e = new Error(`ML server returned ${res.status}`) as Error & {
          httpStatus?: number;
        };
        e.httpStatus = res.status;
        throw e;
      }
      const errCode = extractStringField(body, "error");
      const message =
        extractStringField(body, "message") ?? `HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        error: normalizeErrorCode(errCode, res.status),
        message,
      };
    }

    if (!isValidTopicCandidateResponse(body)) {
      return {
        ok: false,
        status: res.status,
        error: "INTERNAL_ERROR",
        message:
          "ML topic candidate classifier returned an unexpected response shape",
      };
    }

    return {
      ok: true,
      topics: body.topics,
      modelVersion: body.modelVersion,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe `GET {ML_CLASSIFIER_URL}/health`. Useful for `/api/system/status`
 * and operations dashboards.
 *
 * @returns reachable flag + model state, or `{ reachable: false, error }` on failure.
 */
export async function healthCheck(urlOverride?: string): Promise<{
  reachable: boolean;
  modelLoaded?: boolean;
  modelVersion?: string;
  error?: string;
}> {
  const controller = new AbortController();
  /* Abort the health probe once the timeout elapses; cleared on both paths below. */
  const timer = setTimeout(() => controller.abort(), mlClassifierTimeoutMs());
  const url = urlOverride ?? mlClassifierUrl();
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const body = safeJson(await res.text()) as {
      status?: string;
      modelLoaded?: boolean;
      modelVersion?: string;
    };
    return {
      reachable: body?.status === "ok",
      modelLoaded: body?.modelLoaded,
      modelVersion: body?.modelVersion,
    };
  } catch (err) {
    clearTimeout(timer);
    return { reachable: false, error: (err as Error).message };
  }
}

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

/** Best-effort JSON.parse. Returns null on failure. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * classifyThrownMlError — map an error that escaped `withRetry` (i.e. all
 * retries exhausted) to a TYPED MlPredictFailure, preserving the distinction
 * the caller cares about instead of collapsing everything to NETWORK_ERROR:
 * - an AbortError (the per-request timeout fired) → TIMEOUT
 * - a thrown 5xx (`httpStatus >= 500`, the retryable → INTERNAL_ERROR
 * server-error class the attempt fns throw) (+ the status)
 * - anything else (DNS/connection refused/parse failure) → NETWORK_ERROR
 *
 * Keeping these codes distinct lets dashboards/logs tell "ML box is down"
 * (NETWORK_ERROR) apart from "ML box is up but erroring" (INTERNAL_ERROR) and
 * "ML box is slow" (TIMEOUT), all of which previously read as NETWORK_ERROR.
 */
function classifyThrownMlError(err: unknown): MlPredictFailure {
  if ((err as { name?: string })?.name === "AbortError") {
    return {
      ok: false,
      error: "TIMEOUT",
      message: `ML classifier did not respond within ${mlClassifierTimeoutMs()}ms`,
    };
  }
  const status = (err as Error & { httpStatus?: number })?.httpStatus;
  if (typeof status === "number" && status >= 500) {
    return {
      ok: false,
      status,
      error: "INTERNAL_ERROR",
      message: (err as Error).message,
    };
  }
  return {
    ok: false,
    error: "NETWORK_ERROR",
    message: (err as Error).message,
  };
}

/**
 * permanentFailureFor — detect non-retryable failures hiding behind a 5xx
 * status, so they fall back to the LLM immediately instead of burning the
 * retry budget.
 *
 * Per integration_contract §10, a `503 MODEL_NOT_LOADED` is a deterministic
 * "this model will never load on this request" signal — retrying it 3× with
 * exponential backoff just stalls each chunk ~12s for nothing. We treat it as
 * a permanent `{ ok: false, error: "MODEL_NOT_LOADED" }` result (no throw → no
 * retry). All other 5xx return null so the caller still throws-and-retries.
 */
function permanentFailureFor(
  status: number,
  body: unknown,
): MlPredictFailure | null {
  if (
    status === 503 &&
    extractStringField(body, "error") === "MODEL_NOT_LOADED"
  ) {
    return {
      ok: false,
      status,
      error: "MODEL_NOT_LOADED",
      message:
        extractStringField(body, "message") ??
        "ML model not loaded; falling back",
    };
  }
  return null;
}

/** Extract a string field from an unknown object, or undefined. */
function extractStringField(obj: unknown, field: string): string | undefined {
  if (obj && typeof obj === "object" && field in obj) {
    const v = (obj as Record<string, unknown>)[field];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

/**
 * Map server-side error codes + statuses into our typed failure shape.
 *
 * The caller throws on `status >= 500` before invoking us (so the
 * retry path can kick in), so this helper only sees 4xx responses.
 * That makes the post-errCode fallback always-`INVALID_INPUT`.
 */
function normalizeErrorCode(
  errCode: string | undefined,
  _status: number,
): MlPredictFailure["error"] {
  if (errCode === "INVALID_INPUT") return "INVALID_INPUT";
  if (errCode === "MODEL_NOT_LOADED") return "MODEL_NOT_LOADED";
  if (errCode === "INTERNAL_ERROR") return "INTERNAL_ERROR";
  return "INVALID_INPUT";
}

/**
 * isProbability — true only for a real probability: a finite number in [0,1].
 *
 * `typeof x === "number"` alone passes NaN, Infinity, and out-of-range values
 * (a `confidence` of 7 or NaN would otherwise flow through as a "valid"
 * prediction and corrupt thresholds/sorting downstream). We reject those here
 * so a malformed ML response is treated as a bad shape (→ INTERNAL_ERROR
 * fallback) rather than trusted. Applied to the model's CONFIDENCE field.
 */
function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/**
 * isFiniteNumber — finite number, no range constraint.
 *
 * Used for per-label SCORES (`labelScores`), which some rerankers emit as raw
 * (un-normalized) values that legitimately fall outside [0,1] and are clamped
 * downstream by the relevance service. We still reject NaN/±Infinity here
 * (those are never a usable score), but don't impose the [0,1] bound we apply
 * to `confidence`.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Type guard for the expected /predict response body. */
function isValidPredictResponse(body: unknown): body is {
  predictedLabel: MlStanceLabel;
  confidence: number;
  labelScores: Record<MlStanceLabel, number>;
  modelVersion: string;
} {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const labels: MlStanceLabel[] = [
    "supportive",
    "opposed",
    "neutral",
    "mixed",
    "unclear",
  ];
  if (typeof b.predictedLabel !== "string") return false;
  if (!labels.includes(b.predictedLabel as MlStanceLabel)) return false;
  /* confidence must be a finite probability in [0,1], not merely typeof number. */
  if (!isProbability(b.confidence)) return false;
  if (typeof b.modelVersion !== "string") return false;
  if (!b.labelScores || typeof b.labelScores !== "object") return false;
  const scores = b.labelScores as Record<string, unknown>;
  for (const label of labels) {
    /*
     * Per-label scores must be finite (reject NaN/Infinity) but may be raw,
     * un-normalized values clamped downstream — so no [0,1] bound here.
     */
    if (!isFiniteNumber(scores[label])) return false;
  }
  return true;
}

/** Type guard for the expected /predict-topic-relevance response body (relevant/irrelevant scores). */
function isValidTopicRelevanceResponse(body: unknown): body is {
  predictedLabel: MlTopicRelevanceLabel;
  confidence: number;
  labelScores: Record<MlTopicRelevanceLabel, number>;
  modelVersion: string;
} {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const labels: MlTopicRelevanceLabel[] = ["relevant", "irrelevant"];
  if (typeof b.predictedLabel !== "string") return false;
  if (!labels.includes(b.predictedLabel as MlTopicRelevanceLabel)) return false;
  /* confidence must be a finite probability in [0,1], not merely typeof number. */
  if (!isProbability(b.confidence)) return false;
  if (typeof b.modelVersion !== "string") return false;
  if (!b.labelScores || typeof b.labelScores !== "object") return false;
  const scores = b.labelScores as Record<string, unknown>;
  for (const label of labels) {
    /*
     * Per-label scores must be finite (reject NaN/Infinity) but may be raw,
     * un-normalized values clamped downstream — so no [0,1] bound here.
     */
    if (!isFiniteNumber(scores[label])) return false;
  }
  return true;
}

/** Type guard for the /predict-topics response: a topics array of {topicSlug, confidence} plus a modelVersion. */
function isValidTopicCandidateResponse(body: unknown): body is {
  topics: MlTopicCandidate[];
  modelVersion: string;
} {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.topics)) return false;
  if (typeof b.modelVersion !== "string") return false;
  return b.topics.every((topic) => {
    if (!topic || typeof topic !== "object") return false;
    const row = topic as Record<string, unknown>;
    /*
     * The reranker's per-topic confidence is a (possibly un-normalized) score
     * clamped downstream, so require finite (reject NaN/Infinity) but not [0,1].
     */
    return typeof row.topicSlug === "string" && isFiniteNumber(row.confidence);
  });
}
