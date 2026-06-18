# ADR-006 - Semantic search: two-step query for orphan tolerance

- **Status:** Superseded for the public product UI
- **Date:** 2026-05
- **Authors:** Jason Lin

## Superseded Note

This ADR records a real engineering fix from the earlier semantic-search
surface. The public product later removed semantic search from the navigation
and header because the feature was not accurate enough for the portfolio
experience. The database can still store embeddings for owner workflows and
future search work, but the recruiter-facing app no longer depends on this
semantic-search route.

## Context

`semanticSearch.service.ts:searchWithJsonCosine` originally used a single
Prisma query:

```ts
const embeddings = await prisma.embedding.findMany({
  where: { chunk: where },
  include: { chunk: { include: { video: { include: { creator: true } } } } },
});
```

Under READ COMMITTED isolation (Postgres default), this could throw
`"Inconsistent query result: Field chunk is required to return data,
got null"` when another transaction deleted a related row between the
embedding read and the included chunk's row read. The `chunk` relation
on `Embedding` is typed as required (non-nullable) in the Prisma schema,
so Prisma can't honor the type contract when a join returns null.

Prisma 5 doesn't allow marking included relations as optional per-query,
so the only escapes are: (a) change the schema, (b) catch + retry, or
(c) restructure the query so an orphan can't surface.

## Decision

**Drive the read from the chunk side.** Two queries instead of one:

```ts
// 1. Get matching chunks (with their video/creator hydrated).
const chunks = await prisma.transcriptChunk.findMany({
 where: where as Prisma.TranscriptChunkWhereInput,
 select: { id, chunkIndex, text, ..., video: { select: { ..., creator: { select: { name } } } } },
});

// 2. Get embeddings for those chunks (by chunkId IN [...]).
const embeddings = await prisma.embedding.findMany({
 where: { chunkId: { in: chunkIds } },
 select: { chunkId: true, vectorJson: true },
});
```

Missing chunks simply don't appear in step 1, so step 2 never tries to
include a row that's gone. The chunk-side query is also where we want
to filter anyway (most filters are on chunk fields, not embedding fields).

## Consequences

- Orphan tolerance is free: a transient orphan Embedding can't crash
  this code path even under READ COMMITTED.
- One extra query per semantic search, but both queries are
  index-friendly and the total round-trip stays under 50 ms even on
  the full seed corpus.
- The result is built via `chunks.flatMap()` with a lookup `Map<chunkId,
vectorJson>` so the join cost is O(1) per chunk in JS.

## Rejected alternatives

- **Schema change to make `Embedding.chunk` optional.** Would propagate
  through every consumer that currently trusts the relation.
- **Catch + retry the read-side error.** Already in place via the
  Prisma retry middleware (see ADR-007), but it is a fallback; the primary
  read should not depend on retry semantics.
