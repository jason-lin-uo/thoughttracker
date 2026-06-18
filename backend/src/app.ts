import express, { type RequestHandler } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env, num } from "./config/env";
import { requestIdAndLogger, httpLogger } from "./middleware/requestId";
import { errorHandler } from "./middleware/errorHandler";
import {
  apiRateLimiter,
  expensiveRateLimiter,
  configureDemoMode,
} from "./middleware/rateLimiter";
import { requestTimeout } from "./middleware/timeout";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { requireAdmin } from "./middleware/adminPin";
import { publicReadCache } from "./middleware/publicReadCache";
import { openapiSpec } from "./openapi/spec";

import { dashboardRouter } from "./routes/dashboard.routes";
import { importJobsRouter } from "./routes/importJobs.routes";
import { creatorOnboardingRouter } from "./routes/creatorOnboarding.routes";
import { creatorsRouter } from "./routes/creators.routes";
import { videosRouter } from "./routes/videos.routes";
import { transcriptsRouter } from "./routes/transcripts.routes";
import { topicsRouter } from "./routes/topics.routes";
import { analysisRouter } from "./routes/analysis.routes";
import { evidenceRouter } from "./routes/evidence.routes";
import { chartsRouter } from "./routes/charts.routes";
import { reportsRouter } from "./routes/reports.routes";
import { searchRouter } from "./routes/search.routes";
import { embeddingsRouter } from "./routes/embeddings.routes";

/**
 * build app.
 */
export function buildApp() {
  /*
   * If DEMO_MODE is on, enable public-demo guardrails before routes mount.
   */
  configureDemoMode();

  const app = express();
  /*
   * trust proxy = 1 means Express trusts EXACTLY ONE hop of X-Forwarded-For
   * (the first proxy in front of us) when deriving req.ip — which the rate
   * limiter keys on. REQUIREMENT: this app MUST run behind exactly one trusted
   * reverse proxy / load balancer (fly.io, Render, an ALB, etc.). If it is
   * exposed directly to clients, a caller can spoof X-Forwarded-For to forge a
   * per-IP identity and bypass the rate limiter; if it sits behind TWO proxies,
   * req.ip resolves to the inner proxy and every client shares one bucket.
   * Bump this number to match the real number of trusted hops if the topology
   * changes (see fly.toml / render.yaml).
   */
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "2mb" }) as unknown as RequestHandler);
  app.use(requestIdAndLogger);
  app.use(httpLogger as unknown as RequestHandler);
  /* `num()` so an empty REQUEST_TIMEOUT_MS doesn't become 0 (instant 503s). */
  app.use(requestTimeout(num(process.env.REQUEST_TIMEOUT_MS, 15_000)));

  /*
   * OpenAPI spec + Swagger UI (before the rest of /api so /api/docs resolves
   * first). Gated behind `requireAdmin`: in production/demo the spec + Swagger
   * UI enumerate the full mutating surface (and our X-Admin-Pin scheme), so we
   * don't publish them unauthenticated. requireAdmin fails OPEN in local dev
   * (no PIN configured) so the docs stay frictionless while developing, and
   * CLOSED (403) in prod/demo unless the caller presents the admin PIN.
   */
  app.get("/api/openapi.json", requireAdmin, (_req, res) =>
    res.json(openapiSpec),
  );
  app.use(
    "/api/docs",
    requireAdmin,
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec as object, {
      customSiteTitle: "ThoughtTracker API",
    }),
  );

  /* General write-route rate limiter (skips GETs / health). */
  app.use("/api", apiRateLimiter);

  /* Stricter limits on expensive triggers. */
  app.use("/api/import-jobs/youtube-channel", expensiveRateLimiter);
  /*
   * bulk-import kicks off a whole-folder ingest + analysis pipeline, so it
   * belongs under the same expensive bucket as the other heavy triggers.
   */
  app.use("/api/import-jobs/bulk-import", expensiveRateLimiter);
  app.use("/api/creator-onboarding/run", expensiveRateLimiter);
  app.use("/api/analysis/", expensiveRateLimiter);
  app.use("/api/reports/creator", expensiveRateLimiter);
  app.use("/api/embeddings/", expensiveRateLimiter);

  /*
   * Idempotency-Key support on mutations — replays cached responses within
   * the dedup window (default 60s). Honored opt-in by callers.
   */
  app.use("/api", idempotencyMiddleware);
  app.use("/api", publicReadCache());

  app.use("/api", dashboardRouter);
  app.use("/api", importJobsRouter);
  app.use("/api", creatorOnboardingRouter);
  app.use("/api", creatorsRouter);
  app.use("/api", videosRouter);
  app.use("/api", transcriptsRouter);
  app.use("/api", topicsRouter);
  app.use("/api", analysisRouter);
  app.use("/api", evidenceRouter);
  app.use("/api", chartsRouter);
  app.use("/api", reportsRouter);
  app.use("/api", searchRouter);
  app.use("/api", embeddingsRouter);

  app.use((req, res) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: "Route not found",
      requestId: (req as { id?: string }).id,
    });
  });

  app.use(errorHandler);

  return app;
}
