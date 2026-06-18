import { randomUUID } from "crypto";
import type { RequestHandler } from "express";
import { pinoLogger } from "../utils/logger";
import pinoHttp from "pino-http";

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
    log?: import("pino").Logger;
  }
}

/**
 * Adds a stable correlation id to every request (`req.id`) and exposes a
 * scoped logger at `req.log` that includes it. Honors an incoming
 * `X-Request-Id` header if present (useful for tracing across services).
 */
export const requestIdAndLogger: RequestHandler = (req, res, next) => {
  const incoming = req.header("x-request-id");
  req.id =
    incoming && /^[A-Za-z0-9-_]{8,64}$/.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
};

/** Structured per-request logs via pino-http. */
export const httpLogger = pinoHttp({
  logger: pinoLogger,
  /*
   * No `genReqId` override — pino-http uses `req.id` directly (already
   * set by requestIdAndLogger above), and the serializer below pulls it
   * through to the log line.
   */
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
