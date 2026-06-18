import { buildApp } from "./app";
import { env, validateEnv } from "./config/env";
import { logger } from "./utils/logger";
import { prisma } from "./config/prisma";
import { jobRunner } from "./jobs/jobRunner";

/** Max time to wait for in-flight background jobs to finish during shutdown. */
const JOB_DRAIN_TIMEOUT_MS = 10_000;

/*
 * Fail fast on a misconfigured environment before binding the port, so an
 * operator gets one clear error at boot instead of an opaque Prisma/CORS
 * failure on the first request.
 */
validateEnv();

const app = buildApp();

/*
 * Start the HTTP server and log the real provider wiring that will be used by
 * runtime report generation, embeddings, YouTube import, and stance analysis.
 */
const server = app.listen(env.port, () => {
  logger.info(
    `ThoughtTracker backend listening on http://localhost:${env.port}`,
    {
      aiProvider: env.aiProvider,
      embeddingProvider: env.embeddingProvider,
      youtubeProvider: env.youtubeProvider,
      stanceProvider: process.env.STANCE_ANALYSIS_PROVIDER ?? "custom_ml",
    },
  );
});

let shuttingDown = false;

/**
 * Graceful shutdown handler invoked on SIGTERM/SIGINT/uncaughtException.
 *
 * The guard makes shutdown idempotent. We stop accepting connections, let
 * in-flight jobs finish their database writes, disconnect Prisma, and then exit.
 */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down`);

  const forceExit = setTimeout(() => {
    logger.error("Force-exiting after 20s drain timeout");
    process.exit(1);
  }, 20_000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) logger.error("Error during server.close", { err: err.message });
    try {
      await Promise.race([
        jobRunner.drain(),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, JOB_DRAIN_TIMEOUT_MS);
          t.unref();
        }),
      ]);
    } catch (e) {
      logger.warn("job drain failed", { error: (e as Error).message });
    }
    try {
      await prisma.$disconnect();
    } catch (e) {
      logger.warn("prisma disconnect failed", { error: (e as Error).message });
    }
    process.exit(err ? 1 : 0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error("uncaughtException", { error: err.message, stack: err.stack });
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", { reason: String(reason) });
  void shutdown("unhandledRejection");
});
