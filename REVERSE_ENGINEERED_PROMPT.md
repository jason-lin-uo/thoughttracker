# Reverse-Engineered Product Prompt

Author: Jason Lin

This is the rebuild brief for the current ThoughtTracker product. Its purpose is
not to be a short README. Its purpose is to give a capable coding agent enough
context to recreate the product architecture, data flow, runtime expectations,
tests, and documentation discipline from scratch.

The current product is no longer a mock-data scaffold. It is a real-data,
ML-backed, local-LLM portfolio baseline:

- five real YouTube creator corpora
- committed transcript text in the ML repo
- PostgreSQL product snapshot tracked through Git LFS
- companion ML repo with committed runtime artifacts for owner refresh/reanalysis
- local Ollama report generation by default
- owner-only Add Creators flow protected by `ADMIN_ONBOARDING_PIN`
- 100% line coverage target for backend, frontend, and ML unit suites
- Playwright end-to-end coverage for the running app

Use this prompt as a specification for rebuilding the system, auditing it, or
explaining it to another engineer.

---

## 1. Product Objective

Build ThoughtTracker: a full-stack application that helps a user inspect how
YouTube creators discuss topics over time.

The app must:

- ingest and store YouTube transcript text
- split transcripts into citeable chunks
- assign controlled-taxonomy topics to chunks
- classify stance toward those topics
- preserve evidence quotes for claims
- aggregate chunk analysis into video summaries and creator timelines
- generate readable reports from the analyzed evidence
- provide a polished UI for browsing creators, topics, videos, evidence,
  reports, and comparisons
- expose a visible but owner-gated Add Creators workflow for future scaling

The app must not:

- infer private beliefs beyond transcript evidence
- present fake creators or fake runtime data as product output
- silently fabricate reports if the local or hosted LLM fails
- require recruiters to own an OpenAI key
- require a reviewer to rerun the full model-calibration process

---

## 2. Repository Layout

There are two sibling repos.

```text
thoughttracker/
  backend/
    Express + TypeScript + Prisma + PostgreSQL + pgvector
  frontend/
    React + Vite + TypeScript + React Query + Recharts
  e2e/
    Playwright specs
  docs/
    deploy guide, ADRs, upload plan, design notes
  thoughttracker_full.dump
    Git-LFS-tracked PostgreSQL snapshot

thoughttracker-ml/
  src/api/
    FastAPI inference service
  src/inference/
    stance, embeddings, topic relevance, topic reranking
  src/training/
    training and evaluation utilities
  scripts/
    transcript download, ingestion, update, and owner-onboarding utilities
  data/transcripts/
    final text transcript corpus
  data/processed/
    final gold-standard topic datasets
  models/
    committed runtime artifacts
  reports/metrics/
    final metrics and policy reports
```

The main app should not duplicate ML model logic. The ML repo exposes it over
HTTP for owner refresh/reanalysis. The normal public and reviewer read path
uses the restored database snapshot and does not require a hosted ML service.

---

## 3. Current Runtime Defaults

The portfolio path should run without paid API access.

```env
AI_PROVIDER=local
AI_MODEL=llama3.1:8b
LOCAL_LLM_BASE_URL=http://localhost:11434

YOUTUBE_PROVIDER=youtube

TOPIC_ASSIGNMENT_PROVIDER=final_policy

ADMIN_ONBOARDING_PIN=choose-a-private-pin
DEMO_MODE=false
```

Hosted OpenAI/Anthropic providers may remain available for owner-only private
runs, but the default reviewer experience must work with the restored snapshot
and local Ollama. Owner reanalysis may additionally run the local ML service.

---

## 4. Product Data Baseline

The public product baseline is a restored database snapshot, not a seed file.

```text
thoughttracker_full.dump
```

The snapshot contains:

- real creators
- real videos
- real transcript text
- transcript chunks
- topic assignments
- stance labels
- evidence quotes
- timeline aggregates
- reports
- embeddings and vector data

The frontend should look populated immediately after the dump is restored.

`db:seed` may exist for tests or local fixtures, but it must be guarded because
it deletes and repopulates data. It should not be described as the normal product
path.

---

## 5. Data Model

Core chain:

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

Important models:

