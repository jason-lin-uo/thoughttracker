/**
 * Structured error types + the canonical list of API error codes.
 *
 * Every error response from the backend looks like:
 * { error: <CODE>, message: <string>, requestId?: <string>, details?: any }
 *
 * Throw a `HttpError` (or one of its subclasses) from any handler — the
 * error middleware converts it into the shape above.
 */

/** Canonical machine-readable error codes. Add to this union when adding new ones. */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  /*
   * Emitted by the global error handler: "VALIDATION_ERROR" for a ZodError
   * (request-body schema failure) and "CONFLICT" for a Prisma P2002 unique
   * violation (409). They were missing from this union, so the codes the
   * handler actually puts on the wire weren't part of the declared contract.
   */
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "REQUEST_TIMEOUT"
  | "LLM_UNAVAILABLE"
  | "ML_UNAVAILABLE"
  | "DB_UNAVAILABLE"
  | "INTERNAL_ERROR";

/**
 * Base class for any error that should be serialised into a structured
 * `{ error, message, ... }` HTTP response.
 *
 * @example
 * throw new HttpError(422, "VALIDATION_FAILED", "Invalid stance label", { field: "stanceLabel" });
 */
export class HttpError extends Error {
  /** HTTP status code to send. */
  status: number;
  /** Machine-readable error code (one of `ApiErrorCode`). */
  code: ApiErrorCode;
  /** Optional structured details, surfaced to the client unchanged. */
  details?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    /*
     * Validate the status is a real HTTP status code (integer in [100, 599]).
     * A bogus value (a typo, an upstream error code mistaken for an HTTP one,
     * a 0 / NaN) would otherwise reach `res.status(...)`, which throws
     * "Invalid status code" and turns a clean error response into an opaque
     * 500. Failing here gives a precise stack at the throw site instead.
     */
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new RangeError(
        `HttpError received an invalid HTTP status code: ${status} (expected an integer in 100–599)`,
      );
    }
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = "HttpError";
  }
}

/** 404 — resource does not exist. */
export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

/** 400 — request was malformed or failed validation. */
export class BadRequestError extends HttpError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
    this.name = "BadRequestError";
  }
}

/** 422 — schema validation failed (Zod, etc.). */
export class ValidationError extends HttpError {
  constructor(message = "Validation failed", details?: unknown) {
    super(422, "VALIDATION_FAILED", message, details);
    this.name = "ValidationError";
  }
}

/** 429 — rate limit exceeded. */
export class RateLimitedError extends HttpError {
  constructor(message = "Too many requests") {
    super(429, "RATE_LIMITED", message);
    this.name = "RateLimitedError";
  }
}

/** 503 — an upstream dependency (LLM / ML / DB) is unavailable. */
export class UpstreamUnavailableError extends HttpError {
  constructor(
    code: "LLM_UNAVAILABLE" | "ML_UNAVAILABLE" | "DB_UNAVAILABLE",
    message: string,
  ) {
    super(503, code, message);
    this.name = "UpstreamUnavailableError";
  }
}
