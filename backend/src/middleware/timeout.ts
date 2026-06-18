import type { RequestHandler } from "express";

/**
 * Per-request hard timeout on GET endpoints. If the handler hasn't
 * responded within `ms` milliseconds, returns 503 with the structured
 * error shape. Background work continues (we don't want to abort
 * mid-DB-transaction); only the HTTP response is terminated.
 *
 * Mutations (`POST` / `PUT` / `PATCH` / `DELETE`) are skipped because
 * they often kick off background jobs that legitimately take time.
 * Those return 202 early anyway.
 *
 * @param ms - maximum milliseconds to wait for a response
 * @returns Express middleware
 */
export function requestTimeout(ms: number): RequestHandler {
  return (req, res, next) => {
    if (req.method !== "GET") return next();
    const requestId = (req as { id?: string }).id;
    /*
     * Arm the timeout; the finish/close listeners below clear it so a
     * request that responds in time never fires the 503.
     */
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({
          error: "REQUEST_TIMEOUT",
          message: `Request exceeded ${ms}ms`,
          requestId,
        });
      }
    }, ms);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}