- `Creator`: display entity such as John Campea or Marques Brownlee
- `SourceChannel`: YouTube channel or playlist source metadata
- `Video`: source video metadata, transcript status, analysis status
- `Transcript`: raw and cleaned transcript text
- `TranscriptChunk`: citeable unit of transcript analysis
- `Topic`: controlled-taxonomy topic
- `ChunkTopicAnalysis`: topic, stance, confidence, rationale, evidence quote
- `VideoTopicSummary`: per-video rollup for a topic
- `CreatorTopicTimeline`: per-creator, per-topic trend over time
- `Report`: generated creator/topic narrative, caveats, source evidence
- `AnalysisRun`: provenance row for analysis/report generation
- `Embedding`: vector storage linked to a transcript chunk
- `ImportJob` and `ImportJobItem`: owner workflow tracking

Invariants:

- Every important claim should trace back to transcript text.
- Numeric charts should come from structured rows, not report prose.
- Reports should link sources to videos or transcripts when possible.
- Owner-only mutations require `X-Admin-Pin`.

---

## 6. Backend Architecture

Use Express with TypeScript and Prisma.

Recommended structure:

```text
backend/src/app.ts
backend/src/server.ts
backend/src/config/
backend/src/middleware/
backend/src/routes/
backend/src/controllers/
backend/src/services/
backend/src/jobs/
backend/src/ai/
backend/src/utils/
backend/src/openapi/
backend/prisma/
backend/tests/
```

Layer rules:

- `routes` map URLs to controllers.
- `controllers` validate HTTP input and shape HTTP output.
- `services` own domain logic and database work.
- `jobs` handle long-running async work.
- `ai` owns LLM, embedding, ML-service, prompt, and response-schema code.
- `utils` contains reusable helpers only.
- `openapi` documents the API surface.

The backend should include:

- request IDs
- structured errors
- rate limits
- idempotency for mutating endpoints
- timeouts
- graceful shutdown
- Prisma retry behavior for transient database failures
- constant-time admin PIN comparison

---

## 7. AI And ML Responsibilities

### Local LLM Reports

Reports are generated through `AI_PROVIDER=local` by default. The local provider
should call an Ollama-compatible endpoint.

Report generation must:

- use supplied aggregates and evidence only
- avoid fabricated statistics
- avoid internal field names such as `trendLabel`
- write concise headings
- use rich bullets without nested bullet clutter
- include caveats where evidence is limited
- return source metadata that the UI can turn into links

### Embeddings

`EMBEDDING_PROVIDER=ml` should call the ML service `POST /embed` during owner
refresh/reanalysis.

The intended embedding dimension is 768. PostgreSQL should use pgvector for the
hot path, with fallback behavior documented as resilience rather than the target
runtime path.

### Stance

`STANCE_ANALYSIS_PROVIDER=custom_ml` should call `POST /predict` during owner
refresh/reanalysis.

Supported stance labels:

- supportive
- opposed
- neutral
- mixed
- unclear
- insufficient evidence

### Topic Selection

Topic selection should use:

- controlled taxonomy
- candidate generation
- topic relevance model
- topic reranker
- final topic-selection policy
- conservative display gating

The final policy artifact lives in:

```text
thoughttracker-ml/models/topic-selection-policy-gold-standard/policy.json
```

Final baseline metrics:

| Metric      | Result |
| ----------- | -----: |
| Exact match | 95.44% |
| Micro F1    | 98.40% |
| Precision   | 97.82% |
| Recall      | 98.98% |
| Macro F1    | 75.35% |

Macro F1 should be documented honestly as a rare-topic polish gap, not hidden.

---

## 8. ML Service Contract

The backend should call `ML_CLASSIFIER_URL`, usually `http://localhost:8000`.

Required endpoints:

```text
GET /health
POST /predict
POST /embed
POST /predict-topic-relevance
POST /predict-topics
```

Expected artifact folders:

```text
models/stance-classifier
models/topic-relevance-classifier-supervalidation-hardneg2x-l512
models/topic-reranker-tfidf-sgd-supervalidation
models/topic-selection-policy-gold-standard
```

If artifacts are missing, the service should return explicit health/load errors.
The main app should explain the missing local dependency rather than silently
serving fake analysis.

---

## 9. Frontend Requirements

Use React, Vite, TypeScript, React Query, Tailwind, and Recharts.

Pages:

- Dashboard
- Creators
- Creator detail
- Videos
- Video detail/transcript
- Topics
- Topic analysis
- Compare
- Evidence
- Report list
- Report detail
- Add Creators
- Not Found

UI behavior:

- First viewport should feel like a real data product.
- Do not make a marketing splash page.
- Empty states should distinguish "local service missing" from "no data."
- Report source rows should link to video/transcript pages.
- Shared topics in Compare should be clickable where useful.
- Add Creators should be visible in navigation but require the PIN before
  mutation.
