# \_LEARN.md - `backend/src/config/`

> Runtime configuration and the Prisma database client. This folder is the
> backend's foundation: almost everything imports it, while it imports almost
> nothing from the rest of the app.

## `env.ts`

`env.ts` reads environment variables once into a typed object for common
settings, while validation still checks `process.env` at boot so local/test
overrides are respected.

Important provider settings:

- `AI_PROVIDER=local|openai|anthropic`
- `EMBEDDING_PROVIDER=ml|openai`
- `YOUTUBE_PROVIDER=youtube`
- `STANCE_ANALYSIS_PROVIDER=llm|custom_ml|hybrid`
- `TOPIC_ASSIGNMENT_PROVIDER=final_policy|curated_reranker|custom_ml_reranker|default`

There is no runtime fake-provider mode. If a provider enum is misspelled, the
backend fails loudly during `validateEnv()` instead of silently degrading.

Important local services:

- `LOCAL_LLM_BASE_URL` defaults to Ollama at `http://localhost:11434`.
- `ML_CLASSIFIER_URL` defaults to the sibling ML service at
  `http://localhost:8000`.
- `TOPIC_SELECTION_POLICY_PATH` can override the auto-discovered gold-standard
  topic-selection artifact.

Important owner/admin settings:

- `ADMIN_PIN` gates mutating owner-only actions.
- `DEMO_MODE=true` tightens public-demo guardrails and rate limits. It does not
  switch the product away from the real corpus.

## `prisma.ts`

`prisma.ts` exports the singleton Prisma client. The singleton avoids opening
new connection pools throughout the backend and survives dev-mode hot reloads
through the `globalThis.__prismaExtended` guard.

The Prisma client is extended with a narrow retry layer for transient errors:

- `P1001`: temporary database connectivity failure.
- `"Inconsistent query result"`: a relation changed mid-read.
- `P2002`: unique-constraint race during an idempotent upsert.

The retry layer keeps brief database flakes from breaking unrelated requests
while still surfacing real logic errors.

## Debug Map

| Symptom                      | Start Here                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Backend refuses to start     | `env.ts:validateEnv()` and the printed env error                                             |
| Provider typo or wrong model | `AI_PROVIDER`, `EMBEDDING_PROVIDER`, `STANCE_ANALYSIS_PROVIDER`, `TOPIC_ASSIGNMENT_PROVIDER` |
| Local AI not reachable       | `LOCAL_LLM_BASE_URL` and Ollama status                                                       |
| ML service not reachable     | `ML_CLASSIFIER_URL` and the sibling `thoughttracker-ml` server                               |
| Database connection limit    | `DATABASE_URL` pool settings and `prisma.ts` singleton behavior                              |
| Intermittent Prisma errors   | `isTransientPrismaError()` and the `$extends` retry wrapper                                  |
