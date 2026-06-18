# \_LEARN.md - backend/prisma

This folder defines and prepares the PostgreSQL database.

## Files

| File            | Purpose                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `schema.prisma` | Single source of truth for tables, enums, relations, indexes, and vector fields.                                            |
| `setup-db.ts`   | Creates pgvector extension and indexes that Prisma cannot express directly.                                                 |
| `seed.ts`       | Guarded development/test fixture loader. It deletes and repopulates tables and should not be used as the product data path. |

## Product Data Path

The portfolio product uses:

```text
thoughttracker_full.dump
```

Restore that dump into Postgres to get the real five-creator corpus, transcripts,
chunks, topic/stance analysis, reports, and embeddings.

`db:seed` remains useful for tests and local fixture experiments, but it is not
the real product dataset.

## Schema Highlights

Evidence chain:

```text
Creator -> SourceChannel -> Video -> Transcript -> TranscriptChunk
 -> ChunkTopicAnalysis -> VideoTopicSummary
 -> CreatorTopicTimeline -> Report
```

Other key models:

- `Topic`
- `Embedding`
- `AnalysisRun`
- `ImportJob`
- `ImportJobItem`

`Embedding.vector` is a native `vector(768)` pgvector column. `vectorJson` is a
fallback storage column for environments where native pgvector writes are not
available. The intended product path is pgvector.

## Commands

```bash
npm run db:push --workspace backend
npm run db:setup --workspace backend
```

Restore product data:

```bash
pg_restore --no-owner --clean --if-exists \
 -d "postgresql://postgres:postgres@localhost:5432/thoughttracker" \
 thoughttracker_full.dump
```

## Safety Notes

- `seed.ts` refuses to run against unsafe database names unless explicitly
  overridden.
- `setup-db.ts` is idempotent.
- There is no committed Prisma migrations directory; the project uses
  `prisma db push` for this portfolio workflow.
