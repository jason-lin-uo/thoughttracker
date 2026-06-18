# ADR-007 — Prisma transient-error retry via Client Extensions

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Context

Prisma operations occasionally fail with transient errors that a single
retry would resolve cleanly:

1. `P1001` / `"Can't reach database server"` — TCP/socket hiccups
   against Postgres, especially under high-concurrency test runs.
2. `"Inconsistent query result: Field X is required to return data,
got null"` — another transaction deleted a related row mid-snapshot
   under READ COMMITTED isolation.
3. `P2002` (unique constraint failed) — race-winner already wrote;
   when paired with our `upsert`-style writes (see ADR-005), this is
   safely re-run.

These intermittent throws bubbled up through service code into
controllers and surfaced as 500s or as test flakes.

## Decision

Wrap the Prisma client in a thin retry layer. Originally implemented
via `client.$use(...)`; migrated to **Prisma Client Extensions**
(`$extends({ query: { $allOperations } })`) since `$use` is deprecated
in Prisma 5+.

```ts
return base.$extends({
  query: {
    $allOperations: async ({ args, query }) => {
      try {
        return await query(args);
      } catch (err) {
        if (!isTransientPrismaError(err)) throw err;
        await sleep(50);
        return query(args);
      }
    },
  },
});
```

The predicate `isTransientPrismaError(err)` is exported as a free
function so tests can exercise it against synthetic errors without
needing engine-level mocking.

## Consequences

- Transient errors are absorbed transparently — the rest of the
  codebase reads as if Prisma never hiccups.
- One retry only, with a 50 ms backoff. Real failures still fail; we
  don't mask actual bugs.
- The retry path itself is `c8 ignore`-d because forcing the engine
  to throw a transient from inside the extension callback would
  require deep engine mocking. The predicate (the part with real
  logic) IS unit-tested.

## Rejected alternatives

- **Catch transients inside every service function.** Would scatter
  retry logic across the codebase and inevitably drift.
- **Bumping Postgres isolation to SERIALIZABLE.** Would close the
  `"Inconsistent query result"` window but at the cost of serialization
  failures elsewhere — net flakiness might not decrease.
