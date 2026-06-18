# SKILLS.md - Portfolio Dossier

Author: Jason Lin

This file is the interview prep index for the current ThoughtTracker product.
It lists the skills demonstrated by the two repos and points to the files that
prove each claim.

## Current Snapshot

- Main app: `thoughttracker`, a React/Express/Postgres product.
- ML app: `thoughttracker-ml`, a FastAPI/PyTorch/offline pipeline for creator
  ingestion, model calibration, and snapshot refreshes.
- Product data: real five-creator corpus restored from `thoughttracker_full.dump`.
- Report generation: local Ollama by default (`AI_PROVIDER=local`).
- Stance/topic calibration: handled by the ML repo and frozen into the
  committed product snapshot.
- Owner-only scale-up: Add Creators is visible but gated by
  `ADMIN_ONBOARDING_PIN`.
- Current policy metrics: exact match 95.44%, micro F1 98.40%, precision
  97.82%, recall 98.98%, macro F1 75.35%.

## Full-Stack Product Engineering

| Skill                                     | Evidence                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| React application architecture            | `frontend/src/App.tsx`, `frontend/src/pages`, `frontend/src/components` |
| Server-state management                   | TanStack Query usage across page files                                  |
| Data visualization                        | `frontend/src/components/Charts.tsx`, compare/topic pages               |
| Accessible UI patterns                    | Playwright + axe tests, semantic page structure, labels, focus behavior |
| Express route/controller/service layering | `backend/src/routes`, `backend/src/controllers`, `backend/src/services` |
| Prisma/Postgres modeling                  | `backend/prisma/schema.prisma`                                          |
| Real-data search and filtering            | `backend/src/controllers/search.controller.ts`, page-level filters       |
| Async background jobs                     | `backend/src/jobs/jobRunner.ts` and job modules                         |
| OpenAPI documentation                     | `backend/src/openapi/spec.ts`                                           |
| Owner-only admin gate                     | `backend/src/middleware/adminPin.ts`                                    |

## AI And ML Engineering

| Skill                          | Evidence                                                        |
| ------------------------------ | --------------------------------------------------------------- |
| Local LLM integration          | `backend/src/ai/llmClient.ts`, `scripts/setup-local-ai.mjs`     |
| Prompt engineering             | `backend/src/ai/prompts/*.prompt.ts`                            |
| Schema-validated LLM responses | `backend/src/ai/schemas`                                        |
| LLM budget/cache discipline    | `backend/src/ai/llmBudget.ts`, `backend/src/ai/llmClient.ts`    |
| ML service integration         | `backend/src/ai/mlClassifierClient.ts`                          |
| Stance classification          | `thoughttracker-ml/src/inference/predict.py`                    |
| Sentence embeddings            | `thoughttracker-ml/src/inference/embed.py`                      |
| Topic relevance                | `thoughttracker-ml/src/inference/topic_relevance.py`            |
| Topic reranking                | `thoughttracker-ml/src/inference/topic_reranker.py`             |
| Final policy calibration       | `thoughttracker-ml/models/topic-selection-policy-gold-standard` |
| Metrics reporting              | `thoughttracker-ml/reports/metrics`                             |

## Data And Pipeline Work

| Skill                         | Evidence                                                |
| ----------------------------- | ------------------------------------------------------- |
| Transcript collection         | `thoughttracker-ml/scripts/fetch_transcripts.py`        |
| Transcript manifests          | `thoughttracker-ml/data/transcripts/*/_manifest.json`   |
| Clean final transcript corpus | `thoughttracker-ml/data/transcripts/**/*.txt`           |
| Database snapshot packaging   | `thoughttracker_full.dump` tracked by Git LFS           |
| Incremental creator workflow  | `thoughttracker-ml/scripts/add_creator_pipeline.*`      |
| Cross-repo contract           | `thoughttracker-ml/integration_contract.md`             |
| Final artifact discipline     | ML `models/`, `data/processed/`, and `reports/metrics/` |

## Testing And Quality

| Skill                            | Evidence                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| Backend unit/integration testing | `backend/tests`, Vitest + Supertest                             |
| Frontend component/page testing  | `frontend/tests`, Testing Library                               |
| ML unit/API testing              | `thoughttracker-ml/tests`, pytest                               |
| End-to-end testing               | `e2e`, Playwright                                               |
| 100% line coverage discipline    | Vitest/pytest configs and coverage tests                        |
| Test doubles where appropriate   | Test files only; runtime product paths use real/local providers |
| CI portability awareness         | Cross-platform npm/Python commands and Git LFS snapshot         |

Current verified status:

- Backend typecheck passes.
- Backend Vitest passes: 719 tests.
- Frontend typecheck passes.
- Frontend Vitest passes: 328 tests.
- ML pytest passes: 183 tests with 100% coverage.

## Architecture And Reliability

| Skill                                         | Evidence                                                              |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Provider abstraction over real/local services | `backend/src/config/env.ts`, `backend/src/ai`, `backend/src/services` |
| Fail-closed owner mutations                   | `backend/src/middleware/adminPin.ts`                                  |
| Idempotent writes                             | Embedding upserts and job tests                                       |
| Graceful shutdown                             | `backend/src/server.ts`                                               |
| Request correlation                           | `backend/src/middleware/requestId.ts`, Pino logging                   |
| Rate limiting                                 | `backend/src/middleware/rateLimiter.ts`                               |
| LRU caching                                   | LLM cache implementation                                              |

## Product And UX Judgment

| Skill                          | Evidence                                             |
| ------------------------------ | ---------------------------------------------------- |
| Evidence-first product framing | Reports, evidence pages, stance caveats              |
| Recruiter-friendly local setup | `README.md`, `PERSONAL_MACHINE_SETUP.md`             |
| Owner-only public controls     | visible Add Creators button with PIN gate            |
| Human-readable reports         | `creatorReport.prompt.ts`, `topicReport.prompt.ts`   |
| Source traceability            | report source links, evidence context pages          |
| Scale-up plan                  | creator onboarding pipeline and ML artifact workflow |

## Interview Talking Points

1. A reviewer restores `thoughttracker_full.dump` and sees the real
   five-creator corpus.
2. Reports are generated locally with Ollama, avoiding OpenAI billing and quota
   friction for reviewers.
3. The ML repo is not decorative: it supplies stance, embeddings, topic
   relevance, topic reranking, and the frozen policy artifacts.
4. The owner-only Add Creators flow shows how the system scales while protecting
   the public demo from mutation and API spend.
5. Test doubles remain where they belong: inside automated tests and
   error-branch coverage, not as the live product data path.

## Keyword Index

TypeScript, React, Vite, React Router, TanStack Query, Recharts, Tailwind,
Express, Prisma, PostgreSQL, pgvector, OpenAPI, Pino, Zod, FastAPI, PyTorch,
Hugging Face Transformers, DistilBERT, scikit-learn, pandas, pytest, Vitest,
Playwright, Testing Library, Supertest, Ollama, local LLMs, prompt engineering,
schema validation, embeddings, stance classification, topic
reranking, topic relevance, calibration, exact match, micro F1, macro F1, Git
LFS, database snapshots, owner-gated onboarding, CI, accessibility, graceful
shutdown, idempotency, rate limiting, evidence-first UX.
