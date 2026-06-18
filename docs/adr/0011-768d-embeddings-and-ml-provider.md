# ADR-011 - 768-Dimensional Embeddings And The Local ML Provider

- **Status:** Accepted
- **Date:** 2026-06
- **Authors:** Jason Lin
- **Supersedes:** [ADR-0001](0001-embeddings-storage.md)

## Current-State Note

The current owner refresh/reanalysis path uses:

```env
EMBEDDING_PROVIDER=ml
ML_CLASSIFIER_URL=http://localhost:8000
```

The database snapshot is expected to contain vectors compatible with this
pipeline. Deterministic vectors may still exist inside tests or fallback paths,
but they are not the intended product data path. The dedicated semantic-search
page was later removed from the public UI because the portfolio product is
stronger as a curated evidence/reporting experience.

## Context

The early product proved the semantic-search UI with small deterministic
vectors. That was useful for scaffolding, but it was not good enough for a final
portfolio baseline because deterministic hash vectors do not understand meaning.
Synonyms and related phrasing can map far apart.

The companion `thoughttracker-ml` service already exposes local transformer
models over HTTP. Reusing that service for embeddings gives the app real
meaning-based retrieval without an OpenAI key.

DistilBERT-style hidden states are 768-dimensional, which forced a coordinated
change across:

- `EMBEDDING_DIM`
- Prisma pgvector column type
- embedding generation
- vector generation and storage
- database snapshot contents

## Decision

Use 768-dimensional embeddings for the product baseline.

The backend can request embeddings from:

- `ml`: local `thoughttracker-ml` service, preferred for the portfolio product
- `openai`: hosted provider for private owner use
- deterministic test/fallback paths where explicitly configured

The intended product path is `ml`.

When pgvector is available, store and query the native `vector(768)` column. The
JSON vector path remains a resilience fallback, not the preferred production
path.

## Consequences

- Stored vectors become transformer-based rather than hash-based.
- Reviewers do not need an OpenAI key for embeddings.
- Provider and vector dimensions must stay aligned. If the embedding model
  dimension changes, the vector column and corpus embeddings must be rebuilt.
- The database dump should be treated as a coherent snapshot: schema, vectors,
  model artifacts, and provider configuration need to agree.

## Alternatives Considered

- **Keep the old 64-dimensional vectors.** Rejected because search quality was
  too limited.
- **Use OpenAI embeddings by default.** Rejected for recruiter-facing setup
  because it creates cost and quota friction.
- **Require pgvector with no fallback.** Rejected because fallback behavior is
  still useful for debugging and graceful degradation, even though pgvector is
  the target path.
