# Upload Plan - Atomic PR Roadmap For Publishing ThoughtTracker

This repository is the working sandbox. The public GitHub repositories should
not receive one enormous "here is everything" commit. This document explains how
to publish the finished project into your real public repos as a readable
sequence of reviewable pull requests.

The goal is not to pretend the project was built in one perfect pass. The goal
is to create a clean public history that tells the engineering story in layers:
foundation, backend, data, ML, frontend, tests, deployment, and documentation.

Public target repos:

- `thoughttracker` - full-stack app, database snapshot, UI, API, docs
- `thoughttracker-ml` - ML service, transcript corpus, model artifacts, metrics

The public history should make these things obvious:

- the product uses real five-creator transcript data
- the database snapshot is the product baseline
- the app runs locally without an OpenAI key by using Ollama
- the ML service owns stance, embeddings, topic relevance, topic reranking, and
  final topic selection
- Add Creators is visible but owner-gated
- tests and docs were treated as first-class engineering work

---

## How To Use This Plan

1. Create the empty public GitHub repos.
2. Start from the finished sandbox working copy.
3. For each PR below, create the branch named in this plan.
4. Copy only the listed files into that branch.
5. Commit, push, open the PR, and paste/adapt the provided PR description.
6. Review the diff in GitHub before merging.
7. Merge to `main`, then continue to the next PR.

You can open multiple PRs at once only when the dependency notes say they are
independent. Otherwise, merge in order so reviewers can follow the system being
assembled.

---

## Conventions

- Branch naming: `<type>/<short-slug>`, for example `feat/backend-services`.
- PR titles: `<type>(<scope>): <description>`.
- One commit per PR is fine.
- Tests should land with the code they cover.
- Folder-level `_LEARN.md` files should land with the folders they explain.
- Do not include temporary calibration packets, failed labeling rounds, raw VTT
  caches, or obsolete one-off scripts.
- Do include real transcript text, runtime model artifacts, gold-standard
  metrics, and the database dump through Git LFS where applicable.
- Do include the Render/Neon deployment blueprint and the one-command local
  setup helpers; the public project should be easy to run, not just easy to
  read.
- Do not copy ignored `_excluded_low_quality`, `_excluded_short_form`, or
  training checkpoint folders into the public repos. They are local working
  leftovers, not the clean product corpus.

---

## Public Story Arc

The PR sequence should read like this:

1. Bootstrap the repos.
2. Add backend infrastructure and schema.
3. Add real data snapshot and runtime provider configuration.
4. Add backend services and API.
5. Add the ML service and artifacts.
6. Add frontend shell, pages, and product UI.
7. Add owner-only onboarding.
8. Add tests and e2e coverage.
9. Add deployment docs and final portfolio documentation.

---

# Repo 1 Of 2 - `thoughttracker`

The main repo owns the product API, UI, database schema, local setup, database
snapshot, Playwright suite, and public-facing documentation.

## Main Dependency Graph

```text
APP-PR-00 repo bootstrap
  |
APP-PR-01 backend scaffold
  |
APP-PR-02 database schema and guarded setup
  |
APP-PR-03 real snapshot and environment policy
  |
APP-PR-04 AI and ML client layer
  |
APP-PR-05 backend services
  |
APP-PR-06 jobs, middleware, controllers, OpenAPI
  |
APP-PR-07 frontend scaffold and shared UI
  |
APP-PR-08 frontend pages and report experience
  |
APP-PR-09 owner-only Add Creators flow
  |
APP-PR-10 tests and e2e suite
  |
APP-PR-11 deploy and local setup docs
  |
APP-PR-12 final documentation polish
```

---

## APP-PR-00 - `chore(repo): bootstrap main app`

**Branch:** `chore/repo-bootstrap`

**Files:**

- `.gitignore`
- `.gitattributes`
- `LICENSE`
- `.npmrc`
- `.nvmrc` if present
- root `package.json`
- root `package-lock.json`
- minimal `README.md` stub

**Description template:**