- Pages should be keyboard-accessible and Playwright-auditable.

Design tone:

- quiet, dense, analytical
- recruiter-friendly
- evidence-first
- no inflammatory stance wording
- no giant hero fluff

---

## 10. Owner-Only Add Creators

The Add Creators flow demonstrates that the project can scale beyond the initial
five creators.

Public reviewers:

- can see the page/button
- cannot operate the workflow without the PIN
- should not receive API keys or the PIN

Owner workflow:

1. Enter one or more YouTube creator/channel/playlist URLs.
2. Provide the owner PIN.
3. Download transcript text with the ML repo scripts.
4. Build or update manifests.
5. Ingest transcripts into the main app.
6. Run incremental analysis and validation.
7. Promote the updated dump and metrics only after verification.

The app should make this path visible as product thinking, while protecting the
costly or mutating operations.

---

## 11. Local Setup Flow

Recommended reviewer setup:

```bash
git lfs install
git lfs pull
npm install
cp .env.example .env
cp .env.example backend/.env
cp .env.example frontend/.env.local
docker compose up -d
npm run db:push
pg_restore --no-owner --clean --if-exists -d "<DATABASE_URL>" thoughttracker_full.dump
```

Owner reanalysis can start the ML service in the sibling repo:

```bash
cd ../thoughttracker-ml
python -m venv .venv
python -m pip install -r requirements.txt
python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

Start local report generation:

```bash
npm run setup:local-ai
```

Start the app:

```bash
npm run dev
```

The frontend usually runs at `http://localhost:5173`, unless Vite selects a
different free port.

---

## 12. Testing Requirements

Backend:

```bash
npm run typecheck
npm run test --workspace backend -- --run --reporter=dot
```

Frontend:

```bash
npm run test --workspace frontend -- --run --reporter=dot
```

End-to-end:

```bash
npm run test:e2e
```

ML:

```bash
cd ../thoughttracker-ml
python -m pytest -q
```

Coverage expectations:

- backend unit/integration tests target 100% line coverage
- frontend unit tests target 100% line coverage
- ML tests target 100% line coverage
- Playwright covers real browser flows

Test mocks are allowed. Runtime product mocks are not the product story.

---

## 13. Documentation Requirements

Docs should help a recruiter or interviewer understand the engineering, not just
run commands.

Maintain:

- `README.md`: product overview and local setup
- `ARCHITECTURE.md`: system map and runtime decisions
- `GLOSSARY.md`: reader-friendly technical definitions
- `docs/DEPLOY.md`: local/hosted deployment and environment variables
- `docs/UPLOAD_PLAN.md`: public GitHub publishing plan with atomic PRs
- `REVERSE_ENGINEERED_PROMPT.md`: this full rebuild brief
- ADRs: historical decisions and why they changed
- `_LEARN.md` files: folder-level orientation notes

Docs should remove stale references to fake public product data, SemEval as the
main dataset, or old failed calibration rounds. They should keep useful
educational explanations and update them to the current architecture.

---

## 14. Security And Cost Controls

The product must protect:

- OpenAI/Anthropic keys if the owner configures them
- owner-only onboarding operations
- public demo endpoints from accidental abuse
- database destructive operations

Default behavior should avoid paid APIs:

- reports use Ollama
- reviewer browsing uses precomputed embeddings and stance rows from the snapshot
- owner reanalysis can use the local ML service
- recruiter does not receive the admin PIN

If a paid provider is configured, use rate limits, budgets, and clear errors.

---

## 15. What Not To Reintroduce

Do not reintroduce:

- fake runtime creators
- fake runtime reports
- fake runtime transcript data
- old ChatGPT packet directories
- failed labeling-round folders
- raw VTT caches as public product data
- SemEval as the product corpus
- silent fallback that makes broken real services look successful

Keep mocks in tests where they are normal engineering practice.

---

## 16. Success Criteria

A reviewer should be able to:

1. Clone the main repo for normal review.
2. Pull Git LFS artifacts.
3. Restore the database dump.
4. Start Postgres, Ollama, backend, and frontend.
5. Open the UI and see the real five-creator product.
6. Generate or view reports without an OpenAI key.
7. Browse evidence back to transcript context.
8. See the Add Creators path without being able to mutate it.
9. Optionally clone/run the ML repo for owner refresh/reanalysis.
10. Run tests and see a disciplined, well-covered codebase.

The product should tell a coherent engineering story: real data, strong
evidence discipline, pragmatic local AI, careful testing, and a credible path to
scale beyond the first five creators.
