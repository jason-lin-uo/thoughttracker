# ThoughtTracker Architecture

Author: Jason Lin

This document explains how the current ThoughtTracker product is wired. It is
written for a technical reviewer who wants to understand the real system, not an
old scaffold. Historical decisions remain in `docs/adr/`, but this file is the
active architecture map for the portfolio baseline.

The current baseline is:

- real five-creator transcript corpus
- PostgreSQL snapshot restored from `thoughttracker_full.dump`
- local Ollama report generation by default
- `thoughttracker-ml` as the offline creator-ingestion, training, and snapshot
  refresh pipeline
- owner-only Add Creators onboarding guarded by `ADMIN_ONBOARDING_PIN`
- test doubles allowed in tests only

---

## 1. System Shape

```text
Browser
  |
  | Vite/React UI
  v
frontend/
  - dashboard, creators, videos, topics, compare, evidence, reports
  - Add Creators route is visible but owner-gated
  |
  | HTTP JSON under /api
  v
backend/
  - Express + TypeScript
  - Prisma data access
  - route/controller/service layers
  - in-process job runner
  - LLM client
  - ML service client for owner refresh/reanalysis
  |
  | SQL
  v
PostgreSQL
  - restored from thoughttracker_full.dump
  - creators, videos, transcripts, chunks, analysis rows, reports, embeddings

Owner refresh/reanalysis path:
thoughttracker-ml/
  - FastAPI
  - stance classifier
  - 768-d sentence embeddings
  - topic relevance model
  - topic reranker
  - final topic-selection policy

backend/
  |
  | local HTTP
  v
Ollama
  - local report writer, usually llama3.1:8b
```

The main app and ML repo are separate working directories by design. The main
app owns the product, API, UI, database schema, report workflow, and restored
snapshot. The ML repo owns transcript ingestion utilities, model artifacts, and
the inference service used when the owner refreshes or reanalyzes the corpus.

---

## 2. Evidence Chain

The core invariant is that product claims must be traceable back to transcript
evidence:

```text
Creator
  -> SourceChannel
    -> Video
      -> Transcript
        -> TranscriptChunk
          -> ChunkTopicAnalysis
            -> VideoTopicSummary
              -> CreatorTopicTimeline
                -> Report
```

This has two important consequences:

- Charts and counts come from database rows, not from report prose.
- Reports can be expressive, but their claims must be grounded in aggregates and
  quoted evidence that already exist in the database.

When a report lists sources, the API resolves source metadata so the frontend can
link back to the relevant video/transcript page. This makes the generated report
inspectable instead of a free-floating summary.

---

## 3. Runtime Provider Policy

The product is intended to run locally without a paid API key.

| Concern         | Current product provider                  | Behavior                                                   |
| --------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Reports         | `AI_PROVIDER=local`                       | Calls local Ollama through `LOCAL_LLM_BASE_URL`.           |
| Embeddings      | Precomputed in snapshot                   | Used by browsing/report pages without hosted ML.           |
| Stance          | Precomputed in snapshot                   | New stance analysis is owner-only through the ML repo.     |
| Topic relevance | Owner ML service                          | Used during refresh/reanalysis, not public read-only use.  |
| Topic reranking | Owner ML service                          | Used during refresh/reanalysis, not public read-only use.  |
| Topic selection | `TOPIC_ASSIGNMENT_PROVIDER=final_policy`  | Uses the frozen policy artifact in the ML repo.            |
| YouTube refresh | Owner automation                          | Operated by scripts/admin flow, guarded by the owner PIN.  |

Hosted OpenAI/Anthropic providers are still supported by the LLM client for
private owner usage, but they are not required for a reviewer to run the
portfolio demo.

Tests may use mocks and small fixtures. Product runtime paths should not present
fabricated creators, fabricated reports, or fabricated transcript analysis as
real output.

---

## 4. Database Snapshot And Data Ownership

The portfolio product data path is:

```text
git lfs pull
docker compose up -d
pg_restore thoughttracker_full.dump
npm run db:setup --workspace backend
```

`thoughttracker_full.dump` contains the real five-creator corpus and the
precomputed product state:

- creators and source channels
- videos and transcript records
- transcript chunks
- topic analysis rows
- stance analysis rows
- video-level and creator-level rollups
- generated reports
- embeddings and vector data

This avoids making a reviewer wait through transcript downloading, model
calibration, or full reanalysis. The data snapshot is the product baseline.

`db:seed` still exists, but it is guarded because it deletes and repopulates
tables. It is not the normal product setup path.

---

## 5. Backend Structure

```text
backend/src/app.ts
  Express app composition, middleware, routes, health checks

backend/src/server.ts
  HTTP listener and graceful shutdown

backend/src/config/
  env parsing, Prisma client, logger

backend/src/middleware/
  request IDs, admin PIN, idempotency, rate limits, timeouts, error shape

backend/src/routes/
  URL-to-controller mapping

backend/src/controllers/
  HTTP validation, request parsing, response shaping

backend/src/services/
  domain logic and database workflows

backend/src/jobs/
  in-process async queue and long-running jobs

backend/src/ai/
  LLM client, embedding client, ML classifier client, prompts, schemas

backend/prisma/
  Prisma schema, database setup, guarded seed script
```

### Service Ownership

`reportGeneration.service.ts`

- builds creator and topic reports from analyzed trends and evidence
- calls the LLM client for report prose
- persists report rows and source metadata

`topicDetection.service.ts`

- applies the controlled taxonomy
- collects topic candidates
- calls ML topic relevance and reranking where configured
- applies the final topic-selection policy
- avoids treating passing phrases as central topics

