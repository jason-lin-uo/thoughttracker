import { Router } from "express";
import {
  runVideoAnalysis,
  runCreatorAnalysis,
  getAnalysisRun,
  getCreatorTopicTimeline,
  getCreatorTopicAnalysis,
} from "../controllers/analysis.controller";
import { requireAdmin } from "../middleware/adminPin";

/**
 * Express router: analysis router. Mutating (re-analysis) POSTs are gated by
 * `requireAdmin` so a public demo can't be made to queue expensive work.
 * Local development can pass through when no admin PIN is configured; GETs
 * are read-only and ungated.
 */
export const analysisRouter = Router();
analysisRouter.post(
  "/analysis/videos/:videoId/run",
  requireAdmin,
  runVideoAnalysis,
);
analysisRouter.post(
  "/analysis/creators/:creatorId/run",
  requireAdmin,
  runCreatorAnalysis,
);
analysisRouter.get("/analysis-runs/:analysisRunId", getAnalysisRun);
analysisRouter.get(
  "/creators/:creatorId/topics/:topicId/timeline",
  getCreatorTopicTimeline,
);
analysisRouter.get(
  "/creators/:creatorId/topics/:topicId/analysis",
  getCreatorTopicAnalysis,
);
