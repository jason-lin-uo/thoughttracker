# ThoughtTracker

Built by Jason Lin as a full-stack ML-backed portfolio project.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Postgres](https://img.shields.io/badge/Postgres-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Local AI](https://img.shields.io/badge/Reports-Ollama%20local-111827)](#local-setup)

**Evidence-backed transcript analysis for YouTube creators.**

Live app: <https://thoughttracker-web-415a.onrender.com/>

ThoughtTracker is a full-stack TypeScript application that analyzes real
YouTube transcript corpora. It stores creator videos, transcript chunks, topic
assignments, stance evidence, timeline aggregates, and
LLM-written reports in PostgreSQL, then exposes the results through a polished
React analytics UI.

The product is designed to be portfolio-friendly: a fresh clone can run with
the committed real database snapshot and a local Ollama model. No recruiter
needs an OpenAI key to see rich reports. The companion `thoughttracker-ml` repo
remains the offline pipeline for adding creators, recalibrating labels, and
refreshing the product snapshot.

## Project Preview

The hosted app is the best way to explore the product, but these screenshots
show the core experience directly from the repository.

![ThoughtTracker dashboard showing corpus totals, a featured report, and five real creators.](docs/assets/screenshots/dashboard.png)

**Report view:** AI-assisted analysis is grounded in transcript evidence and a
clickable stance trajectory.

![ThoughtTracker report detail page with a stance trajectory and written summary.](docs/assets/screenshots/report-detail.png)

**Topic analysis:** every topic has creator-specific stance, date filtering,
trajectory visualization, and source evidence.

![ThoughtTracker topic analysis page with creator-specific stance trends and transcript evidence.](docs/assets/screenshots/topic-analysis.png)

## What To Review First

- Open the live app and start on the dashboard; it shows the real five-creator
  corpus, topic coverage, evidence totals, and recent report activity.
- Open any report to inspect the evidence-backed AI analysis, clickable source
  videos, and stance trajectory.
- Open the Topic Analysis page for Foldable Smartphone Reviews to see per-video
  stance, date filtering, trajectory visualization, and transcript evidence.
- Review [`ARCHITECTURE.md`](ARCHITECTURE.md) and
  [`docs/DEPLOY.md`](docs/DEPLOY.md) for implementation and deployment
  reasoning.

## Product Principles

- Evidence first: every topic or stance claim links back to a transcript chunk.
- Transcript-only: the app does not infer private beliefs, tone, sarcasm, or
  intent beyond the text it can quote.
- Real portfolio data: runtime product data comes from the five real creators
  and the committed database snapshot.
- Owner-controlled growth: the Add Creators page is visible, but mutations
  require `ADMIN_ONBOARDING_PIN` through the `X-Admin-Pin` header.
- No silent fake runtime: local/hosted provider failures surface clearly instead
  of saving fabricated reports or vectors.

## Current Baseline

The current snapshot uses five creators, the final transcript corpus, and the
gold-standard topic-selection policy produced in `thoughttracker-ml`.

| Metric      | Result |
| ----------- | -----: |
| Exact match | 95.44% |
| Micro F1    | 98.40% |
| Precision   | 97.82% |
| Recall      | 98.98% |
| Macro F1    | 75.35% |

Macro F1 is the honest rare-topic polish metric. The product-quality baseline is
strong on exact match, micro F1, precision, recall, evidence quality, and
conservative display gating.

## Core Features

- Dashboard with creator, topic, report, evidence, and trend summaries.
- Creator pages with top topics, recent videos, report access, and topic links.
- Compare page with shared-topic navigation between creators.
- Topic Analysis page with stance trajectory, frequency charts, episode
  summaries, evidence quotes, and source links.
- Evidence explorer with transcript context around each quoted chunk.
- Page-level search and filtering for creators, videos, topics, and evidence.
- Rich local report generation through Ollama by default.
- Owner-only Add Creators workflow for future transcript ingestion and
  reanalysis.

## Architecture At A Glance

```text
frontend/ React + Vite + React Query + Recharts
 |
 | HTTP / JSON
 v
backend/ Express + TypeScript + Prisma
 |
 | SQL + pgvector
 v
PostgreSQL database restored from thoughttracker_full.dump

Owner-only refresh/reanalysis path:
thoughttracker-ml FastAPI service + scripts for transcript ingestion, stance,
topic relevance, topic reranking, and final policy artifacts
```

The evidence chain is:

```text
Creator -> SourceChannel -> Video -> Transcript -> TranscriptChunk
 -> ChunkTopicAnalysis -> VideoTopicSummary
 -> CreatorTopicTimeline -> Report
```

Charts and counts are database aggregates. Reports are generated by an LLM over
those aggregates and curated evidence quotes.

## Local Setup

### Prerequisites

- Node.js 20+
- npm 10+
- Git LFS
- Docker Desktop, Rancher Desktop, or another Docker-compatible engine
- Ollama for local report generation

Install Ollama:

```bash
# Windows
winget install Ollama.Ollama

# macOS
brew install --cask ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

After installing, open the Ollama app or run `ollama serve`.

### Fast Path

Run the first-time setup from the main repo:

```bash
cd thoughttracker
npm run setup:local
```

After that, start the product with:

```bash
npm run dev
```

`npm run dev` first runs a local doctor check. It verifies Docker, required
env files, the backend port, the preferred frontend port, local Postgres
availability, and Ollama. It never kills processes on the reviewer's machine;
if something is already using a required port, it prints the process details
and the exact command to stop it manually.

Open the frontend URL printed by Vite, usually:

```text
http://localhost:5173
```

If port 5173 is busy, Vite will print the next available port.

The setup script performs the slow/tedious reviewer setup once: env-file
creation, Git LFS pulls, npm install, Docker Postgres startup, real dump
restore, pgvector/index setup, Prisma client generation, and local Ollama model
verification. It does not use `db:seed`; the product path is the real database
snapshot.

Owner-only reanalysis workflows can additionally prepare and run the sibling ML
repo:

```bash
npm run setup:local:full
npm run dev:full
```

### Database Snapshots

- `thoughttracker_full.dump` powers the complete local product.
- `thoughttracker_hosted_free.dump` powers the free hosted public version. It
  preserves the real creators, videos, topics, chunked transcripts, embeddings,
  evidence, and reports, but removes redundant full-transcript copies from the
  `Transcript` table so it can fit small hosted Postgres plans.

Both snapshots include one pre-generated report so a fresh local install or
hosted reset never opens with an empty report surface. The owner can restore
that clean starting state from the PIN-gated Add Creators admin panel.

### Manual Path

Use this only when debugging a machine-specific setup issue.

```bash
git lfs install
git lfs pull
npm install
cp .env.example .env
cp .env.example backend/.env
cp .env.example frontend/.env.local
```

For local portfolio browsing and report regeneration, keep these defaults in
`backend/.env`:

```env
AI_PROVIDER=local
AI_MODEL=llama3.1:8b
LOCAL_LLM_BASE_URL=http://localhost:11434
YOUTUBE_PROVIDER=youtube
TOPIC_ASSIGNMENT_PROVIDER=final_policy
ADMIN_ONBOARDING_PIN=choose-a-private-local-pin
```

No OpenAI key is required for the default local path.

Start Postgres and restore real data:

```bash
docker compose up -d
npm run db:push
pg_restore --no-owner --clean --if-exists ^
 -d "postgresql://postgres:postgres@localhost:5432/thoughttracker" ^
 thoughttracker_full.dump
```

On macOS/Linux, use backslashes instead of PowerShell carets:

```bash
pg_restore --no-owner --clean --if-exists \
 -d "postgresql://postgres:postgres@localhost:5432/thoughttracker" \
 thoughttracker_full.dump
```

`db:seed` exists for guarded test/development fixtures. It is not the product
data path. The product data path is the real snapshot above.

Start the ML service only for owner reanalysis or Add Creators workflows:

In a sibling checkout:

```bash
cd ../thoughttracker-ml
python -m venv .venv

# Windows
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000

# macOS/Linux
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

Start the app:

```bash
npm run setup:local-ai
npm run dev
```

## Important Commands

| Command                                                     | Purpose                                              |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `npm run setup:local`                                       | First-time reviewer setup for real data + Ollama.    |
| `npm run doctor`                                            | Diagnose local env, Docker, ports, and Ollama.       |
| `npm run dev`                                               | Start Postgres, backend, and frontend.               |
| `npm run setup:local:full`                                  | Owner setup including the sibling ML repo.           |
| `npm run dev:full`                                          | Owner startup including the ML service.              |
| `npm run setup:local-ai`                                    | Verify Ollama and pull/check `llama3.1:8b`.          |
| `npm run snapshot:bootstrap`                                | Refresh frontend first-paint query snapshot.         |
| `npm run typecheck`                                         | Typecheck backend and frontend.                      |
| `npm run test --workspace backend -- --run --reporter=dot`  | Backend tests.                                       |
| `npm run test --workspace frontend -- --run --reporter=dot` | Frontend tests.                                      |
| `npm run test:e2e`                                          | Playwright end-to-end suite.                         |
| `npm run db:push`                                           | Apply Prisma schema to local Postgres.               |

## Provider Behavior

| Concern         | Local product value                      | Notes                                                                       |
| --------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Report LLM      | `AI_PROVIDER=local`                      | Uses Ollama, no paid API key.                                               |
| Embeddings      | Precomputed in snapshot                  | Used by the restored database; no hosted ML service needed for browsing.     |
| Stance          | Precomputed in snapshot                  | New stance analysis is owner-only through `thoughttracker-ml`.               |
| Topic selection | `TOPIC_ASSIGNMENT_PROVIDER=final_policy` | Uses frozen gold-standard policy.                                           |
| YouTube refresh | Owner scripts                            | Runtime import endpoints are owner-gated and fail closed if not configured. |

Automated tests still use test doubles and small fixtures where appropriate.
Runtime product code should use real/local providers and the real snapshot.

## First-Load Performance

The hosted free path has two performance layers:

- the backend keeps short-lived in-memory responses for public read endpoints
  such as dashboard, creators, topics, reports, videos, and evidence;
- the frontend bundles a small real-data bootstrap snapshot so the first
  dashboard/list pages can paint before Render/Neon finish a live refresh.

Refresh the bundled snapshot after changing the hosted saved-report state:

```powershell
$env:BOOTSTRAP_API_BASE_URL="https://thoughttracker-api-3mm9.onrender.com/api"
npm run snapshot:bootstrap
```

The live API still refreshes in the background, so the snapshot is a fast first
paint, not the source of truth.

## Owner-Only Creator Onboarding

The Add Creators button is intentionally visible so reviewers can see that the
product has a scale-up path. It cannot mutate the corpus unless the request
includes the owner PIN:

```text
X-Admin-Pin: <ADMIN_ONBOARDING_PIN>
```

The same PIN is passed into the ML repo onboarding wrapper so future creator
updates can be downloaded, ingested, analyzed, audited, and promoted under owner
control.

## Verification Baseline

Current local verification:

- Backend typecheck: passing.
- Backend Vitest: 721 tests passing.
- Frontend typecheck: passing.
- Frontend Vitest: 328 tests passing.
- ML pytest: 183 tests passing with 100% coverage.

Playwright should be run after the local database, backend, frontend, and
Ollama are up. ML service startup is only needed for owner reanalysis flows.

## Known Limitations

- Macro F1 remains the rare-topic polish metric.
- Add Creators is owner-only, not recruiter-operated.
- The app analyzes transcript text only; it does not process audio tone or
  sarcasm.
- The in-process queue is enough for the portfolio product. A production-scale
  version would move long jobs to a durable queue.
