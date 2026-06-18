import { Router } from "express";
import { listTopics, createTopic } from "../controllers/topics.controller";
import { requireAdmin } from "../middleware/adminPin";

/**
 * Express router: topics router. Creating a topic (taxonomy upsert) is a
 * mutation, so it's admin-gated by `requireAdmin`. Local development can pass
 * through when no admin PIN is configured; topic list GET is read-only and
 * ungated.
 */
export const topicsRouter = Router();
topicsRouter.get("/topics", listTopics);
topicsRouter.post("/topics", requireAdmin, createTopic);
