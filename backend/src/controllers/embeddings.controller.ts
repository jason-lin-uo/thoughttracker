import type { Request, Response, NextFunction } from "express";
import { jobRunner } from "../jobs/jobRunner";
import { generateEmbeddingsForCreatorJob } from "../jobs/generateEmbeddings.job";
/**
 * POST /api/embeddings/creator/:creatorId/generate  -  kicks off a background
 * job that embeds every chunk in every transcript owned by the creator.
 *
 * Returns immediately with 202 + `{ status: "queued" }`  -  the actual
 * work happens in `generateEmbeddingsForCreatorJob`. Idempotent at the
 * chunk level: chunks already embedded are skipped, so re-running this
 * endpoint on an already-embedded creator is cheap.
 *
 * With `EMBEDDING_PROVIDER=ml` this calls the local ML service's `/embed`
 * endpoint; with `EMBEDDING_PROVIDER=openai` it calls OpenAI's embeddings API.
 * Embeddings do NOT draw on the LLM budget/cache; that accounting only covers
 * the chat-completion (`runLlm`) path.
 */
export async function regenerateCreatorEmbeddings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { creatorId } = req.params;
    jobRunner.enqueue(`embeddings:${creatorId}`, async () => {
      await generateEmbeddingsForCreatorJob(creatorId);
    });
    res.status(202).json({ status: "queued" });
  } catch (err) {
    next(err);
  }
}