> *Starts the public repository with a clean, cloneable workspace.*
>
> This PR creates the root npm workspace and repository metadata for
> ThoughtTracker. It intentionally avoids product code so the public history
> starts with a small foundation.
>
> **Not included:** backend, frontend, data, docs, or tests. Those land in
> layered follow-up PRs.

---

## APP-PR-01 - `feat(backend): scaffold API runtime`

**Branch:** `feat/backend-scaffold`

**Files:**

- `backend/package.json`
- `backend/tsconfig.json`
- `backend/tsconfig.eslint.json`
- `backend/vitest.config.ts`
- `backend/Dockerfile`
- `backend/src/app.ts`
- `backend/src/server.ts`
- `backend/src/config/*`
- `backend/src/utils/*`
- `backend/src/_LEARN.md`
- `backend/_LEARN.md`
- initial backend health test and helpers

**Description template:**

> *Puts the backend runtime in place before any domain behavior lands.*
>
> This PR introduces the Express/TypeScript backend shell, environment parsing,
> Prisma client wiring, shared utilities, logging, health checks, and the first
> smoke tests.
>
> **Why now:** every later backend layer depends on a typed app runtime and
> shared utility foundation.

---

## APP-PR-02 - `feat(database): schema, pgvector setup, and safety guards`

**Branch:** `feat/database-schema`

**Files:**

- `backend/prisma/schema.prisma`
- `backend/prisma/setup-db.ts`
- `backend/prisma/seed.ts`
- `backend/prisma/_LEARN.md`
- Prisma-related tests

**Description template:**

> *Defines the evidence chain in the database before services start writing to it.*
>
> This PR adds the Prisma schema for creators, videos, transcripts, chunks,
> topics, stance/topic analysis, reports, jobs, provenance rows, and embeddings.
> It also adds idempotent pgvector setup and a guarded seed script that refuses
> to destroy a real database unless explicitly allowed.
>
> **Important:** the seed script is for tests/development fixtures. The product
> data path is the restored real database snapshot added later.

---

## APP-PR-03 - `feat(data): add real database snapshot and runtime env policy`

**Branch:** `feat/real-data-baseline`

**Files:**

- `thoughttracker_full.dump` through Git LFS
- `thoughttracker_hosted_free.dump` through Git LFS
- `.env.example`
- `docker-compose.yml`
- `docker-compose.full.yml`
- `scripts/setup-local.mjs`
- `scripts/setup-local-ai.mjs`
- `scripts/start-postgres.mjs`
- `scripts/doctor.mjs`
- docs snippets needed to explain snapshot restore

**Description template:**

> *Moves the app beyond fixtures by adding the real product snapshot.*
>
> This PR adds the Git-LFS-tracked PostgreSQL dumps that power both local and
> hosted portfolio baselines. `thoughttracker_full.dump` is the complete local
> restore path; `thoughttracker_hosted_free.dump` is the Neon-friendly public
> restore path. It also documents the local runtime policy: Ollama for reports,
> the main app reading the real product snapshot, and no paid API key required
> for reviewers. `thoughttracker-ml` remains the offline factory for future
> creator ingestion and model refreshes.
>
> **Reviewer note:** after this PR, the app has a real data source but not yet
> the complete API/UI surface.

---

## APP-PR-04 - `feat(ai): local LLM and ML client layer`

**Branch:** `feat/ai-ml-client-layer`

**Files:**

- `backend/src/ai/llmClient.ts`
- `backend/src/ai/llmBudget.ts`
- `backend/src/ai/embeddingClient.ts`
- `backend/src/ai/mlClassifierClient.ts`
- `backend/src/ai/prompts/*`
- `backend/src/ai/schemas/*`
- AI/provider tests

**Description template:**

> *Centralizes every model-facing call behind explicit provider clients.*
>
> This PR adds local Ollama report generation, hosted-provider support for
> owner-only private use, the ML-service HTTP client, embedding calls, prompt
> files, response validation, and provider-edge tests.
>
> **Product policy:** runtime code should use real/local providers and fail
> clearly when dependencies are missing. Test doubles remain inside tests.

