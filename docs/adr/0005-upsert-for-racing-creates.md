# ADR-005 — Embedding writes use `upsert`, not `findUnique → create`

- **Status:** Accepted
- **Date:** 2026-05
- **Authors:** Jason Lin

## Context

Two embedding-write sites had a classic check-then-create race:

```ts
const existing = await prisma.embedding.findUnique({ where: { chunkId } });
if (existing) continue;
const { vector, model } = await embedText(chunk.text);
await prisma.embedding.create({ data: { chunkId, ... } });
```

Under concurrency (parallel test runs hitting the same seed video, or two
imports queued for the same chunk), a winner could land between our
`findUnique` and our `create`, and the loser would crash with a Prisma
`P2002` unique-constraint error. In `analyzeVideoJob` that crash bubbled
to the job-level catch and the whole video got marked
`analysisStatus="failed"` — the source of an intermittent test flake we
chased for several rounds.

## Decision

Switch to `prisma.embedding.upsert({ where: { chunkId }, create: {...}, update: {} })`.

The `findUnique` fast path stays (skip the `embedText` cost when an
embedding already exists). The `upsert` replaces `create` as the actual
write, so the race-winner's row is a no-op for the loser instead of a
hard crash.

## Consequences

- The job stops failing under concurrency. Test flakiness from this
  specific cause drops to zero.
- `embedText` is still called once per chunk in the loser's path (we
  compute the vector then no-op the write). That's a redundant cost but
  small (~100 ms in mock mode) and self-limiting — concurrent embedding
  jobs for the same chunk are rare in normal operation.
- The `update: {}` clause is intentionally empty: we never want to
  overwrite an existing embedding from a parallel writer (their vector
  is just as valid as ours).

## Where this applies

- `src/jobs/analyzeVideo.job.ts` — per-chunk embedding loop.
- `src/services/embedding.service.ts:generateEmbeddingsForChunks` — the
  service-layer batch caller.

## Rejected alternatives

- **Wrap the read+write in a Postgres transaction.** Solves correctness
  but introduces lock contention; embedding generation is a hot path.
- **Retry the create on `P2002`.** Catches the symptom but each retry
  pays the `embedText` cost twice. `upsert` is one atomic write
  regardless.
