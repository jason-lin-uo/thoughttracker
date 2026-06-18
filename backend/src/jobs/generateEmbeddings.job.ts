import { generateEmbeddingsForCreator } from "../services/embedding.service";

/**
 * Background job wrapper that generates embeddings for all of a creator's
 * transcript chunks. Thin delegate to generateEmbeddingsForCreator so the
 * work can be dispatched through the job runner; returns the count
 * generated.
 */
export async function generateEmbeddingsForCreatorJob(
  creatorId: string,
): Promise<{ generated: number }> {
  return generateEmbeddingsForCreator(creatorId);
}