---

## APP-PR-05 - `feat(backend): services and analysis pipeline`

**Branch:** `feat/backend-services`

**Files:**

- `backend/src/services/*`
- service tests
- coverage edge tests tied to services

**Description template:**

> *Adds the product brain: transcript analysis, topic selection, stance, search,
> reports, and comparison logic.*
>
> This PR introduces the service layer. Services own domain behavior: chunking,
> evidence lookup, topic detection, topic relevance/reranking integration,
> final policy selection, stance analysis, report
> generation, dashboard insight, and creator comparison.
>
> **Why it matters:** this is where the real data becomes useful product output.

---

## APP-PR-06 - `feat(api): jobs, middleware, controllers, routes, and OpenAPI`

**Branch:** `feat/backend-http-layer`

**Files:**

- `backend/src/jobs/*`
- `backend/src/middleware/*`
- `backend/src/middleware/publicReadCache.ts`
- `backend/src/controllers/*`
- `backend/src/routes/*`
- `backend/src/openapi/*`
- related backend integration tests

**Description template:**

> *Turns the service layer into a typed HTTP API with safe long-running work.*
>
> This PR adds the in-process job runner, request middleware, owner/admin
> safeguards, route/controller wiring, OpenAPI documentation, and integration
> tests for the API surface.
>
> **Notable decisions:** mutating owner routes require `X-Admin-Pin`; long work
> runs through jobs; public read endpoints use a short in-memory cache on hosted
> free-tier infrastructure; errors are structured and observable.

---

## APP-PR-07 - `feat(frontend): scaffold shell and reusable UI`

**Branch:** `feat/frontend-shell`

**Files:**

- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/vitest.config.ts`
- `frontend/tailwind.config.js`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- `frontend/src/generated/bootstrapSnapshot.json`
- `frontend/src/theme/*`
- `frontend/src/toast/*`
- `frontend/src/components/*`
- `frontend/src/lib/*`
- `scripts/generate-bootstrap-snapshot.mjs`
- component/lib tests

**Description template:**

> *Builds the frontend foundation so every page shares the same product chrome.*
>
> This PR adds the Vite/React app shell, routing, theme provider, toast provider,
> API client, formatting helpers, shared types, layout, cards, badges, charts,
> states, reusable components, and the pre-generated bootstrap snapshot that
> makes the hosted app feel responsive before the free-tier API wakes up.

---

## APP-PR-08 - `feat(frontend): product pages and reports`

**Branch:** `feat/frontend-product-pages`

**Files:**

- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/CreatorsPage.tsx`
- `frontend/src/pages/CreatorOverviewPage.tsx`
- `frontend/src/pages/VideosPage.tsx`
- `frontend/src/pages/VideoDetailPage.tsx`
- `frontend/src/pages/TopicsPage.tsx`
- `frontend/src/pages/TopicAnalysisPage.tsx`
- `frontend/src/pages/ComparePage.tsx`
- `frontend/src/pages/EvidencePage.tsx`
- `frontend/src/pages/EvidenceDetailPage.tsx`
- `frontend/src/pages/ReportsPage.tsx`
- `frontend/src/pages/ReportDetailPage.tsx`
- page tests

**Description template:**

> *Makes the app usable: real creators, real topics, real evidence, real reports.*
>
> This PR lands the primary user-facing pages. It includes report source links,
> compare-page shared-topic navigation, video transcript views, evidence
> drilldowns, and topic analysis visualizations.

---

## APP-PR-09 - `feat(admin): owner-only Add Creators onboarding`

**Branch:** `feat/add-creators-owner-flow`

**Files:**

- `frontend/src/pages/AddCreatorsPage.tsx`
- `frontend/src/components/AppHeader.tsx` or navigation files touched by the
  visible Add Creators button
- `backend/src/controllers/creatorOnboarding.controller.ts`
- `backend/src/controllers/reports.controller.ts`
- `backend/src/routes/creatorOnboarding.routes.ts`
- `backend/src/routes/reports.routes.ts`
- `backend/src/services/creatorOnboardingPipeline.service.ts`
- `backend/src/services/starterReport.service.ts`
- `backend/src/middleware/adminPin.ts`
- `backend/scripts/build-creator-onboarding-packet.ts`
- onboarding tests

**Description template:**

> *Shows the scale-up path while keeping corpus mutation under owner control.*
>
> This PR adds the visible Add Creators experience and the backend owner guard.
> Recruiters can see that the product was designed to scale, but only the owner
> can run mutating onboarding actions with `ADMIN_ONBOARDING_PIN`. It also adds
> the owner-only report reset path that returns the app to the single default
> Marques Brownlee foldable-smartphone report for the next reviewer.

---

## APP-PR-10 - `test(app): full regression and Playwright coverage`

**Branch:** `test/full-regression-suite`

**Files:**

- backend tests not already bundled with earlier PRs
- frontend tests not already bundled with earlier PRs
- `e2e/*`
- `playwright.config.ts`
- CI updates in `.github/workflows/ci.yml`

**Description template:**

> *Proves the product works from unit level to browser level.*
>
> This PR completes the regression suite: backend tests, frontend tests,
> coverage edge cases, Playwright golden path, compare flow, reports flow,
> Add Creators flow, accessibility, and CI wiring.

---

## APP-PR-11 - `docs(deploy): local setup and deployment guide`

**Branch:** `docs/local-setup-and-deploy`

**Files:**

- `README.md`
- `PERSONAL_MACHINE_SETUP.md`
- `docs/DEPLOY.md`
- `render.yaml`
- `scripts/setup-local.mjs`
- `scripts/doctor.mjs`
- deployment config files not already included

**Description template:**

> *Makes the project runnable by someone who did not watch it being built.*
>
> This PR documents the local setup path: Git LFS, Docker, database restore,
> Ollama, ML service startup, app startup, troubleshooting, and deployment
> options. It also documents the hosted free path: Neon for Postgres, Render
> for the API/static frontend, and the exact secrets that stay outside Git.

---

## APP-PR-12 - `docs(product): architecture, glossary, ADRs, and rebuild brief`

**Branch:** `docs/product-architecture`

**Files:**

- `ARCHITECTURE.md`
- `GLOSSARY.md`
- `REVERSE_ENGINEERED_PROMPT.md`
- `SKILLS.md`
- `CONTRIBUTING.md`
- `docs/adr/*`
- `docs/DESIGN_REFERENCES.md`
- `docs/UPLOAD_PLAN.md`
- `_LEARN.md` files not already introduced with their folders

**Description template:**

> *Turns the codebase into an explainable engineering portfolio.*
>
> This PR adds the architecture map, reader-friendly glossary, rebuild prompt,
> ADRs, upload plan, design references, and folder-level learning notes. It
> explains why the project uses a real snapshot, local Ollama, companion ML
> artifacts, pgvector, owner-gated onboarding, and evidence-first reporting.

---

# Repo 2 Of 2 - `thoughttracker-ml`

The ML repo owns transcript collection, ML inference, model artifacts, topic
policy artifacts, processed datasets, and metrics.

## ML Dependency Graph

```text
ML-PR-00 repo bootstrap
  |
ML-PR-01 config, schemas, utilities
  |
ML-PR-02 transcript corpus and processed datasets
  |
ML-PR-03 inference modules
  |
ML-PR-04 FastAPI service and integration contract
  |
ML-PR-05 final model artifacts and policy metrics
  |
ML-PR-06 owner update scripts
  |
ML-PR-07 ML tests and docs polish
```

---

## ML-PR-00 - `chore(ml): bootstrap`

**Branch:** `chore/ml-bootstrap`

**Files:**

- `.gitignore`
- `.gitattributes`
- `LICENSE`
- `requirements.txt`
- `pytest.ini`
- `Dockerfile`
- package skeleton under `src/`
- minimal `README.md`

**Description template:**

> *Creates the companion ML repo as a separate, testable service.*
>
> This PR bootstraps the Python project structure, dependencies, Dockerfile,
> pytest configuration, and empty package layout.

---

## ML-PR-01 - `feat(ml): config, schemas, and utilities`

**Branch:** `feat/ml-foundation`

**Files:**

- `src/config.py`
- `src/utils/*`
- `src/data/label_schema.py`
- foundation tests

**Description template:**

> *Adds the shared foundation every ML module depends on.*
>
> This PR introduces environment-driven config, path helpers, logging helpers,
> label schema definitions, and foundational tests.

---

## ML-PR-02 - `feat(ml): real transcript corpus and processed datasets`

**Branch:** `feat/real-transcript-corpus`

**Files:**

- `data/transcripts/**` final text transcripts
- `data/transcripts/*/_manifest.json`
- `data/processed/thoughttracker_topic_relevance_gold_standard.csv`
- `data/processed/thoughttracker_topic_reranker_gold_standard.csv`
- corpus documentation

**Description template:**

> *Adds the real five-creator corpus that powers the product baseline.*
>
> This PR commits the clean five-creator transcript text, each creator manifest,
> and processed gold-standard topic datasets. At the current checkpoint the
> tracked clean corpus is 4,356 transcript text files plus five manifests. It
> does not include `_excluded_low_quality`, `_excluded_short_form`, temporary
> packet folders, failed calibration rounds, raw VTT caches, or obsolete samples.

---

## ML-PR-03 - `feat(ml): inference modules`

**Branch:** `feat/ml-inference`

**Files:**

- `src/inference/model_loader.py`
- `src/inference/predict.py`
- `src/inference/embed.py`
- `src/inference/topic_relevance.py`
- `src/inference/topic_reranker.py`
- `src/inference/_device.py`
- inference tests

**Description template:**

> *Adds the local model runtime used by the main app.*
>
> This PR implements stance prediction, 768-dimensional embeddings, topic
> relevance, topic reranking, artifact loading, and device selection.

---

## ML-PR-04 - `feat(ml): FastAPI service and integration contract`

**Branch:** `feat/ml-api-contract`

**Files:**

- `src/api/main.py`
- `integration_contract.md`
- API tests

**Description template:**

> *Exposes the ML runtime over HTTP so the TypeScript backend can call it.*
>
> This PR adds the FastAPI service with `/health`, `/predict`, `/embed`,
> `/predict-topic-relevance`, and `/predict-topics`, plus the contract document
> that keeps both repos aligned.

---

## ML-PR-05 - `feat(ml): committed artifacts and gold-standard policy`

**Branch:** `feat/gold-standard-artifacts`

**Files:**

- `models/stance-classifier/**`
- `models/topic-relevance-classifier-supervalidation-hardneg2x-l512/**`
- `models/topic-reranker-tfidf-sgd-supervalidation/**`
- `models/topic-selection-policy-gold-standard/**`
- `reports/metrics/**`
- model cards, tokenizer/config files, and Git-LFS-tracked binary artifacts

**Description template:**

> *Freezes the ML baseline reviewers will actually run.*
>
> This PR adds the runtime artifacts and metrics that make the public demo
> reproducible. The final topic-selection policy reports exact match 95.44%,
> micro F1 98.40%, precision 97.82%, recall 98.98%, and macro F1 75.35%.
> Training checkpoints remain excluded because they are not needed at runtime.

---

## ML-PR-06 - `feat(ml): owner transcript update scripts`

**Branch:** `feat/owner-update-scripts`

**Files:**

- `scripts/fetch_transcripts.py`
- `scripts/fetch_transcripts_ytdlp.py`
- `scripts/fetch_all_creators.sh`
- `scripts/build_manifest_from_transcripts.mjs`
- `scripts/update_all_creators.mjs`
- `scripts/ingest_all_transcripts.mjs`
- `scripts/ingest_transcripts.py`
- `scripts/run_reanalyze_latest_model.mjs`
- `scripts/evaluate_hybrid_topic_pipeline.py`
- `scripts/add_creator_pipeline.mjs`
- `scripts/README.md`
- `scripts/_LEARN.md`
- script tests

**Description template:**

> *Documents and automates how the owner can grow the corpus after launch.*
>
> This PR adds the transcript download, manifest, ingestion, reanalysis, and
> onboarding scripts used by the owner. These are not recruiter-operated flows.

---

## ML-PR-07 - `test(ml): coverage and docs polish`

**Branch:** `test/ml-coverage-docs`

**Files:**

- remaining `tests/**`
- `README.md`
- `docs/CREATOR_ONBOARDING_PLAYBOOK.md`
- `_LEARN.md` files

**Description template:**

> *Finishes the ML repo as a readable, tested companion service.*
>
> This PR completes ML test coverage and documentation. It explains how the
> service is run, how it integrates with the main app, how artifacts are loaded,
> and how owner-only corpus updates work.

---

# Cross-Repo Ordering

The main app can be reviewed through APP-PR-04 before the ML repo is complete,
because the client layer can be read independently. The running product needs:

- APP-PR-03 for the database snapshot
- APP-PR-04 for provider clients
- APP-PR-05 and APP-PR-06 for API behavior
- ML-PR-04 and ML-PR-05 for local ML inference
- APP-PR-07 and APP-PR-08 for UI

Recommended public merge order:

1. APP-PR-00 through APP-PR-04
2. ML-PR-00 through ML-PR-05
3. APP-PR-05 through APP-PR-10
4. ML-PR-06 through ML-PR-07
5. APP-PR-11 through APP-PR-12

This order lets reviewers see the system assemble without needing the whole
stack to be runnable until the middle of the sequence.

---

# Real GitHub Migration Runbook

Use this when you are ready to move from the sandbox repos into the real public
GitHub repos. The safest path is to create clean public repos, then replay this
upload plan as layered PRs. The current sandbox can stay private/temporary.

## One-Time Account Setup

1. Open GitHub in your browser and sign in to the real account.
2. Click **+** in the top-right corner.
3. Click **New repository**.
4. Create `thoughttracker` as an empty public repo.
   - Do not add a README.
   - Do not add a `.gitignore`.
   - Do not add a license.
5. Repeat the same process for `thoughttracker-ml`.
6. Open a terminal on the machine that has the finished sandbox repos.
7. Confirm Git LFS is installed:

```powershell
git lfs version
```

8. If Git LFS is missing, install it:

```powershell
git lfs install
```

## Create Local Public-Repo Working Copies

1. Choose a clean folder outside the sandbox, for example:

```powershell
cd C:\Users\jason\Documents\Projects
mkdir public-upload
cd public-upload
```

2. Clone the empty real repos:

```powershell
git clone https://github.com/<REAL_ACCOUNT>/thoughttracker.git
git clone https://github.com/<REAL_ACCOUNT>/thoughttracker-ml.git
```

3. Keep these three folders visually separate:
   - `Projects\thoughttracker` - sandbox app repo
   - `Projects\thoughttracker-ml` - sandbox ML repo
   - `Projects\public-upload\...` - real public upload repos

## Copy Files By PR Layer

For each PR in this plan:

1. Create the branch in the public repo:

```powershell
git checkout main
git pull
git checkout -b <branch-from-this-plan>
```

2. Copy only the files listed for that PR from the sandbox repo into the public
   repo. On Windows Explorer, this is safest:
   - Open the sandbox repo folder.
   - Open the public repo folder beside it.
   - Copy the listed files/folders.
   - Do not copy `.env`, `.venv`, `node_modules`, `coverage`, `dist`,
     checkpoints, raw VTT files, temporary labeling packets, or excluded
     transcript folders.
3. Check the diff:

```powershell
git status
git diff --stat
```

4. If the PR includes large artifacts, confirm Git LFS sees them:

```powershell
git lfs status
```

5. Commit:

```powershell
git add .
git commit -m "<message from this plan>"
git push -u origin <branch-from-this-plan>
```

6. Open GitHub.
7. Click **Compare & pull request**.
8. Paste the matching PR description from this plan.
9. Review the file list in GitHub.
10. Merge when the diff matches the layer.

Repeat until both repos have all PRs merged.

## Required Large Artifacts

Before considering the real repos complete, verify these are present:

Main app repo:

- `thoughttracker_full.dump`
- `thoughttracker_hosted_free.dump`
- `.gitattributes` tracking `*.dump` through Git LFS

ML repo:

- `data/transcripts/allin/*.txt`
- `data/transcripts/campea/*.txt`
- `data/transcripts/delauer/*.txt`
- `data/transcripts/huberman/*.txt`
- `data/transcripts/mkbhd/*.txt`
- `data/transcripts/*/_manifest.json`
- `data/processed/thoughttracker_topic_relevance_gold_standard.csv`
- `data/processed/thoughttracker_topic_reranker_gold_standard.csv`
- `models/stance-classifier/**`
- `models/topic-relevance-classifier-supervalidation-hardneg2x-l512/**`
- `models/topic-reranker-tfidf-sgd-supervalidation/**`
- `models/topic-selection-policy-gold-standard/**`
- `reports/metrics/**`

Do not publish:

- `backend/.env`
- API keys, Neon connection strings, or admin PIN values
- `data/transcripts/_excluded_low_quality/**`
- `data/transcripts/_excluded_short_form/**`
- `models/**/checkpoints/**`
- `data/labeling/**`
- raw `.vtt` caption caches
- failed ChatGPT packet folders

## After The Public Repos Are Built

1. In the real `thoughttracker` repo, run:

```powershell
npm ci
npm run doctor
npm run test --workspace backend -- --run
npm run test --workspace frontend -- --run
npm run build --workspace frontend
```

2. In the real `thoughttracker-ml` repo, run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest
```

3. Open GitHub Actions and confirm both repos are green.
4. Reconnect Render to the real `thoughttracker` repo, or create a new Render
   Blueprint from the real repo.
5. Keep the same Neon database if you want; it is independent of GitHub. If you
   create a new Neon database, restore `thoughttracker_hosted_free.dump`.
6. In Render, set secrets again:
   - `DATABASE_URL`
   - `ADMIN_ONBOARDING_PIN`
7. After Render deploys, open the hosted app and click through Dashboard,
   Creators, Videos, Topics, Compare, Evidence, Reports, and Add Creators.

---

# PR Description Template

Use this structure for every PR:

```markdown
[One-line narrative intro in italics.]

## What This PR Does

[Two to four sentences explaining the technical scope.]

## Files In This PR

- `path/to/file` - what it does
- `path/to/other-file` - what it does

## Why This Lands Now

[Explain dependency context. What earlier PRs made this possible What later
PRs does this unblock]

## Notable Design Choices

- [Decision] - [short reason]
- [Decision] - [short reason]

## Test Coverage

[Explain tests included and what command verifies them.]

## Manual Review Plan

1. [Command or UI step]
2. [Command or UI step]
3. [Expected result]

## What Is Intentionally Absent

- [Related thing not included in this PR]
- [Which PR it belongs to instead]
```

---

# Final Public Handoff Checklist

Before publishing the final repos:

- Run `git lfs status` and confirm large required artifacts are tracked.
- Confirm no `.env` files or API keys are committed.
- Confirm real transcript text is committed in the ML repo.
- Confirm raw VTT caches and temporary packet folders are absent.
- Confirm `thoughttracker_full.dump` is present in the main repo through Git LFS.
- Confirm `models/` runtime artifacts are present in the ML repo through Git LFS
  if they are too large for normal Git.
- Run backend tests.
- Run frontend tests.
- Run ML tests.
- Run Playwright against the local stack.
- Open the app locally and click through Dashboard, Creators, Videos, Topics,
  Compare, Evidence, Reports, and Add Creators.

When this plan is complete, the public GitHub history should read like a
disciplined engineering build, not a bulk upload.
