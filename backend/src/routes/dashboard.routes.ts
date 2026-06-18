import { Router } from "express";
import { getDashboard, getSystemStatus } from "../controllers/dashboard.controller";

/**
 * Express router: dashboard router.
 */
export const dashboardRouter = Router();
dashboardRouter.get("/dashboard", getDashboard);
dashboardRouter.get("/system/status", getSystemStatus);
dashboardRouter.get("/health", (_req, res) => res.json({ ok: true }));
