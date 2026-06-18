import { prisma } from "../config/prisma";
import { embedText } from "../ai/embeddingClient";
import { logger } from "../utils/logger";

let pgvectorAvailableCache: boolean | null = null;

/**
 * Test-only: clear the memoized pgvector-availability result so the next
 * `pgvectorAvailable()` call re-probes. Exported so unit tests can drive
 * both the "detected" and "not detected" / "probe failed" branches in a
 * single process; production code never calls this.
 */
export function __resetPgvectorCacheForTests(): void {
  pgvectorAvailableCache = null;
}

/**
 * Returns true once we've verified the `vector` extension is installed in
 * the connected database. Result is memoized across the process lifetime.
 */
export async function pgvectorAvailable(): Promise<boolean> {
  if (pgvectorAvailableCache !== null) return pgvectorAvailableCache;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    pgvectorAvailableCache = rows.length > 0;
  } catch (err) {
    logger.warn("Could not probe pg_extension; assuming pgvector unavailable", {
      error: (err as Error).message,
    });
    pgvectorAvailableCache = false;
  }
  if (pgvectorAvailableCache) {
    logger.info("pgvector detected for embedding maintenance writes");
  } else {
    logger.info("pgvector not detected; storing embedding JSON only");
  }
  return pgvectorAvailableCache;
}

/** Postgres vector literal: '[0.1,0.2,…]' */
function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * generateEmbeddingsForChunks — embed an array of chunk ids with the
 * configured embedding provider and persist the resulting vectors to
 * the `embedding` column.
 *
 * Idempotent: skips chunks that already have an embedding (or no longer
 * exist); returns counts of `{ generated, skipped }` for caller bookkeeping.
 *
 * Two batch reads up front (existing embeddings + chunk texts) collapse the
 * former per-chunk findUnique×2 N+1 into a fixed 2 queries; only the embed
 * + write happens per chunk (the embed call is the unavoidable serial step).
 */
export async function generateEmbeddingsForChunks(chunkIds: string[]) {
  let generated = 0;
  let skipped = 0;
  if (chunkIds.length === 0) return { generated, skipped };
  const useNative = await pgvectorAvailable();

  /*
   * Batch-fetch which chunks already have an embedding and the chunk texts in
   * one round-trip each, instead of two findUnique calls per chunk.
   */
  const [existingRows, chunkRows] = await Promise.all([
    prisma.embedding.findMany({
      where: { chunkId: { in: chunkIds } },
      select: { chunkId: true },
    }),
    prisma.transcriptChunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, text: true },
    }),
  ]);
  /* Set of chunkIds that already have an embedding, for O(1) skip checks. */
  const alreadyEmbedded = new Set(existingRows.map((e) => e.chunkId));
  /* chunkId -> text lookup so the loop below avoids a per-chunk DB read. */
  const textByChunkId = new Map(chunkRows.map((c) => [c.id, c.text]));

  for (const chunkId of chunkIds) {
    if (alreadyEmbedded.has(chunkId)) {
      skipped += 1;
      continue;
    }
    const text = textByChunkId.get(chunkId);
    if (text === undefined) {
      /* Chunk no longer exists (deleted between the batch read and now). */
      skipped += 1;
      continue;
    }
    const { vector, model } = await embedText(text);

    /*
     * `upsert` (not `create`) so a concurrent writer that landed an
     * Embedding row for the same `chunkId` between our batch read and
     * this write doesn't crash with a unique-constraint error. See
     * analyzeVideo.job.ts for the matching note.
     */
    const created = await prisma.embedding.upsert({
      where: { chunkId },
      create: {
        chunkId,
        embeddingModel: model,
        /*
         * Always create the JSON copy first. Prisma's JSON create input is
         * intentionally strict about null/undefined, and this also gives us a
         * safe fallback if the native pgvector write below fails.
         */
        vectorJson: vector,
      },
      update: {},
    });

    if (useNative) {
      try {
        await prisma.$executeRawUnsafe(
          'UPDATE "Embedding" SET vector = $1::vector WHERE id = $2',
          vectorLiteral(vector),
          created.id,
        );
        await prisma.$executeRawUnsafe(
          'UPDATE "Embedding" SET "vectorJson" = NULL WHERE id = $1',
          created.id,
        );
      } catch (err) {
        /* Native write failed despite pgvector being available — fall back to
 storing the JSON copy so the chunk stays searchable via JS cosine. */
        logger.warn("pgvector dual-write failed; storing JSON fallback", {
          error: (err as Error).message,
          chunkId,
        });
        await prisma.embedding.update({
          where: { id: created.id },
          data: { vectorJson: vector },
        });
      }
    }

    generated += 1;
  }
  return { generated, skipped };
}

/**
 * generateEmbeddingsForCreator — convenience wrapper that finds every
 * chunk under the given creator and delegates to
 * `generateEmbeddingsForChunks`. Used by the
 * POST /embeddings/creator/:id/run endpoint.
 */
export async function generateEmbeddingsForCreator(creatorId: string) {
  const chunks = await prisma.transcriptChunk.findMany({
    where: { video: { creatorId } },
    select: { id: true },
  });
  return generateEmbeddingsForChunks(chunks.map((c) => c.id));
}
