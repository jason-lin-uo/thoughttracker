/**
 * globalSetup.ts — runs once before the entire backend test suite starts.
 *
 * Responsibilities, in order:
 *
 * 1. SAFETY GUARD (fail-fast) — refuse to run against a database that is
 * not a dedicated *_test database. The suite creates/deletes fixtures
 * and exercises seed/reset-style helpers, so running it against a real
 * or dev database silently destroys data. We require the DATABASE_URL
 * database name to end in `_test`, UNLESS we're in CI (an ephemeral,
 * disposable Postgres service container) or an explicit
 * `ALLOW_DESTRUCTIVE_DB_TESTS=1` override is set. This guard exists
 * because a plain `npm run test` (with .env pointing at the dev DB)
 * once clobbered real ingested data — fail loudly instead.
 *
 * 2. Ensure the pgvector extension + HNSW index exist, so the
 * "HNSW cosine ANN index exists" audit test (audit-hardening.test.ts)
 * is self-contained on a freshly `db push`-ed test database rather than
 * depending on a separate `db:setup`/seed having been run first.
 *
 * 3. Delete orphan rows that previous sessions might've left behind (e.g.
 * an Embedding whose TranscriptChunk was deleted). Prisma 5+ throws
 * "Inconsistent query result: Field chunk is required..." on joined
 * reads when an orphan exists, which manifests as a flaky failure in
 * tests/semantic-json-fallback.test.ts. We delete via raw SQL because
 * Prisma can't query the orphans through its typed API (the join
 * itself is what fails).
 */
import { PrismaClient } from "@prisma/client";
import { ensureVectorExtensionAndIndex } from "../prisma/setup-db";

/**
 * Extract the database name from a Postgres connection URL — the path
 * segment after the authority and before the query string. Returns "" when
 * it can't be parsed (which the guard treats as "not a test DB").
 *
 * e.g. `postgresql://user:pass@host:5432/thoughttracker_test?schema=public`
 * → `thoughttracker_test`
 */
function databaseName(url: string): string {
  /*
   * Strip the `scheme://authority` prefix (authority has no `/`), leaving
   * `/<db>?<params>`, then capture the db segment up to `/` or `?`.
   */
  const afterAuthority = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const match = /\/([^/?]+)(?:\?|$)/.exec(afterAuthority);
  return match ? match[1] : "";
}

/*
 * Vitest global setup: guards the target DB, ensures pgvector/HNSW, then
 * deletes orphan rows — all before any test worker runs.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL ?? "";
  const db = databaseName(url);
  const isCI = process.env.CI === "true" || process.env.CI === "1";
  const allowOverride = process.env.ALLOW_DESTRUCTIVE_DB_TESTS === "1";

  if (!isCI && !allowOverride && !/_test$/.test(db)) {
    throw new Error(
      `Refusing to run the backend test suite against database "${db || "(unparsed)"}": ` +
        `it is not a dedicated *_test database. The suite resets/seeds tables and would ` +
        `DESTROY data in a real/dev database. Point DATABASE_URL at a *_test database ` +
        `(e.g. .../${db || "thoughttracker"}_test), or set ALLOW_DESTRUCTIVE_DB_TESTS=1 ` +
        `(or CI=1) to explicitly override.`,
    );
  }

  const prisma = new PrismaClient();
  try {
    /*
     * Make the native vector column's HNSW index present so the ANN-index
     * audit assertion holds on a fresh test DB (idempotent — safe to repeat).
     */
    await ensureVectorExtensionAndIndex(prisma);

    /* Embeddings whose chunk row no longer exists. */
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Embedding" WHERE "chunkId" NOT IN (SELECT id FROM "TranscriptChunk")`,
    );
    /* (Future-proofing) ChunkTopicAnalysis rows referencing missing chunks. */
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ChunkTopicAnalysis" WHERE "chunkId" NOT IN (SELECT id FROM "TranscriptChunk")`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
