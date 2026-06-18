# ADR-001 - Embeddings Storage: JSON Fallback With Optional pgvector

- **Status:** Superseded by [ADR-0011](0011-768d-embeddings-and-ml-provider.md)
- **Date:** 2026-05
- **Authors:** Jason Lin

## Superseded Note

This ADR preserves the original decision: store embeddings in a JSON fallback
column and optionally use pgvector when available. The current product has since
changed two important details:

- embedding dimension moved from 64 to 768
- native pgvector storage is the intended product path

ADR-0011 describes the current 768-dimensional local-ML embedding provider.

## Context

ThoughtTracker originally needed semantic search over transcript chunks. That
public UI surface has since been removed, but the embedding storage decision is
still useful context for owner workflows, future search experiments, and the
database's ability to preserve vector-backed evidence features. The earliest
implementation stored vectors as JSON arrays and ranked them in application
code. That was easy to run anywhere, but it was O(N) per query and could not use
a database index.

The natural database-backed option is pgvector with an approximate
nearest-neighbor index.

## Decision

Keep a JSON fallback path so the app can still run in constrained environments,
but prefer pgvector when the extension is available.

The original version used:

- `vectorJson`: portable JSON fallback
- `vector(768)`: optional native pgvector column

The current version uses the same architectural idea with 768-dimensional
vectors and a stronger preference for native pgvector storage.

## Consequences

- pgvector gives fast vector lookup when installed.
- JSON fallback keeps development/debugging paths resilient.
- Vector dimension changes require coordinated schema and corpus updates.

## Alternatives Considered

- **pgvector only.** Rejected at the time because it increased setup friction.
- **External vector database.** Rejected because it added credentials and an
  extra service to a portfolio-scale app.
- **Keyword search only.** Rejected because the product is explicitly about
  meaning-based transcript exploration.
