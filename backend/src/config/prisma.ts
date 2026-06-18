import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Decide whether an error thrown by a Prisma operation is a transient
 * class worth one retry. Exported separately so the retry middleware
 * AND tests can exercise the predicate against fake errors without
 * needing a real failing engine.
 *
 * Transient classes:
 * 1. "Can't reach database server" / `P1001` — TCP/socket hiccups.
 * 2. "Inconsistent query result: Field X is required to return
 * data, got null" — another transaction deleted a related row
 * mid-snapshot under READ COMMITTED isolation.
 *
 * NOT retried: `P2002` (unique constraint failed). A unique violation is a
 * legitimate, deterministic conflict — retrying it just fails again. The
 * idempotent write paths (analyzeVideo / embedding) now use `upsert` on the
 * relevant unique keys, so they never surface P2002 to this layer in the first
 * place; treating it as transient only burdened genuine conflicts with a
 * pointless retry.
 */
export function isTransientPrismaError(err: unknown): boolean {
  const code =
    err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined;
  const msg = (err as Error)?.message ?? "";
  return (
    code === "P1001" ||
    msg.includes("Can't reach database server") ||
    msg.includes("Inconsistent query result")
  );
}

/**
 * retryBackoffMs — the delay before the single transient-error retry.
 *
 * A ~50ms base with ±50% jitter (so 50–75ms here). The jitter matters under
 * concurrency: when a connection blip trips MANY in-flight queries at once, a
 * FIXED 50ms backoff makes them all wake and re-hit the database in the same
 * instant (a thundering herd that can re-trip the very condition we're
 * recovering from). Spreading the retries across a window de-synchronizes
 * them. Exported so a test can assert the bound without timing flakiness.
 */
export function retryBackoffMs(base = 50): number {
  /* base + [0, base/2) → 50–75ms for the default base. */
  return base + Math.random() * (base / 2);
}

/**
 * Wraps the Prisma client in a thin retry layer for transient connection
 * errors. Postgres occasionally drops a connection under load (we see
 * it intermittently during the test suite's high-concurrency batches);
 * a single retry after a short jittered backoff resolves the vast majority
 * without changing semantics for real failures.
 */
function buildPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  /*
   * `$use` is deprecated in Prisma 5; the supported way to wrap every
   * operation is Client Extensions. `$allOperations` runs for every
   * model query (the same surface `$use` covered).
   */
  return base.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        try {
          return await query(args);
        } catch (err) {
          if (!isTransientPrismaError(err)) throw err;
          /* c8 ignore start */
          /*
           * Retry path: only fires on real engine-side transient
           * throws. The predicate above is unit-tested; forcing the
           * engine to throw from inside an extension test would
           * require deep engine mocking. Jittered backoff (see
           * retryBackoffMs) so a connection blip that trips many
           * concurrent queries doesn't retry them all in lockstep.
           */
          await new Promise((resolve) => setTimeout(resolve, retryBackoffMs()));
          return query(args);
          /* c8 ignore stop */
        }
      },
    },
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __prismaExtended: ReturnType<typeof buildPrismaClient> | undefined;
}

export const prisma = global.__prismaExtended ?? buildPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prismaExtended = prisma;
}
