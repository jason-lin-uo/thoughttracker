import { Router } from "express";
import {
  listReports,
  getReport,
  bulkDeleteReports,
  resetReportsToStarterController,
  generateCreatorReportController,
  generateCreatorTopicReportController,
} from "../controllers/reports.controller";
import { requireAdmin } from "../middleware/adminPin";

/**
 * Express router: reports router. Report generation + deletion (mutations) are
 * admin-gated by `requireAdmin`. Local development can pass through when no
 * admin PIN is configured; list/detail GETs are read-only and ungated.
 *
 * NOTE: `/reports/bulk-delete` is registered before the `/reports/:reportId`
 * GET so the literal path can't be shadowed by the param route (they're
 * different methods, but keeping the literal first is the defensive habit).
 */
export const reportsRouter = Router();
reportsRouter.get("/reports", listReports);
reportsRouter.post("/reports/bulk-delete", requireAdmin, bulkDeleteReports);
reportsRouter.post(
  "/reports/reset-starter",
  requireAdmin,
  resetReportsToStarterController,
);
reportsRouter.get("/reports/:reportId", getReport);
reportsRouter.post(
  "/reports/creator/:creatorId/generate",
  requireAdmin,
  generateCreatorReportController,
);
reportsRouter.post(
  "/reports/creator/:creatorId/topic/:topicId/generate",
  requireAdmin,
  generateCreatorTopicReportController,
);
