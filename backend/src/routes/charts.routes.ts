import { Router } from "express";
import { stanceOverTime, topicFrequency } from "../controllers/charts.controller";

/**
 * Express router: charts router.
 */
export const chartsRouter = Router();
chartsRouter.get("/charts/stance-over-time", stanceOverTime);
chartsRouter.get("/charts/topic-frequency", topicFrequency);
