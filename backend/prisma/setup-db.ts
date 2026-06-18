/* eslint-disable no-console */
/**
 * setup-db.ts — idempotent post-`db push` database setup.
 *
 * Runs the bits Prisma's schema can't express on its own, in EVERY
 * environment (local, CI, prod) so embedding maintenance has the same storage
 * shape everywhere:
 *
 * 1. `CREATE EXTENSION IF NOT EXISTS vector` — the pgvector extension that
 * backs the native `Embedding.vector` column. `prisma db push` does not
 * create extensions, so without this step the native column is absent.
 * 2. `CREATE INDEX ... USING hnsw ("vector" vector_cosine_ops)` — the
 * approximate-nearest-neighbour index retained for offline/vector maintenance
 * workflows.
 *
 * Both statements are idempotent (`IF NOT EXISTS`), so this is safe to run on
 * every deploy and in CI/seed. Uses the Prisma client's raw SQL rather than a
 * `psql` shell-out so it runs unchanged inside the `node:20-alpine` production
 * image, which ships no Postgres client binaries.
 *
 * Invoked via `npm run db:setup` (see package.json) and from the seed.
 */
import { PrismaClient } from "@prisma/client";

const HNSW_INDEX_NAME = "embedding_vector_hnsw_idx";

/**
 * ensureVectorExtensionAndIndex — create the pgvector extension and the HNSW
 * index on `Embedding.vector` if they don't already exist.
 *
 * Returns a small result object describing what was found/created so callers
 * (the seed, tests, the CLI entrypoint) can log or assert on it. Throwing is
 * intentional on the extension step: a deploy that can't install pgvector
 * should fail loudly rather than ship a DB whose ANN index silently never
 * exists. The index step tolerates the "column not present yet" case so a base
 * Postgres without the Unsupported column doesn't hard-fail local dev.
 */
export async function ensureVectorExtensionAndIndex(
  prisma: Pick<PrismaClient, "$executeRawUnsafe" | "$queryRawUnsafe">,
): Promise<{ extensionReady: boolean; indexReady: boolean }> {
  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");

  /*
   * The native column only exists once `prisma db push` has applied the
   * Unsupported("vector(64)") field. Guard the index creation on the column
   * being present so a partial setup doesn't throw.
   */
  const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
 WHERE table_name = 'Embedding' AND column_name = 'vector'`,
  );
  if (columns.length === 0) {
    return { extensionReady: true, indexReady: false };
  }

  /*
   * HNSW index for cosine distance. IF NOT EXISTS keeps this idempotent.
   */
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "${HNSW_INDEX_NAME}"
 ON "Embedding" USING hnsw ("vector" vector_cosine_ops)`,
  );
  return { extensionReady: true, indexReady: true };
}

/**
 * hnswIndexExists — true when the HNSW index on `Embedding.vector` is present.
 * Used by behavioral tests to assert the "HNSW-indexed ANN" claim holds.
 */
export async function hnswIndexExists(
  prisma: Pick<PrismaClient, "$queryRawUnsafe">,
): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
 WHERE tablename = 'Embedding' AND indexname = '${HNSW_INDEX_NAME}'`,
  );
  return rows.length > 0;
}

/**
 * main — CLI entrypoint for `npm run db:setup`. Connects, ensures the
 * extension + index, logs the outcome, and disconnects. Exits non-zero on
 * failure so a deploy release command surfaces the error.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await ensureVectorExtensionAndIndex(prisma);
    if (result.indexReady) {
      console.log("✔ pgvector extension + HNSW index ready");
    } else {
      console.log(
        "✔ pgvector extension ready; HNSW index skipped (native vector column not present yet)",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

/* Only run the CLI when invoked directly (not when imported by the seed/tests). */
if (
  process.argv[1] &&
  (process.argv[1].endsWith("setup-db.ts") ||
    process.argv[1].endsWith("setup-db.js"))
) {
  main().catch((err) => {
    console.error("db:setup failed:", err);
    process.exit(1);
  });
}
