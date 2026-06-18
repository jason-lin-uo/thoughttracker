import { Router } from "express";
import { regenerateCreatorEmbeddings } from "../controllers/embeddings.controller";
import { requireAdmin } from "../middleware/adminPin";

/**
 * Express router: embeddings router. Regenerating a creator's embeddings is an
 * expensive mutation, so it's admin-gated by `requireAdmin`. Local development
 * can pass through when no admin PIN is configured.
 */
export const embeddingsRouter = Router();
embeddingsRouter.post(
  "/embeddings/creator/:creatorId/generate",
  requireAdmin,
  regenerateCreatorEmbeddings,
);
