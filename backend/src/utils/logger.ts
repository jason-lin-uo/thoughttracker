/**
 * Structured logger built on Pino.
 *
 * In dev: pretty-printed for humans.
 * In prod: newline-delimited JSON suitable for log aggregators.
 *
 * Request correlation: middleware/requestId.ts attaches a request id to
 * `req.id`. Calls inside a request handler should use `req.log` instead of
 * this module-level logger so the correlation id is automatic.
 */

import pino, { type Logger } from "pino";

const isProd = process.env.NODE_ENV === "production";

export const pinoLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  base: { service: "thoughttracker-backend" },
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    /*
     * Paths use pino's redact syntax (dot-paths with `*` wildcards).
     * Goal: never let a secret or PII fragment leak into log lines or
     * log aggregators downstream.
     */
    paths: [
      /* Request headers that carry credentials. */
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-api-key']",
      "req.headers['x-auth-token']",
      /*
       * The admin onboarding PIN is a credential — never log it (it gates
       * every mutating route via requireAdmin / requireCreatorOnboardingPin).
       */
      "req.headers['x-admin-pin']",
      /* Request body fields that commonly carry secrets/PII. */
      "req.body.password",
      "req.body.token",
      "req.body.apiKey",
      "req.body.secret",
      "req.body.email",
      /*
       * Generic wildcards for nested objects (keep the catch-all set
       * we had before).
       */
      "*.password",
      "*.apiKey",
      "*.token",
      "*.secret",
      "*.authorization",
    ],
    censor: "[REDACTED]",
  },
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service",
        },
      },
});

/** Back-compat shim: same API as the previous console-based logger. */
export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    if (meta) pinoLogger.info(meta, message);
    else pinoLogger.info(message);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (meta) pinoLogger.warn(meta, message);
    else pinoLogger.warn(message);
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (meta) pinoLogger.error(meta, message);
    else pinoLogger.error(message);
  },
  debug(message: string, meta?: Record<string, unknown>) {
    if (meta) pinoLogger.debug(meta, message);
    else pinoLogger.debug(message);
  },
};