`stanceAnalysis.service.ts`

- classifies transcript chunks relative to topics
- supports `llm`, `custom_ml`, and `hybrid`
- stores stance label, confidence, rationale, and evidence quote

`embedding.service.ts`

- generates and stores embeddings
- uses pgvector when available
- preserves fallback behavior for resilience, but pgvector is the intended path

`creatorComparison.service.ts`

- computes overlap and differences across creators
- powers compare-page shared-topic navigation

`creatorOnboardingPipeline.service.ts`

- supports owner-only creator onboarding
- coordinates future transcript ingestion and analysis promotion

`youtubeImport.service.ts`

- no longer serves fake runtime channels
- real transcript refresh belongs to owner automation, not public recruiter use

---

## 6. Frontend Structure

```text
frontend/src/App.tsx
  route table

frontend/src/pages/
  page-level screens

frontend/src/components/
  reusable layout, cards, badges, charts, states, and topic-analysis UI

frontend/src/lib/
  typed API client, report job helpers, formatters, data-shaping helpers

frontend/src/i18n/en.ts
  user-facing copy

frontend/src/theme/
  theme provider and design tokens

frontend/src/toast/
  notification context
```

Primary pages:

- Dashboard
- Creators
- Creator detail
- Videos
- Video detail and transcript
- Topics
- Topic analysis
- Compare
- Evidence
- Report list
- Report detail
- Add Creators

The first screen should look like a real product immediately after the database
snapshot is restored. It should not feel like a marketing landing page or an
empty scaffold.

The Add Creators button is intentionally visible. It demonstrates that the
system can scale to new creators, but the operation itself is owner-only.

---

## 7. ML Service Integration

The backend can call `thoughttracker-ml` through `ML_CLASSIFIER_URL` for
owner-only refresh/reanalysis. The public hosted app and normal reviewer local
startup use the already-restored database snapshot and do not require a hosted
ML service.

Required endpoints:

- `GET /health`
- `POST /predict`
- `POST /embed`
- `POST /predict-topic-relevance`
- `POST /predict-topics`

Required runtime artifacts:

```text
models/stance-classifier
models/topic-relevance-classifier-supervalidation-hardneg2x-l512
models/topic-reranker-tfidf-sgd-supervalidation
models/topic-selection-policy-gold-standard
```

The final topic-selection policy baseline:

| Metric      | Result |
| ----------- | -----: |
| Exact match | 95.44% |
| Micro F1    | 98.40% |
| Precision   | 97.82% |
| Recall      | 98.98% |
| Macro F1    | 75.35% |

Macro F1 is intentionally documented as the rare-topic polish gap. It is not a
reason to hide the model; it is a clear explanation of what would improve next
with more labeled rare-topic examples.

---

## 8. Report Generation

Reports are asynchronous:

```text
POST /api/reports/generate
  -> validate request
  -> create AnalysisRun
  -> enqueue generateReport job
  -> return 202 with analysisRunId
  -> frontend polls until complete
```

Report prompts ask for:

- concise headings
- rich, readable bullets
- no nested bullet soup
- no internal labels such as `trendLabel`
- source-grounded claims
- source links when video/topic ids are available

The report writer may produce prose, but it must not invent statistics,
evidence, or stance changes outside the supplied aggregates and quotes.

---

## 9. Owner-Only Add Creators

Mutating owner-only routes require:

```text
X-Admin-Pin: <ADMIN_ONBOARDING_PIN>
```

`backend/src/middleware/adminPin.ts` verifies the header against the configured
PIN. In production-like modes, missing or weak PIN configuration fails closed.

The intended public behavior:

- recruiters can see the Add Creators flow exists
- recruiters cannot operate it without the PIN
- the owner can use it to grow the corpus later

The intended owner workflow:

1. Provide one or more creator/channel/playlist URLs.
2. Download verified transcripts through the ML repo tooling.
3. Ingest the new transcript text.
4. Run incremental analysis and validation.
5. Promote the updated database snapshot and metrics when acceptable.

---

## 10. Operational Notes

`DEMO_MODE=true`

- tightens public-demo guardrails and rate limits
- does not switch the app to fake providers
- does not replace the real corpus

`AI_PROVIDER=local`

- calls Ollama
- avoids OpenAI token bills for reviewers
- keeps report generation local

`EMBEDDING_PROVIDER=ml`

- is used when the owner regenerates embeddings locally through the ML service
- is not required for normal public read-only browsing of the restored snapshot

The in-process job runner is deliberately simple. It is enough for a portfolio
demo and single-owner workflows. If this became a multi-user production product,
the natural migration would be a durable queue such as BullMQ plus Redis.

---

## 11. Test Strategy

Backend:

- Vitest + Supertest
- API, middleware, services, jobs, utilities, provider edges
- 100% line coverage target

Frontend:

- Vitest + Testing Library
- pages, components, hooks, formatting helpers, retry/error states
- 100% line coverage target

ML:

- pytest
- inference, model loading, API shape, scripts, metrics, hardening
- 100% coverage target

End-to-end:

- Playwright
- golden path, compare, reports, Add Creators, accessibility, visuals

Mocks and test doubles are valid inside tests. They are not the runtime product
story.

---

## 12. What Should Not Come Back

Do not reintroduce:

- fake runtime creators
- synthetic public product reports
- old failed ChatGPT packet folders
- raw VTT caches as public product data
- SemEval as the product dataset
- temporary calibration artifacts
- silent mock fallbacks that make broken real providers look successful

Keep historical ADRs when they explain why the system changed, but update any
top-level docs that still describe an old mock-first product as if it were the
current baseline.
