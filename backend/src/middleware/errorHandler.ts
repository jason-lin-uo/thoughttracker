import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { HttpError } from "../utils/errors";
import { pinoLogger } from "../utils/logger";

/**
 * Express error-handling middleware — the LAST `app.use(...)` registered
 * in `app.ts`. Express recognizes it as an error handler because of the
 * 4-arg `(err, req, res, next)` signature.
 *
 * Receives anything thrown from a controller (or passed via
 * `next(err)`) and translates it into a CONSISTENT JSON response shape
 * so the frontend's `ApiError` class can parse failures uniformly.
 *
 * Response shape (same fields on every error response across the API):
 * {
 * error: <ApiErrorCode> // machine-readable, e.g. "NOT_FOUND"
 * message: <string> // human-readable; safe to show users
 * requestId: <correlation id> // included on every response so users
 * // pasting an error into a bug report
 * // give us a thread to follow in logs
 * details: <any> // optional structured info — Zod field
 * // errors, validator output, etc.
 * }
 *
 * Two branches:
 * 1. **Known error** (`HttpError` or subclass) — we trust the thrown
 * object: use its status + code + message + details verbatim. This
 * is the path every "expected failure" goes through.
 * 2. **Unknown error** — anything else (a programmer mistake, a
 * database disconnect, a thrown string, ...) — we log the full
 * stack at error level via pino and return a generic 500 with the
 * `INTERNAL_ERROR` code. The original message is NEVER returned to
 * the client because it may contain stack frames / SQL / paths that
 * leak implementation details.
 *
 * The `requestId` is read off `req.id`, set earlier by the
 * `requestIdAndLogger` middleware. If a request slipped past that
 * (shouldn't happen, but defensively), we leave it undefined rather
 * than crashing the error handler itself.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  /*
   * Pull the per-request correlation id off the request. Cast is
   * defensive — Express's Request type doesn't carry `.id` natively;
   * we add it in requestIdAndLogger.
   */
  const requestId =
    typeof (req as { id?: unknown }).id === "string"
      ? ((req as { id?: string }).id as string)
      : undefined;

  /* ---- Path 1: known / typed errors ------------------------------------- */
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      requestId,
      details: err.details ?? undefined,
    });
    return;
  }

  /*
   * ---- Path 1b: a ZodError that reached here un-wrapped (a controller that
   * forgot to translate a .parse() failure). Map to 422 with the
   * flattened field errors, rather than a misleading 500.
   */
  if (err instanceof ZodError) {
    res.status(422).json({
      error: "VALIDATION_ERROR",
      message: "Request validation failed",
      requestId,
      details: err.flatten(),
    });
    return;
  }

  /*
   * ---- Path 1c: known Prisma request errors. The common one is P2025
   * ("record not found" on update/delete), which is a 404, not a
   * 500. P2002 (unique violation) is a 409 conflict. Other codes
   * fall through to the generic 500 below.
   */
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res
        .status(404)
        .json({ error: "NOT_FOUND", message: "Record not found", requestId });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({
        error: "CONFLICT",
        message: "Resource already exists",
        requestId,
      });
      return;
    }
  }

  /*
   * ---- Path 2: unknown errors. Log the FULL detail server-side; return a
   * sanitized 500 to the client.
   */
  pinoLogger.error(
    { requestId, error: (err as Error)?.message, stack: (err as Error)?.stack },
    "Unhandled error in request handler",
  );

  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "Internal server error",
    requestId,
  });
};
